import { App, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'Kitsuvo browser', version: '0.2.3' }, {});
const $ = id => document.getElementById(id);
let state = {}, busy = false, connected = false, closed = false, generation = 0, hostContext = {};
let seededPanel, restored = false;
const storageKey = id => `kitsuvo-panel-tab:${id}`;
function savedTab(id) {
  try { const raw = localStorage.getItem(storageKey(id)); const tab = Number(raw); return raw !== null && Number.isInteger(tab) && tab >= 0 ? tab : undefined; }
  catch { return undefined; }
}
function setBusy(value) {
  busy = value;
  $('workspace').setAttribute('aria-busy', String(value));
  document.querySelectorAll('button,input,select').forEach(node => { node.disabled = value || !connected; });
  $('fullscreen').hidden = !hostContext.availableDisplayModes?.includes(hostContext.displayMode === 'fullscreen' ? 'inline' : 'fullscreen');
  $('fullscreen').textContent = hostContext.displayMode === 'fullscreen' ? 'Return to chat' : 'Open full browser';
}
const textOf = result => (result.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');
function button(label, accessibleName, action) {
  const node = document.createElement('button');
  node.type = 'button'; node.textContent = label; node.setAttribute('aria-label', accessibleName); node.onclick = action;
  return node;
}
function pageHost(url) {
  try { return new URL(url).host; } catch { return url; }
}
function evidenceSummary(report) {
  if (!report) return '';
  try {
    const value = JSON.parse(report);
    const verdict = value.verdict_label ?? value.verdict ?? value.gate?.replaceAll('_', ' ');
    const score = Number.isFinite(value.score) ? `Score ${value.score}` : '';
    return [score, verdict, value.builder].filter(Boolean).join(' · ');
  } catch { return report.split('\n').find(Boolean)?.slice(0, 240) ?? ''; }
}
function render(result) {
  // Always clear an old preview when the new page cannot be captured.
  if (result.isError) {
    state = { tab: state.tab, panelId: state.panelId };
    $('status').textContent = textOf(result) || 'The browser refused the request.';
    $('preview').hidden = true;
    $('preview').removeAttribute('src');
    $('elements').replaceChildren();
    $('snapshot').textContent = '';
    $('report').textContent = '';
    $('reportBlock').hidden = true;
    $('evidence').hidden = true;
    $('evidenceSummary').textContent = '';
    $('title').textContent = '';
    $('pageMeta').textContent = '';
    $('url').value = '';
    $('tabs').replaceChildren();
    $('previewNote').textContent = '';
    return;
  }
  if (!result.structuredContent?.snapshot) return;
  state = result.structuredContent;
  if (state.panelId && Number.isInteger(state.tab)) {
    try { localStorage.setItem(storageKey(state.panelId), String(state.tab)); } catch { /* Some hosts disable storage. Server context still restores tabs. */ }
  }
  $('url').value = state.url;
  $('title').textContent = state.title;
  $('pageMeta').textContent = [pageHost(state.url), 'Separate agent profile'].filter(Boolean).join(' · ');
  $('snapshot').textContent = state.snapshot;
  $('report').textContent = state.report ?? '';
  $('reportBlock').hidden = !state.report;
  $('evidence').hidden = !state.report;
  $('evidenceSummary').textContent = evidenceSummary(state.report);
  $('tabs').replaceChildren(...state.tabs.map(tab => {
    const option = document.createElement('option');
    option.value = tab.tab; option.textContent = `${tab.tab}: ${tab.title}`; option.selected = tab.tab === state.tab;
    return option;
  }));
  const preview = result._meta?.preview;
  $('preview').hidden = !preview;
  if (preview?.mimeType === 'image/png') $('preview').src = `data:image/png;base64,${preview.data}`;
  else $('preview').removeAttribute('src');
  // Keep the page in focus; expose the single interaction fallback when no image is available.
  if (!preview) $('inspector').open = true;
  $('previewNote').textContent = result._meta?.previewNote ?? 'Live preview from the separate Kitsuvo agent profile.';
  $('elements').replaceChildren();
  // Page content is untrusted: construct DOM nodes, never insert page HTML.
  for (const line of state.snapshot.split('\n')) {
    const match = line.match(/^\s*-\s+(\S+).*?\[ref=(e\d+)\]/);
    if (!match) continue;
    const [, role, ref] = match;
    const row = document.createElement('div'); row.className = 'element';
    const label = document.createElement('span'); label.textContent = line.trim().replace(/^-\s+/, '').replace(/\s*\[ref=e\d+\]/, '');
    const target = label.textContent;
    row.append(label);
    row.append(button('Click', `Click ${target}`, () => act('click', { ref })), button('Hover', `Hover over ${target}`, () => act('hover', { ref })));
    if (['textbox', 'searchbox', 'spinbutton', 'combobox'].includes(role)) {
      const input = document.createElement('input'); input.setAttribute('aria-label', `Value for ${label.textContent}`);
      if (role === 'combobox') {
        row.append(input, button('Select', `Select value for ${target}`, () => act('option', { ref, values: [input.value] })));
      } else {
        row.append(input, button('Type', `Type in ${target}`, () => act('type', { ref, text: input.value })),
          button('Submit', `Submit ${target}`, () => act('type', { ref, text: input.value, submit: true })));
        input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); void act('type', { ref, text: input.value, submit: true }); } };
      }
    }
    $('elements').append(row);
  }
  if (!$('elements').children.length) $('elements').textContent = 'No page controls available. Review the raw page text, or sign in directly in the Kitsuvo window if needed.';
  $('status').textContent = 'Browser ready';
  $('connection').textContent = 'Connected';
  $('connection').setAttribute('data-ready', 'true');
  setBusy(busy);
}
async function act(action, args = {}) {
  if (busy || !connected) return;
  setBusy(true); $('status').textContent = 'Updating browser…';
  const current = ++generation;
  try {
    const result = await app.callServerTool({ name: 'kitsuvo_browser_action', arguments: {
      action, ...(state.tab === undefined ? {} : { tab: state.tab }), ...args,
      ...(state.panelId ? { panelId: state.panelId } : {}),
    } });
    if (generation === current) render(result);
  } catch (error) {
    if (generation === current) render({ isError: true, content: [{ type: 'text', text: error.message }] });
  } finally { if (generation === current) setBusy(false); }
}
const navigate = () => { void act('navigate', { url: $('url').value }); };
// Embedded hosts deliberately omit allow-forms. Trigger RPC directly so the
// sandbox can keep blocking native form submission and document navigation.
$('go').onclick = navigate;
$('url').onkeydown = event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); navigate(); } };
$('navigate').onsubmit = event => { event.preventDefault(); navigate(); };
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
async function restore() {
  if (closed || !connected || restored || !state.snapshot) return;
  restored = true;
  await act('refresh');
}
app.ontoolresult = result => {
  if (closed) return;
  const identity = result.structuredContent?.panelId ?? result.structuredContent?.tab;
  // Hosts replay the original result when a chat remounts, and sometimes after
  // live actions. Seed once, then read the actual tab; never replay stale data.
  if (seededPanel !== undefined && identity === seededPanel) return;
  seededPanel = identity; restored = false;
  const tab = result.structuredContent?.panelId && savedTab(result.structuredContent.panelId);
  generation++; setBusy(false);
  render(tab === undefined ? result : { ...result, structuredContent: { ...result.structuredContent, tab } });
  void restore();
};
app.ontoolcancelled = () => { if (closed) return; generation++; setBusy(false); render({ isError: true, content: [{ type: 'text', text: 'Browser request cancelled.' }] }); };
function applyContext(context) {
  hostContext = { ...hostContext, ...context };
  if (context.theme) document.documentElement.style.colorScheme = context.theme;
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  setBusy(busy);
}
app.onhostcontextchanged = applyContext;
app.onteardown = async () => { closed = true; connected = false; generation++; $('connection').textContent = 'Disconnected'; $('connection').setAttribute('data-ready', 'false'); setBusy(false); return {}; };
async function connect() { try {
  await app.connect(); if (closed) return; connected = true;
  const context = app.getHostContext();
  applyContext(context ?? {});
  // Wait for the host's originating tool result so refresh cannot accidentally
  // bind this panel to another chat's active tab.
  await restore();
} catch (error) { $('status').textContent = `Unable to connect: ${error.message}`; } }
void connect();
