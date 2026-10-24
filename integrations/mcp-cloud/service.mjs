// An explicitly installed user service outlives the desktop app. OAuth grants
// resume via a private persistent identity; new clients require local approval.
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod, rm, open, link } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connectBrowser, browserTransportConfig, checkIsolationSupport, ConnectorError } from './connect.mjs';

const label = 'app.kitsuvo.cloud-connector';
const taskName = 'Kitsuvo Cloud Connector';
const here = fileURLToPath(import.meta.url);
const token = () => randomBytes(32).toString('base64url');
const display = value => JSON.stringify(value).replace(/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
export const serviceDirectory = (platform = process.platform, home = homedir(), local = process.env.LOCALAPPDATA) =>
  platform === 'win32' ? path.join(local || path.join(home, 'AppData', 'Local'), 'Kitsuvo', 'cloud-connector') : path.join(home, '.config', 'kitsuvo', 'cloud-connector');

export function validateConfig(config) {
  const url = new URL(config.origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('An HTTPS relay origin is required.');
  if (config.consent !== 'isolated-browser-cloud-access-v1') throw new Error('Explicit cloud browser consent is required.');
  for (const key of ['binary', 'profile', 'node', 'script']) if (typeof config[key] !== 'string' || !path.isAbsolute(config[key])) throw new Error(`Absolute ${key} path required.`);
  return { ...config, origin: url.origin };
}

const xml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const ps = s => "'" + s.replaceAll("'", "''") + "'";
export function launchAgent(config, directory) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${[config.node, config.script, 'run', '--directory', directory].map(s => `<string>${xml(s)}</string>`).join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer><key>StandardErrorPath</key><string>${xml(path.join(directory, 'service.log'))}</string></dict></plist>\n`;
}
export function windowsTask(config, directory) {
  // Quote argv for the Windows command-line parser, then quote the entire value
  // as PowerShell data. No shell interpolates user paths.
  const quoted = s => '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
  const args = [config.script, 'run', '--directory', directory].map(quoted).join(' ');
  return `$action = New-ScheduledTaskAction -Execute ${ps(config.node)} -Argument ${ps(args)}\n$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)\n$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited\n$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Seconds 30) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries\nRegister-ScheduledTask -TaskName ${ps(taskName)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null\nStart-ScheduledTask -TaskName ${ps(taskName)}\n`;
}

export async function privateFile(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(value) + '\n', { mode: 0o600 });
  await chmod(file, 0o600);
}

export async function connectorIdentity(directory, origin) {
  const file = path.join(directory, 'identity.json');
  try {
    const identity = JSON.parse(await readFile(file, 'utf8'));
    if (identity.origin !== origin || !/^[A-Za-z0-9_-]{43}$/.test(identity.key)) throw new Error('Invalid connector identity');
    return identity.key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const key = token(), temporary = file + '.' + token();
    await mkdir(directory, {recursive:true,mode:0o700});
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({origin,key}) + '\n'); await handle.sync();
      await handle.close(); handle = undefined;
      // Publish a complete identity exclusively; concurrent startup can never
      // replace it or observe an empty partially written credential file.
      await link(temporary, file);
    } catch (error) { if (error.code === 'EEXIST') return connectorIdentity(directory, origin); throw error; }
    finally { await handle?.close(); await rm(temporary, {force:true}); }
    return key;
  }
}

export async function startControl({ connection, directory }) {
  const key = token(), reviews = new Map(), approvals = new Map();
  let connected = false, durable = false, revocation;
  const receive = message => {
    if (message.type === 'connected') { connected = true; durable = message.durable === true; }
    if (message.type === 'revoked') { revocation?.(); revocation = undefined; }
    if (message.type === 'review') {
      const pending = reviews.get(message.id); if (!pending) return;
      reviews.delete(message.id);
      const challenge = token();
      approvals.set(challenge, { id: message.id, expires: Date.now() + 60000 });
      pending.resolve({ challenge, clientName: message.clientName, redirectUri: message.redirectUri, scope: message.scope });
    }
    if (message.type === 'rejected') { reviews.get(message.id)?.reject(new Error('Request expired or already approved.')); reviews.delete(message.id); }
  };
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const expected = `Bearer ${key}`, supplied = req.headers.authorization || '';
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.headers.origin || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) { res.writeHead(403).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 2048) throw new Error('Too large'); }
      const data = JSON.parse(body);
      if (data.action === 'status') { res.end(JSON.stringify({ connected, durable, pid: process.pid })); return; }
      if (data.action === 'revoke') {
        if (!connected || !durable || revocation) throw new Error('No durable connection');
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { revocation = undefined; reject(new Error('Revoke timeout')); }, 5000);
          revocation = () => { clearTimeout(timer); resolve(); }; connection.revoke();
        });
        res.end(JSON.stringify({ revoked: true })); return;
      }
      for (const [id, item] of approvals) if (item.expires <= Date.now()) approvals.delete(id);
      if (data.action === 'review' && /^[A-Za-z0-9_-]{43}$/.test(data.code)) {
        if (reviews.size || approvals.size) throw new Error('An approval is already pending.');
        const result = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { reviews.delete(data.code); reject(new Error('Review timeout')); }, 5000);
          reviews.set(data.code, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
          connection.review(data.code);
        });
        res.end(JSON.stringify(result)); return;
      }
      if (data.action === 'approve') {
        const pending = approvals.get(data.challenge); approvals.delete(data.challenge);
        if (!pending || pending.expires <= Date.now()) throw new Error('Review first.');
        connection.approve(pending.id); res.end(JSON.stringify({ submitted: true })); return;
      }
      throw new Error('Unsupported action');
    } catch { res.writeHead(400).end('Local request rejected.'); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await privateFile(path.join(directory, 'control.json'), { port: server.address().port, key });
  return { receive, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(path.join(directory, 'control.json'), { force: true }); } };
}

export async function controlRequest(directory, data) {
  const { port, key } = JSON.parse(await readFile(path.join(directory, 'control.json'), 'utf8'));
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error('Invalid local control state.');
  const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('Local connector request failed.');
  return res.json();
}

export async function revokeConnector(directory) {
  const config = validateConfig(JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8')));
  const identity = JSON.parse(await readFile(path.join(directory, 'identity.json'), 'utf8'));
  if (identity.origin !== config.origin || !/^[A-Za-z0-9_-]{43}$/.test(identity.key)) throw new Error('Invalid identity');
  const response = await fetch(config.origin + '/connector/revoke', {method:'POST', headers:{'X-Kitsuvo-Connector-Key':identity.key}, redirect:'error', signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error('Relay revocation not confirmed');
}

async function run(directory) {
  checkIsolationSupport();
  const config = validateConfig(JSON.parse(await readFile(path.join(directory, 'config.json'), 'utf8')));
  // The service manager ensures one process. A live control endpoint also
  // prevents accidental manual duplicate startup and credential-file overwrite.
  try { await controlRequest(directory, { action: 'status' }); throw new Error('Connector already running.'); } catch (error) { if (error.message === 'Connector already running.') throw error; }
  const backend = new Client({ name: 'kitsuvo-cloud-service', version: '0.1.0' });
  const native = new StdioClientTransport(browserTransportConfig({ KITSUVO_BINARY: config.binary, KITSUVO_PROFILE_DIR: config.profile, KITSUVO_PANEL_STATE_FILE: path.join(directory, 'panels.json') }, true));
  let connection, control, stopped = false;
  const stop = async () => { if (stopped) return; stopped = true; connection?.socket.close(); await control?.close(); await backend.close(); };
  try {
    await backend.connect(native);
    const early = [];
    connection = connectBrowser({ origin: config.origin, connectorKey: await connectorIdentity(directory, config.origin), backend, onMessage: message => control ? control.receive(message) : early.push(message) });
    control = await startControl({ connection, directory }); early.forEach(control.receive);
    connection.socket.on('close', () => { process.exitCode = 1; void stop(); });
    connection.socket.on('error', () => { process.exitCode = 1; void stop(); });
    process.once('SIGTERM', () => { void stop(); }); process.once('SIGINT', () => { void stop(); });
  } catch (error) { await stop(); throw error; }
}

export async function main(args = process.argv.slice(2)) {
  const get = flag => args[args.indexOf(flag) + 1];
  const directory = args.includes('--directory') ? path.resolve(get('--directory')) : serviceDirectory();
  if (args[0] === 'run') return run(directory);
  if (args[0] === 'revoke') { await revokeConnector(directory); console.log('All approved clients revoked.'); return; }
  if (args[0] === 'status') { console.log(JSON.stringify(await controlRequest(directory, { action: 'status' }))); return; }
  if (args[0] === 'approve') {
    if (!process.stdin.isTTY) throw new Error('Interactive approval required.');
    const review = await controlRequest(directory, { action: 'review', code: args[1] });
    console.error(`Client: ${display(review.clientName)}\nRedirect: ${display(review.redirectUri)}\nPermission: isolated browser navigation, tabs, clicks, typing, page JavaScript, snapshots, reports and screenshots.`);
    const terminal = createInterface({ input: process.stdin, output: process.stderr });
    try { if ((await terminal.question('Type APPROVE to authorize this client: ')) !== 'APPROVE') return; } finally { terminal.close(); }
    await controlRequest(directory, { action: 'approve', challenge: review.challenge }); console.error('Submitted. Refresh the authorization page.'); return;
  }
  if (args[0] === 'install') {
    if (!args.includes('--approve-cloud')) throw new Error('Pass --approve-cloud only after consenting to persistent isolated browser cloud access.');
    if (!['darwin', 'win32'].includes(process.platform)) throw new ConnectorError('Automatic startup supports macOS and Windows.');
    checkIsolationSupport();
    const config = validateConfig({ origin: get('--origin'), binary: get('--binary'), profile: get('--profile'), node: process.execPath, script: here, consent: 'isolated-browser-cloud-access-v1' });
    await privateFile(path.join(directory, 'config.json'), config);
    if (process.platform === 'darwin') {
      const file = path.join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
      await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, launchAgent(config, directory), { mode: 0o600 });
      try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }); } catch { /* first install */ }
      execFileSync('/bin/launchctl', ['bootstrap', `gui/${process.getuid()}`, file]);
    } else execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsTask(config, directory)]);
    console.log('Installed. Starts at login and keeps the connection alive when Kitsuvo closes. New clients require service.mjs approve <code>.'); return;
  }
  if (args[0] === 'uninstall') {
    await revokeConnector(directory);
    if (process.platform === 'darwin') {
      try { execFileSync('/bin/launchctl', ['bootout', `gui/${process.getuid()}/${label}`]); } catch { /* already stopped */ }
      await rm(path.join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`), { force: true });
    } else if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Stop-ScheduledTask -TaskName ${ps(taskName)} -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName ${ps(taskName)} -Confirm:$false`]);
    await rm(path.join(directory, 'config.json'), { force: true }); console.log('Disabled automatic startup and revoked this connector connection.'); return;
  }
  throw new Error('Use install --origin URL --binary PATH --profile PATH --approve-cloud, status, approve CODE, revoke, run, or uninstall.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error instanceof ConnectorError ? error.message : 'Cloud service request failed. Check the configuration, service status and relay availability.'); process.exitCode = 1; });
