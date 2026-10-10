import { App, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'Kitsuvo browser', version: '0.2.3' }, {});
const $ = id => document.getElementById(id);
let state = {}, busy = false, connected = false, closed = false, generation = 0, hostContext = {};
function setBusy(value) {
  busy = value;
  $('workspace').setAttribute('aria-busy', String(value));
  document.querySelectorAll('button,input,select').forEach(node => { node.disabled = value || !connected; });
  $('fullscreen').hidden = !hostContext.availableDisplayModes?.includes(hostContext.displayMode === 'fullscreen' ? 'inline' : 'fullscreen');
  $('fullscreen').textContent = hostContext.displayMode === 'fullscreen' ? 'Collapse' : 'Expand';
}
const textOf = result => (result.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');
function button(label, action) {
  const node = document.createElement('button');
  node.type = 'button'; node.textContent = label; node.onclick = action;
  return node;
}
function render(result) {
  // Always clear an old preview when the new page cannot be captured.
  if (result.isError) {
    state = {};
    $('status').textContent = textOf(result) || 'The browser refused the request.';
    $('preview').hidden = true;
    $('preview').removeAttribute('src');
    $('elements').replaceChildren();
    $('snapshot').textContent = '';
    $('report').textContent = '';
    $('reportPanel').hidden = true;
    $('title').textContent = '';
    $('url').value = '';
    $('tabs').replaceChildren();
    $('previewNote').textContent = '';
    return;
  }
  if (!result.structuredContent?.snapshot) return;
  state = result.structuredContent;
  $('url').value = state.url;
  $('title').textContent = state.title;
  $('snapshot').textContent = state.snapshot;
  $('report').textContent = state.report ?? '';
  $('reportPanel').hidden = !state.report;
  $('reportPanel').open = Boolean(state.report);
  $('tabs').replaceChildren(...state.tabs.map(tab => {
    const option = document.createElement('option');
    option.value = tab.tab; option.textContent = `${tab.tab}: ${tab.title}`; option.selected = tab.tab === state.tab;
    return option;
  }));
  const preview = result._meta?.preview;
  $('preview').hidden = !preview;
  if (preview?.mimeType === 'image/png') $('preview').src = `data:image/png;base64,${preview.data}`;
  else $('preview').removeAttribute('src');
  $('previewNote').textContent = result._meta?.previewNote ?? 'Preview of your desktop browser. Use the controls below to interact.';
  $('elements').replaceChildren();
  // Page content is untrusted: construct DOM nodes, never insert page HTML.
  for (const line of state.snapshot.split('\n')) {
    const match = line.match(/^\s*-\s+(\S+).*?\[ref=(e\d+)\]/);
    if (!match) continue;
    const [, role, ref] = match;
    const row = document.createElement('div'); row.className = 'element';
    const label = document.createElement('span'); label.textContent = line.trim().replace(/\s*\[ref=e\d+\]/, '');
    row.append(label);
    row.append(button('Click', () => act('click', { ref })), button('Hover', () => act('hover', { ref })));
    if (['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(role)) {
      const input = document.createElement('input'); input.setAttribute('aria-label', `Value for ${label.textContent}`);
      if (role === 'combobox') {
        row.append(input, button('Select', () => act('option', { ref, values: [input.value] })));
      } else {
        row.append(input, button('Type', () => act('type', { ref, text: input.value })),
          button('Submit', () => act('type', { ref, text: input.value, submit: true })));
        input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); void act('type', { ref, text: input.value, submit: true }); } };
      }
    }
    $('elements').append(row);
  }
  if (!$('elements').children.length) $('elements').textContent = 'No page controls available. Check page text, or sign in directly in the Kitsuvo window if needed.';
  $('status').textContent = 'Browser ready';
  setBusy(busy);
}
async function act(action, args = {}) {
  if (busy || !connected) return;
  setBusy(true); $('status').textContent = 'Updating browser…';
  const current = ++generation;
  try {
    const result = await app.callServerTool({ name: 'kitsuvo_browser_action', arguments: {
      action, ...(state.tab === undefined ? {} : { tab: state.tab }), ...args,
    } });
    if (generation === current) render(result);
  } catch (error) {
    if (generation === current) render({ isError: true, content: [{ type: 'text', text: error.message }] });
  } finally { if (generation === current) setBusy(false); }
}
$('navigate').onsubmit = event => { event.preventDefault(); void act('navigate', { url: $('url').value }); };
$('tabs').onchange = () => act('select', { tab: Number($('tabs').value) });
document.querySelectorAll('[data-action]').forEach(node => { node.onclick = () => act(node.dataset.action); });
document.querySelectorAll('[data-key]').forEach(node => { node.onclick = () => act('key', { key: node.dataset.key }); });
$('fullscreen').onclick = async () => {
  const mode = hostContext.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  if (!connected || !hostContext.availableDisplayModes?.includes(mode)) return;
  try {
    const result = await app.requestDisplayMode({ mode });
    hostContext.displayMode = result.mode;
    setBusy(busy);
  }
  catch { $('status').textContent = 'Expanded view is unavailable in this client.'; }
};
app.ontoolresult = result => { if (closed) return; generation++; setBusy(false); render(result); };
app.ontoolcancelled = () => { if (closed) return; generation++; setBusy(false); render({ isError: true, content: [{ type: 'text', text: 'Browser request cancelled.' }] }); };
function applyContext(context) {
  hostContext = { ...hostContext, ...context };
  if (context.theme) document.documentElement.style.colorScheme = context.theme;
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  setBusy(busy);
}
app.onhostcontextchanged = applyContext;
app.onteardown = async () => { closed = true; connected = false; generation++; setBusy(false); return {}; };
async function connect() { try {
  await app.connect(); if (closed) return; connected = true;
  const context = app.getHostContext();
  applyContext(context ?? {});
  if (!state.snapshot) await act('refresh');
} catch (error) { $('status').textContent = `Unable to connect: ${error.message}`; } }
void connect();
