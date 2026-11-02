// Kitsuvo remote control: a page served by the relay itself (same origin, so
// the relay's Origin check and CSP need no exceptions). It links like any MCP
// client: OAuth with PKCE, approved by the person in Kitsuvo, then MCP over
// /mcp. Tokens live in sessionStorage only, so closing the tab ends the link.
// Everything the browser returns is untrusted and rendered as text.
const $ = id => document.getElementById(id);
const origin = location.origin;
const redirectUri = `${origin}/remote`;
const resource = `${origin}/mcp`;
const store = sessionStorage;
const LIVE_MS = 4000;
const TYPING = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

let terminalSession = null, terminalState = 'closed', terminalTimer = 0, terminalPolling = false, terminalAvailable = false, terminalEpoch = 0;
let term = null, fit = null, inputQueue = Promise.resolve(), queuedInput = 0;
let generation = 0, hasView = false;
let session = null, protocol = '2025-06-18', nextId = 1, busy = false, liveTimer = 0;
let actionError = '';

const status = text => { $('status').textContent = text; };
const notice = text => { $('notice').textContent = text; $('notice').hidden = !text; };
function clearView() {
  hasView = false; $('view').hidden = true; $('view').removeAttribute('src'); $('elements').replaceChildren();
}
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

// ---- OAuth ----

async function clientId() {
  const saved = store.getItem('client_id');
  if (saved) return saved;
  const response = await fetch('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    client_name: 'Kitsuvo remote control', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  if (!response.ok) throw new Error('The relay refused to register this device. Try again in a minute.');
  const { client_id } = await response.json();
  store.setItem('client_id', client_id);
  return client_id;
}

async function startLink() {
  const id = await clientId();
  const verifier = random(), state = random();
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  store.setItem('verifier', verifier); store.setItem('state', state);
  const url = new URL('/authorize', origin);
  url.search = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: redirectUri, code_challenge: challenge,
    code_challenge_method: 'S256', state, scope: 'browser', resource }).toString();
  location.assign(url.href);
}

async function token(values) {
  const gen = generation;
  const response = await fetch('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: store.getItem('client_id') || '', resource, ...values }) });
  if (!response.ok) return false;
  const data = await response.json();
  if (gen !== generation) return false;
  store.setItem('access', data.access_token);
  if (data.refresh_token) store.setItem('refresh', data.refresh_token);
  return true;
}

async function finishLink(params) {
  const ok = params.get('state') === store.getItem('state') && await token({ grant_type: 'authorization_code', code: params.get('code') || '',
    code_verifier: store.getItem('verifier') || '', redirect_uri: redirectUri });
  store.removeItem('verifier'); store.removeItem('state');
  history.replaceState(null, '', '/remote');
  if (!ok) throw new Error('Linking did not finish. Start again and approve the device in Kitsuvo.');
}

let refreshing = null;
const refresh = () => {
  if (!refreshing) refreshing = (store.getItem('refresh') ? token({ grant_type: 'refresh_token', refresh_token: store.getItem('refresh') }) : Promise.resolve(false)).finally(() => { refreshing = null; });
  return refreshing;
};

function forget() {
  terminalAvailable = false;
  for (const key of ['access', 'refresh', 'verifier', 'state']) store.removeItem(key);
  generation++; session = null; busy = false; actionError = '';
  // Current-session expiry changes generation too. Complete its UI teardown
  // here, because obsolete request handlers must not update the newer state.
  $('url').value = ''; $('computer').textContent = '';
  setDisabled(false); showLink(); notice('');
  status('This device is no longer linked. Link it again to continue.');
}

// ---- MCP over Streamable HTTP ----

async function post(message, retry = true) {
  const gen = generation;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${store.getItem('access') || ''}`, 'MCP-Protocol-Version': protocol };
  if (session) headers['Mcp-Session-Id'] = session;
  const response = await fetch('/mcp', { method: 'POST', headers, body: JSON.stringify(message) });
  if (gen !== generation) throw new LinkLost();
  if (response.status === 401 && retry) {
    const refreshed = await refresh();
    if (gen !== generation) throw new LinkLost();
    if (refreshed) return post(message, false);
  }
  if (response.status === 401) { forget(); throw new LinkLost(); }
  if (response.status === 404 && session && retry) { session = null; await initialize(); return post(message, false); }
  if (response.status === 503) throw new Error('Kitsuvo is offline. Check that remote access is on and the computer is awake.');
  if (!response.ok && response.status !== 202) throw new Error('The relay could not reach Kitsuvo.');
  session = response.headers.get('Mcp-Session-Id') || session;
  if (!('id' in message) || response.status === 202) return null;
  const type = response.headers.get('Content-Type') || '';
  const text = await response.text();
  if (gen !== generation) throw new LinkLost();
  const replies = type.includes('text/event-stream')
    ? text.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n')).filter(Boolean).map(data => JSON.parse(data))
    : [JSON.parse(text)];
  const reply = replies.find(r => r.id === message.id);
  if (!reply) throw new Error('Kitsuvo sent no answer.');
  if (reply.error) throw new Error(reply.error.message || 'Kitsuvo refused the request.');
  return reply.result;
}

class LinkLost extends Error { constructor() { super('This device is no longer linked.'); } }

async function initialize() {
  const result = await post({ jsonrpc: '2.0', id: nextId++, method: 'initialize', params: {
    protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'kitsuvo-remote-control', version: '1' } } });
  protocol = result.protocolVersion || protocol;
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  // Shows up in Kitsuvo's agent banner like any assistant session.
  const registered = await tool('browser_session', { provider: 'Kitsuvo remote control', session_id: store.getItem('client_id') || 'remote', title: 'Remote control from another device' });
  if (registered?.isError) throw new Error(textOf(registered) || 'Kitsuvo could not identify this remote controller.');
}

const tool = (name, args = {}) => post({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
const textOf = result => (result?.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');

// ---- Control ----

// Snapshot lines read `- role "name" [ref=e1] [state] /url=… : value /description="…"`
// (src/agent/agent.js). Only the role, name, ref and a text value are used.
function elementsFrom(snapshot) {
  const items = [];
  for (const line of snapshot.split('\n')) {
    const match = /^\s*-\s+([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\[ref=(e\d+)\](.*)$/.exec(line);
    if (!match) continue;
    const rest = match[4].replace(/\s\/url=\S*(?:\s\[opens new tab\])?/, '').replace(/\s\/description=.*$/, '');
    // Values are quoted; a password shows as an unquoted [password] and is never prefilled.
    const value = /^[^:"]*:\s"((?:[^"\\]|\\.)*)"/.exec(rest)?.[1] || '';
    const unescape = text => text.replace(/\\(.)/g, '$1');
    items.push({ role: match[1], name: unescape(match[2] || ''), ref: match[3], value: unescape(value) });
    if (items.length >= 80) break;
  }
  return items;
}

function renderElements(items) {
  const list = items.map(({ role, name, ref, value }) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${role}${name ? `: ${name}` : ''}`;
    li.append(label);
    if (TYPING.has(role)) {
      const input = document.createElement('input');
      input.value = value; input.setAttribute('aria-label', `Text for ${name || role}`);
      const type = document.createElement('button');
      type.type = 'button'; type.textContent = 'Type';
      type.onclick = () => act('browser_type', { ref, text: input.value, clear: true, output: 'none' });
      li.append(input, type);
    } else {
      const click = document.createElement('button');
      click.type = 'button'; click.textContent = 'Click';
      click.setAttribute('aria-label', `Click ${name || role}`);
      click.onclick = () => act('browser_click', { ref, output: 'none' });
      li.append(click);
    }
    return li;
  });
  $('elements').replaceChildren(...list);
}

async function view() {
  const gen = generation;
  const result = await tool('browser_view', { max_width: 1280, max_height: 1600, max_chars: 20000 });
  if (gen !== generation) return;
  if (result.isError) { clearView(); throw new Error(textOf(result) || 'Kitsuvo could not show this page.'); }
  const image = (result.content || []).find(item => item.type === 'image' && item.mimeType === 'image/png');
  clearView();
  if (image) { $('view').src = `data:image/png;base64,${image.data}`; $('view').hidden = false; }
  const snapshot = textOf(result);
  const url = /^Page: (\S+)$/m.exec(snapshot)?.[1];
  if (url && document.activeElement !== $('url')) $('url').value = url;
  renderElements(elementsFrom(snapshot)); hasView = true;
  status(actionError || 'Connected to Kitsuvo.');
}

async function act(name, args) {
  if (busy) return;
  busy = true; setDisabled(true); notice('');
  const gen = generation;
  status('Sending action to Kitsuvo…');
  try {
    const result = await tool(name, args);
    if (gen !== generation) return;
    actionError = result?.isError ? textOf(result) || 'Kitsuvo refused that action.' : '';
    if (actionError) notice(actionError);
    await view();
  } catch (error) { if (gen === generation) { actionError = error.message || 'Kitsuvo refused that action.'; notice((error.message || 'The action could not be confirmed.') + ' Check the page before trying again.'); failed(error); } }
  finally { if (gen === generation) { busy = false; setDisabled(false); } }
}

function setDisabled(on) {
  for (const node of $('browserPanel').querySelectorAll('button, input')) if (node.id !== 'live') node.disabled = on;
}

function failed(error) {
  if (error instanceof LinkLost) { showLink(); status('This device is no longer linked. Link it again to continue.'); return; }
  clearView(); status(error.message || 'Something went wrong.');
}

function showLink() {
  clearInterval(liveTimer); clearView(); resetTerminal();
  $('control').hidden = true; $('link').hidden = false;
}

async function refreshView() {
  if (busy) return;
  const gen = generation; busy = true;
  try { await view(); }
  catch (error) { if (gen === generation) failed(error); }
  finally { if (gen === generation) busy = false; }
}

function live() {
  clearInterval(liveTimer);
  liveTimer = setInterval(() => {
    if (!$('browserPanel').hidden && $('live').checked && !busy && document.visibilityState === 'visible') {
      refreshView();
    }
  }, LIVE_MS);
}

async function connect() {
  actionError = '';
  $('link').hidden = true; $('control').hidden = false;
  status('Connecting to Kitsuvo…');
  await initialize();
  const computer = await remoteApi('/remote/computer');
  $('computer').textContent = `Connected computer: ${computer.name}`;
  terminalAvailable = computer.terminal;
  $('requestTerminal').disabled = !terminalAvailable;
  if (!terminalAvailable) $('terminalStatus').textContent = 'Remote terminal is unavailable on this computer. Use the current desktop app with Developer tools enabled.';
  await view();
  live();
}

function wire() {
  $('chooseBrowser').onclick = () => choose('browser');
  $('chooseTerminal').onclick = () => choose('terminal');
  $('requestTerminal').onclick = () => requestTerminal().catch(terminalFailed);
  $('stopTerminal').onclick = () => endTerminal().catch(terminalFailed);
  $('interruptTerminal').onclick = () => sendInput('\x03');
  $('start').onclick = () => startLink().catch(failed);
  $('navigate').onsubmit = event => {
    event.preventDefault();
    let url = $('url').value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    act('browser_navigate', { url, output: 'none' });
  };
  for (const button of document.querySelectorAll('[data-tool]')) button.onclick = () => act(button.dataset.tool, { output: 'none' });
  for (const button of document.querySelectorAll('[data-key]')) button.onclick = () => act('browser_press_key', { key: button.dataset.key, output: 'none' });
  $('refresh').onclick = refreshView;
  $('view').onclick = event => {
    if (!hasView || $('view').hidden) return;
    const box = $('view').getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const fy = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    // The screenshot is the viewport, so a fraction of it is a fraction of the viewport.
    act('browser_evaluate', { expression: `(() => { const el = document.elementFromPoint(${fx} * innerWidth, ${fy} * innerHeight); if (!el) return null; el.focus?.(); el.click(); return el.tagName; })()` });
  };
  $('signout').onclick = async () => {
    // Local unlink must not wait for an offline or stalled terminal host.
    endTerminal().catch(() => {});
    const refreshToken = store.getItem('refresh');
    forget(); status('This device is unlinked.');
    if (refreshToken) await fetch('/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken, client_id: store.getItem('client_id') || '' }) }).catch(() => {});

  };
}

// ---- Separately approved human terminal (never MCP tools) ----

async function remoteApi(path, body, retry = true, keepalive = false) {
  const gen = generation;
  const response = await fetch(path, { method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${store.getItem('access') || ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), keepalive });
  if (gen !== generation) throw new LinkLost();
  if (response.status === 401 && retry) {
    const refreshed = await refresh();
    if (gen !== generation) throw new LinkLost();
    if (refreshed) return remoteApi(path, body, false, keepalive);
  }
  if (response.status === 401) { forget(); throw new LinkLost(); }
  const data = await response.json().catch(() => ({}));
  if (gen !== generation) throw new LinkLost();
  if (!response.ok) throw new Error(data.error || 'The connected computer is unavailable.');
  return data;
}

function choose(kind) {
  $('browserPanel').hidden = kind !== 'browser';
  $('terminalPanel').hidden = kind !== 'terminal';
  $('chooseBrowser').setAttribute('aria-pressed', String(kind === 'browser'));
  $('chooseTerminal').setAttribute('aria-pressed', String(kind === 'terminal'));
  if (kind === 'terminal') {
    if (!term) {
      // xterm creates two style elements. Its supported documentOverride keeps
      // those styles under this response's nonce without allowing inline scripts
      // or weakening CSP for arbitrary styles. Bind native Document methods.
      const terminalDocument = new Proxy(document, { get(target, key) {
        if (key === 'createElement') return (...args) => {
          const node = target.createElement(...args);
          if (args[0].toLowerCase() === 'style') node.nonce = document.querySelector('meta[name=terminal-style-nonce]').content;
          return node;
        };
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      term = new Terminal({ documentOverride: terminalDocument, linkHandler: { activate() {} }, cursorBlink: true, scrollback: 2000, fontSize: 14, allowProposedApi: false, screenReaderMode: true });
      fit = new FitAddon.FitAddon(); term.loadAddon(fit); term.open($('terminalScreen'));
      // No link provider or clipboard escape handler is installed.
      term.onData(data => { if (terminalState === 'running') sendInput(data); });
      new ResizeObserver(() => resizeTerminal()).observe($('terminalScreen'));
    }
    resizeTerminal(); term.focus();
  }
}

function resizeTerminal() {
  if (!term || $('terminalPanel').hidden) return;
  fit.fit();
  const id = terminalSession;
  if (terminalState === 'running') remoteApi('/remote/terminal', { action: 'resize', session: id,
    rows: Math.min(200, Math.max(2, term.rows)), cols: Math.min(400, Math.max(10, term.cols)) })
    .catch(error => { if (terminalSession === id) terminalFailed(error); });
}

function resetTerminal() {
  terminalEpoch++; clearTimeout(terminalTimer); terminalPolling = false; terminalSession = null; terminalState = 'closed';
  $('terminalStatus').textContent = 'Terminal session ended.';
  $('stopTerminal').disabled = true; $('interruptTerminal').disabled = true;
  $('requestTerminal').disabled = !terminalAvailable;
  term?.reset();
}

function renderTerminal(result) {
  const before = terminalState;
  terminalState = result.state;
  if (result.data) term?.write(Uint8Array.from(atob(result.data), c => c.charCodeAt(0)));
  $('terminalStatus').textContent = terminalState === 'pending' ? 'Waiting for someone at the connected computer to choose a folder and approve…'
    : terminalState === 'running' ? 'Terminal connected. End the session here or on the host computer to stop the shell.'
    : terminalState === 'rejected' ? 'The host declined or stopped this terminal session.' : 'Terminal session ended.';
  const active = ['pending', 'running'].includes(terminalState);
  $('requestTerminal').disabled = active || !terminalAvailable;
  $('stopTerminal').disabled = !active; $('interruptTerminal').disabled = terminalState !== 'running';
  if (before !== 'running' && terminalState === 'running') { resizeTerminal(); term?.focus(); }
  if (!active) { terminalSession = null; clearTimeout(terminalTimer); }
}

async function requestTerminal() {
  choose('terminal'); resetTerminal(); $('requestTerminal').disabled = true;
  $('stopTerminal').disabled = false;
  const gen = generation, epoch = terminalEpoch;
  term.reset();
  try {
    const result = await remoteApi('/remote/terminal', { action: 'request' });
    if (gen !== generation) return;
    if (epoch !== terminalEpoch) {
      // The user stopped before the host returned its session ID.
      if (result.session) remoteApi('/remote/terminal', { action:'stop', session:result.session }).catch(() => {});
      return;
    }
    terminalSession = result.session; renderTerminal(result); scheduleTerminalPoll();
  } catch (error) { if (gen === generation && epoch === terminalEpoch) { $('requestTerminal').disabled = !terminalAvailable; throw error; } }
}

function scheduleTerminalPoll() {
  clearTimeout(terminalTimer);
  if (!terminalSession) return;
  terminalTimer = setTimeout(async () => {
    if (terminalPolling || !terminalSession) return;
    const id = terminalSession, epoch = terminalEpoch; terminalPolling = true;
    try {
      const result = await remoteApi('/remote/terminal', { action: 'poll', session: id });
      if (terminalSession === id) renderTerminal(result);
    } catch (error) { if (terminalSession === id) terminalFailed(error); }
    finally { if (epoch === terminalEpoch) { terminalPolling = false; scheduleTerminalPoll(); } }
  }, 350);
}

function sendInput(data) {
  if (!terminalSession || terminalState !== 'running') return;
  if (new TextEncoder().encode(data).length > 8192 || queuedInput >= 8) {
    $('terminalStatus').textContent = 'Input is too large or busy. Paste a smaller section.'; return;
  }
  const id = terminalSession; queuedInput++;
  inputQueue = inputQueue.then(async () => {
    if (terminalSession === id && terminalState === 'running') await remoteApi('/remote/terminal', { action: 'input', session: id, data });
  }).catch(error => { if (terminalSession === id) terminalFailed(error); }).finally(() => { queuedInput--; });
}

async function endTerminal() {
  const id = terminalSession, gen = generation;
  // Clear locally first so an in-flight poll cannot restore the session.
  resetTerminal();
  const epoch = terminalEpoch;
  try { if (id) await remoteApi('/remote/terminal', { action: 'stop', session: id }); }
  catch (error) { if (gen === generation && epoch === terminalEpoch) throw error; }
}

function terminalFailed(error) {
  resetTerminal();
  $('terminalStatus').textContent = error.message || 'Terminal disconnected. Request a new session to reconnect.';
  if (error instanceof LinkLost) failed(error);
}

// Best-effort stop; native and relay leases also stop the PTY if the tab or
// network disappears before this request arrives. Never resume a shell on reload.
addEventListener('pagehide', () => {
  if (terminalSession) remoteApi('/remote/terminal', { action: 'stop', session: terminalSession }, false, true).catch(() => {});
});

async function main() {
  wire();
  const params = new URLSearchParams(location.search);
  try {
    if (params.has('error')) { history.replaceState(null, '', '/remote'); throw new Error('Linking was cancelled.'); }
    if (params.has('code')) await finishLink(params);
    if (store.getItem('access')) await connect();
    else { showLink(); status('Not linked yet.'); }
  } catch (error) {
    if (!store.getItem('access')) showLink();
    failed(error);
  }
}

main();
