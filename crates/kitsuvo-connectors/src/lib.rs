//! MCP connectors with explicit process/tool consent and OS-keychain OAuth storage.
use anyhow::{Context, Result, bail};
use rmcp::{
    RoleClient, ServiceExt,
    model::{CallToolRequestParams, ClientConfig},
    service::RunningService,
    transport::{
        StreamableHttpClientTransport, TokioChildProcess,
        auth::{
            AuthClient, AuthError, AuthorizationManager, AuthorizationRequest, CredentialStore,
            OAuthState, StoredCredentials,
        },
        streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};
use url::Url;

#[derive(Clone, Deserialize, Serialize, Debug)]
#[serde(tag = "transport", rename_all = "lowercase", deny_unknown_fields)]
pub enum Connector {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        pass_env: Vec<String>,
    },
    Http {
        url: String,
    },
}
#[derive(Default, Deserialize, Serialize, Debug)]
#[serde(deny_unknown_fields)]
pub struct Registry {
    pub connectors: BTreeMap<String, Connector>,
}
impl Registry {
    pub fn load(path: &Path) -> Result<Self> {
        use std::io::Read;
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .context("Cannot read connector registry")?
            .take(256 * 1024 + 1)
            .read_to_end(&mut bytes)
            .context("Cannot read connector registry")?;
        if bytes.len() > 256 * 1024 {
            bail!("Connector registry exceeds 256 KiB");
        }
        let registry: Self =
            serde_json::from_slice(&bytes).context("Invalid connector registry")?;
        for (name, connector) in &registry.connectors {
            if name.is_empty()
                || name.len() > 64
                || !name
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
            {
                bail!("Invalid connector name");
            }
            connector.validate()?;
        }
        Ok(registry)
    }
}
impl Connector {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::Stdio {
                command,
                args,
                pass_env,
            } => {
                if command.trim().is_empty() || command.contains(['\n', '\r']) || args.len() > 128 {
                    bail!("Invalid connector command");
                }
                if pass_env.iter().any(|key| {
                    key.is_empty() || !key.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
                }) {
                    bail!("Invalid environment variable name");
                }
            }
            Self::Http { url } => {
                validate_url(url)?;
            }
        }
        Ok(())
    }
}
pub fn validate_url(input: &str) -> Result<Url> {
    let url = Url::parse(input).context("Invalid MCP URL")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || url.scheme() == "http" && local)
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        bail!(
            "MCP URLs require HTTPS (or loopback HTTP), without embedded credentials, queries or fragments"
        );
    }
    Ok(url)
}
pub fn require_approval(approvals: &[String], connector: &str, action: &str) -> Result<()> {
    if !approvals
        .iter()
        .any(|a| a == &format!("{connector}:{action}"))
    {
        bail!("Approval required: --approve {connector}:{action}");
    }
    Ok(())
}

#[derive(Clone)]
struct KeychainStore {
    account: String,
}
impl KeychainStore {
    fn new(name: &str, url: &str) -> Self {
        Self {
            account: format!("{name}:{url}"),
        }
    }
    fn entry(&self) -> Result<keyring::Entry, AuthError> {
        keyring::Entry::new("app.kitsuvo.connectors.oauth", &self.account).map_err(|_| {
            AuthError::CredentialStoreError("Cannot access OS credential store".into())
        })
    }
}
#[async_trait::async_trait]
impl CredentialStore for KeychainStore {
    async fn load(&self) -> Result<Option<StoredCredentials>, AuthError> {
        match self.entry()?.get_password() {
            Ok(value) => serde_json::from_str(&value).map(Some).map_err(|_| {
                AuthError::CredentialStoreError("Invalid stored OAuth credentials".into())
            }),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AuthError::CredentialStoreError(
                "Cannot read OS credential store".into(),
            )),
        }
    }
    async fn save(&self, credentials: StoredCredentials) -> Result<(), AuthError> {
        if !cfg!(any(target_os = "macos", target_os = "windows")) {
            return Err(AuthError::CredentialStoreError(
                "Persistent OAuth storage currently requires macOS or Windows".into(),
            ));
        }
        let value = serde_json::to_string(&credentials)
            .map_err(|_| AuthError::CredentialStoreError("Cannot encode credentials".into()))?;
        self.entry()?
            .set_password(&value)
            .map_err(|_| AuthError::CredentialStoreError("Cannot save OS credentials".into()))
    }
    async fn clear(&self) -> Result<(), AuthError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AuthError::CredentialStoreError(
                "Cannot clear OS credentials".into(),
            )),
        }
    }
}
fn http_client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .build()?)
}
pub struct Session {
    service: RunningService<RoleClient, ClientConfig>,
}
impl Session {
    pub async fn connect(name: &str, config: &Connector, approvals: &[String]) -> Result<Self> {
        config.validate()?;
        require_approval(approvals, name, "connect")?;
        let service = match config {
            Connector::Stdio {
                command,
                args,
                pass_env,
            } => {
                let mut child = Command::new(command);
                child.args(args).env_clear().kill_on_drop(true);
                for key in [
                    "PATH",
                    "SystemRoot",
                    "WINDIR",
                    "HOME",
                    "TMPDIR",
                    "TEMP",
                    "TMP",
                ]
                .iter()
                .copied()
                .chain(pass_env.iter().map(String::as_str))
                {
                    if let Some(value) = std::env::var_os(key) {
                        child.env(key, value);
                    }
                }
                ClientConfig::default()
                    .serve(TokioChildProcess::new(child)?)
                    .await?
            }
            Connector::Http { url } => {
                let mut manager = AuthorizationManager::new(url).await?;
                manager.with_client(http_client()?)?;
                manager.set_credential_store(KeychainStore::new(name, url));
                if manager.initialize_from_store().await? {
                    ClientConfig::default()
                        .serve(StreamableHttpClientTransport::with_client(
                            AuthClient::new(http_client()?, manager),
                            StreamableHttpClientTransportConfig::with_uri(url.clone()),
                        ))
                        .await?
                } else {
                    ClientConfig::default()
                        .serve(StreamableHttpClientTransport::with_client(
                            http_client()?,
                            StreamableHttpClientTransportConfig::with_uri(url.clone()),
                        ))
                        .await
                        .map_err(|_| {
                            anyhow::anyhow!(
                                "Cannot connect; an authenticated server may require `login` first"
                            )
                        })?
                }
            }
        };
        Ok(Self { service })
    }
    pub async fn tools(&self) -> Result<Value> {
        Ok(serde_json::to_value(self.service.list_all_tools().await?)?)
    }
    pub async fn call(
        &self,
        name: &str,
        tool: &str,
        args: Value,
        approvals: &[String],
    ) -> Result<Value> {
        // Tool names cannot reuse connection or login consent.
        require_approval(approvals, name, &format!("tool:{tool}"))?;
        let arguments = args
            .as_object()
            .cloned()
            .context("Tool arguments must be a JSON object")?;
        // Always refresh the catalog; don't trust persisted server tool descriptions.
        if !self
            .service
            .list_all_tools()
            .await?
            .iter()
            .any(|t| t.name == tool)
        {
            bail!("Tool is not in this server's current catalog");
        }
        Ok(serde_json::to_value(
            self.service
                .call_tool(CallToolRequestParams::new(tool.to_owned()).with_arguments(arguments))
                .await?,
        )?)
    }
    pub async fn close(self) -> Result<()> {
        self.service.cancel().await?;
        Ok(())
    }
}

/// Provider-controlled OAuth with PKCE/state validation in the official MCP SDK.
/// No credential, authorization code or callback URL is written to logs.
pub async fn login(name: &str, config: &Connector, approvals: &[String]) -> Result<()> {
    require_approval(approvals, name, "login")?;
    if !cfg!(any(target_os = "macos", target_os = "windows")) {
        bail!("Persistent OAuth storage currently requires macOS or Windows");
    }
    let Connector::Http { url } = config else {
        bail!("Stdio servers use their configured environment; OAuth requires HTTP");
    };
    validate_url(url)?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let redirect = format!(
        "http://127.0.0.1:{}/callback",
        listener.local_addr()?.port()
    );
    let mut state = OAuthState::new(url, Some(http_client()?)).await?;
    if let OAuthState::Unauthorized(manager) = &mut state {
        manager.set_credential_store(KeychainStore::new(name, url));
    }
    state
        .start_authorization(AuthorizationRequest::new(&redirect).with_client_name("Kitsuvo"))
        .await?;
    let authorization = state.get_authorization_url().await?;
    // Intentional browser handoff: provider scope consent must remain visible.
    webbrowser::open(&authorization).context("Cannot open the provider's consent page")?;
    let (mut stream, _) = tokio::time::timeout(Duration::from_secs(300), listener.accept())
        .await
        .context("Authorization timed out")??;
    // TCP reads may split the request line and headers across packets.
    let bytes = tokio::time::timeout(Duration::from_secs(10), async {
        let mut bytes = Vec::new();
        let mut buffer = [0u8; 1024];
        loop {
            let size = stream.read(&mut buffer).await?;
            if size == 0 {
                bail!("Incomplete OAuth callback");
            }
            bytes.extend_from_slice(&buffer[..size]);
            if bytes.len() > 8192 {
                bail!("OAuth callback headers exceed limit");
            }
            if bytes.windows(4).any(|part| part == b"\r\n\r\n") {
                break;
            }
        }
        Ok::<_, anyhow::Error>(bytes)
    })
    .await
    .context("OAuth callback timed out")??;
    let request = std::str::from_utf8(&bytes).context("Invalid OAuth callback")?;
    let path = request
        .lines()
        .next()
        .and_then(|line| line.strip_prefix("GET "))
        .and_then(|line| line.split(' ').next())
        .context("Invalid OAuth callback method")?;
    if !path.starts_with("/callback?") {
        bail!("Invalid callback path");
    }
    let callback = format!("http://127.0.0.1:{}{path}", listener.local_addr()?.port());
    let success = state.handle_callback_url(&callback).await.is_ok();
    let body = if success {
        "Connected to Kitsuvo. You can close this tab."
    } else {
        "Authorization failed. Return to Kitsuvo and try again."
    };
    let response = format!(
        "HTTP/1.1 {}\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        if success { "200 OK" } else { "400 Bad Request" },
        body.len()
    );
    stream.write_all(response.as_bytes()).await?;
    if !success {
        bail!("OAuth callback rejected");
    }
    Ok(())
}
pub async fn disconnect(name: &str, config: &Connector) -> Result<()> {
    let Connector::Http { url } = config else {
        bail!("No OAuth credentials for a stdio connector");
    };
    KeychainStore::new(name, url).clear().await?;
    Ok(())
}

pub fn run(args: &[String]) -> Result<()> {
    let mut config = None;
    let mut approvals = Vec::new();
    let mut positional = Vec::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--config" => config = Some(iter.next().context("--config requires a path")?),
            "--approve" => approvals.push(
                iter.next()
                    .context("--approve requires connector:action")?
                    .clone(),
            ),
            _ if arg.starts_with("--") => bail!("Unknown connector option"),
            _ => positional.push(arg.as_str()),
        }
    }
    let registry = Registry::load(Path::new(config.context("Use --config <registry.json>")?))?;
    if positional.as_slice() == ["list"] {
        println!(
            "{}",
            serde_json::to_string_pretty(&registry.connectors.keys().collect::<Vec<_>>())?
        );
        return Ok(());
    }
    let [operation, name, rest @ ..] = positional.as_slice() else {
        bail!(
            "Use list, tools <name>, login <name>, disconnect <name>, or call <name> <tool> <json>"
        );
    };
    let connector = registry
        .connectors
        .get(*name)
        .context("Unknown connector")?;
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async {
        match (*operation, rest) {
            ("login", []) => login(name, connector, &approvals).await,
            ("disconnect", []) => disconnect(name, connector).await,
            ("tools", []) | ("call", [_, _]) => {
                let session = tokio::time::timeout(
                    Duration::from_secs(30),
                    Session::connect(name, connector, &approvals),
                )
                .await??;
                let result = tokio::time::timeout(Duration::from_secs(60), async {
                    if *operation == "tools" {
                        session.tools().await
                    } else {
                        let [tool, json] = rest else { unreachable!() };
                        session
                            .call(name, tool, serde_json::from_str(json)?, &approvals)
                            .await
                    }
                })
                .await
                .context("Connector operation timed out")?;
                let closed = session.close().await;
                println!("{}", serde_json::to_string_pretty(&result?)?);
                closed
            }
            _ => bail!("Invalid connector operation or arguments"),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_urls_cannot_downgrade_or_embed_secrets() {
        for value in [
            "http://example.com/mcp",
            "https://user:secret@example.com/mcp",
            "https://example.com/mcp?token=secret",
            "https://example.com/mcp#secret",
            "file:///tmp/server",
        ] {
            assert!(validate_url(value).is_err(), "{value}");
        }
        for value in [
            "https://example.com/mcp",
            "http://127.0.0.1:8787/mcp",
            "http://[::1]:8787/mcp",
        ] {
            assert!(validate_url(value).is_ok(), "{value}");
        }
    }
    #[test]
    fn approvals_are_exact_and_do_not_cross_connectors() {
        let approvals = vec!["drive:connect".into(), "drive:search".into()];
        assert!(require_approval(&approvals, "drive", "search").is_ok());
        assert!(require_approval(&approvals, "slack", "search").is_err());
        assert!(require_approval(&approvals, "drive", "delete").is_err());
        assert!(require_approval(&["*".into()], "drive", "search").is_err());
        assert!(require_approval(&["drive:connect".into()], "drive", "tool:connect").is_err());
    }
    #[test]
    fn malformed_process_configs_are_rejected() {
        assert!(
            Connector::Stdio {
                command: "\n".into(),
                args: vec![],
                pass_env: vec![]
            }
            .validate()
            .is_err()
        );
        assert!(
            Connector::Stdio {
                command: "node".into(),
                args: vec![],
                pass_env: vec!["KEY=secret".into()]
            }
            .validate()
            .is_err()
        );
    }
}
