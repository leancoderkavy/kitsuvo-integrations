import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';

export const BROWSER_RESOURCE_URI = 'ui://kitsuvo/browser.html';
const TOOLS = new Set(['kitsuvo_browser', 'kitsuvo_browser_action']);
const TOUR_KEY = 'kitsuvo.embedded-browser.tour.v1';

// The host supplies an already authorized MCP client. No control tokens or
// network credentials are passed to the iframe, and no arbitrary native tool
// forwarding is installed on its bridge.
export async function mountKitsuvo(container, { client, initialUrl, theme = 'light',
  timeout = 15000, hostInfo = { name: 'Kitsuvo embed host', version: '1.0.0' } } = {}) {
  if (!container?.append || !container.ownerDocument) throw new Error('A DOM container is required.');
  if (typeof client?.readResource !== 'function' || typeof client?.callTool !== 'function') throw new Error('An authorized MCP client is required.');
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('Invalid initialization timeout.');
  if (!['light', 'dark'].includes(theme)) throw new Error('Theme must be light or dark.');
  if (initialUrl !== undefined && typeof initialUrl !== 'string') throw new Error('Initial URL must be a string.');
  const resource = await client.readResource({ uri: BROWSER_RESOURCE_URI });
  const content = resource.contents?.find(item => item.uri === BROWSER_RESOURCE_URI && item.mimeType === 'text/html;profile=mcp-app' && typeof item.text === 'string');
  if (!content) throw new Error('Kitsuvo browser UI resource is unavailable.');
  const doc = container.ownerDocument;
  const frame = doc.createElement('iframe');
  frame.title = 'Kitsuvo browser';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.style.cssText = 'display:block;width:100%;height:100%;min-height:480px;border:0';
  const bridge = new AppBridge(null, hostInfo, { serverTools: {} }, {
    hostContext: { theme, displayMode: 'inline', availableDisplayModes: ['inline'] },
  });
  let disposed = false, timer, queue = Promise.resolve(), guide;
  const enqueue = request => {
    if (disposed) return Promise.reject(new Error('Kitsuvo embed was destroyed.'));
    const work = queue.then(() => {
      if (disposed) throw new Error('Kitsuvo embed was destroyed.');
      return client.callTool(request);
    });
    queue = work.catch(() => {});
    return work;
  };
  bridge.oncalltool = params => {
    if (!TOOLS.has(params.name)) throw new Error('Tool is unavailable to the browser panel.');
    return enqueue(params);
  };
  // Hosts may add their own fullscreen UX around the container. Do not grant
  // fullscreen or top-level navigation permissions implicitly.
  bridge.onrequestdisplaymode = async () => ({ mode: 'inline' });
  const destroy = async () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    guide?.remove();
    try { await bridge.close(); } finally { frame.remove(); }
  };
  const ready = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Kitsuvo panel initialization timed out.')), timeout);
    bridge.oninitialized = () => { clearTimeout(timer); resolve(); };
  });
  // Install the listener before loading srcdoc: even a fast cached resource
  // cannot emit its initialize request before the host is listening.
  container.append(frame);
  try {
    await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
    frame.srcdoc = content.text;
    await ready;
    const action = async (name, args) => {
      const result = await enqueue({ name, arguments: args });
      if (!disposed) await bridge.sendToolResult(result);
      return result;
    };
    if (initialUrl !== undefined) await action('kitsuvo_browser', { url: initialUrl });
    guide = addGuide(container);
    return {
      iframe: frame,
      refresh: () => action('kitsuvo_browser_action', { action: 'refresh' }),
      navigate: url => action('kitsuvo_browser', { url }),
      update: result => disposed ? Promise.reject(new Error('Kitsuvo embed was destroyed.')) : bridge.sendToolResult(result),
      setTheme: next => {
        if (disposed) throw new Error('Kitsuvo embed was destroyed.');
        if (!['light', 'dark'].includes(next)) throw new Error('Theme must be light or dark.');
        return Promise.resolve(bridge.sendHostContextChange({ theme: next }));
      },
      destroy,
    };
  } catch (error) {
    await destroy();
    throw error;
  }
}

function addGuide(container) {
  const doc = container.ownerDocument;
  const root = doc.createElement('div');
  const shadow = root.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>:host{display:block;font:14px system-ui;color:CanvasText}button{font:inherit;padding:7px;margin:3px;cursor:pointer}button:focus-visible{outline:2px solid #ed563b}section{background:Canvas;border:1px solid #8886;border-radius:8px;padding:12px;margin:8px 0}section[hidden]{display:none}p{line-height:1.5;margin:8px 0}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}</style><button id="help" type="button" aria-controls="guide" aria-expanded="false">Browser guide</button><section id="guide" hidden role="region" aria-label="Browser guide"><strong>Browse inside this app</strong><p>Enter a web address and press Go. Pages run in Kitsuvo on your computer. Use Page controls to click or type; use Refresh view after your assistant changes the page. Complete sign-in in the Kitsuvo window.</p><button id="done" type="button">Got it</button><button id="skip" type="button">Skip</button></section>`;
  const section = shadow.querySelector('section');
  const help = shadow.getElementById('help');
  let previous;
  const show = (focus = false) => {
    previous = focus ? help : doc.activeElement;
    section.hidden = false;
    help.setAttribute('aria-expanded', 'true');
    if (focus) shadow.getElementById('done').focus();
  };
  const hide = () => {
    section.hidden = true;
    help.setAttribute('aria-expanded', 'false');
    try { doc.defaultView.localStorage.setItem(TOUR_KEY, 'dismissed'); } catch {}
    if (shadow.activeElement) (previous?.isConnected ? previous : help).focus();
  };
  help.onclick = () => show(true);
  shadow.getElementById('done').onclick = hide;
  shadow.getElementById('skip').onclick = hide;
  shadow.addEventListener('keydown', event => { if (event.key === 'Escape' && !section.hidden) { event.preventDefault(); hide(); } });
  container.prepend(root);
  let visited = false;
  try { visited = doc.defaultView.localStorage.getItem(TOUR_KEY) === 'dismissed'; } catch {}
  // Nonmodal, one-step guide: no focus stealing or consequential action.
  if (!visited) show();
  return root;
}
