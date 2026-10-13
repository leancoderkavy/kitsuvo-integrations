import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { randomUUID } from 'node:crypto';

// A host can share one MCP connection across chats. Keep each panel's current
// tab separate from that connection's implicit active tab.
const panels = new WeakMap();

export const APP_URI = 'ui://kitsuvo/browser.html';
export const APP_MIME = 'text/html;profile=mcp-app';
const uiMeta = { ui: { resourceUri: APP_URI }, 'ui/resourceUri': APP_URI };
const tab = { type: 'integer', minimum: 0 };
export const appTools = [
  {
    name: 'kitsuvo_browser', title: 'Open Kitsuvo in chat',
    description: 'Open a fresh tab in an embedded Kitsuvo browser panel. Pass tab explicitly only to attach an existing tab. Pages run in the desktop Kitsuvo engine on the connected computer.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, tab }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: uiMeta,
  },
  {
    name: 'kitsuvo_browser_action', title: 'Use browser panel',
    description: 'Controls for the interactive browser panel.',
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: ['refresh', 'fit', 'report', 'navigate', 'back', 'forward', 'reload', 'new', 'close', 'select', 'click', 'hover', 'type', 'option', 'key'] },
      tab, panelId: { type: 'string' }, url: { type: 'string' }, ref: { type: 'string' }, text: { type: 'string' },
      submit: { type: 'boolean' }, values: { type: 'array', items: { type: 'string' } }, key: { type: 'string' },
    }, required: ['action'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    _meta: { ...uiMeta, ui: { resourceUri: APP_URI, visibility: ['app'] } },
  },
];

let htmlPromise;
export function browserHtml() {
  return htmlPromise ??= (async () => {
    const [template, bundle] = await Promise.all([
      readFile(new URL('./ui/browser.html', import.meta.url), 'utf8'),
      build({ entryPoints: [fileURLToPath(new URL('./ui/browser.mjs', import.meta.url))],
        bundle: true, write: false, format: 'iife', minify: true, target: 'es2022' }),
    ]);
    return template.replace('/* BROWSER_APP */', () => bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
  })();
}

function textOf(result) {
  return (result.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');
}

// Only these explicit native tools can be invoked by panel controls. Sensitive
// pages, password fields and Stop continue to be enforced by the native engine.
export async function callBrowserApp(backend, name, args = {}, signal) {
  const call = (name, arguments_) => backend.callTool({ name, arguments: arguments_ }, undefined, { timeout: 180_000, signal });
  const fail = message => ({ content: [{ type: 'text', text: message }], isError: true });
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return fail('Expected an arguments object.');
    if (args.tab !== undefined && (!Number.isInteger(args.tab) || args.tab < 0)) return fail('Invalid tab.');
    if (args.panelId !== undefined && (typeof args.panelId !== 'string' || !/^[0-9a-f-]{36}$/.test(args.panelId))) return fail('Invalid panel ID.');
    let contexts = panels.get(backend);
    if (!contexts) { contexts = new Map(); panels.set(backend, contexts); }
    const panelId = name === 'kitsuvo_browser' ? randomUUID() : args.panelId;
    const context = panelId && contexts.get(panelId);
    const savedTab = context?.tab;
    const owned = new Set(context?.owned ?? []);
    const targetTab = args.action === 'refresh' && savedTab !== undefined ? savedTab : args.tab ?? savedTab;
    let target = targetTab === undefined ? {} : { tab: targetTab };
    let operation;
    let report;
    const recovery = !context && panelId && backend._kitsuvoPanelRecovery?.get(panelId);
    if (name !== 'kitsuvo_browser' && recovery) {
      // Recover only a refresh, never replay an old click/type/submit against
      // reused native IDs or stale element references after a process restart.
      if (args.action !== 'refresh') return fail('Browser restarted. Refresh view before interacting.');
      const opened = await call('browser_tabs', {action:'new', ...(recovery.url === null ? {} : {url:recovery.url})});
      if (opened.isError) return opened;
      const id = textOf(opened).match(/^Opened tab (\d+)\./m)?.[1];
      if (!id) return fail('The browser did not identify the recovered panel tab.');
      target = {tab:Number(id)}; owned.add(target.tab);
    }
    if (name === 'kitsuvo_browser') {
      if (args.url !== undefined && typeof args.url !== 'string') return fail('Missing url.');
      if (args.tab === undefined) {
        const opened = await call('browser_tabs', { action: 'new', ...(args.url === undefined ? {} : { url: args.url }) });
        if (opened.isError) return opened;
        const createdTab = textOf(opened).match(/^Opened tab (\d+)\./m)?.[1];
        if (!createdTab) return fail('The browser did not identify the new panel tab.');
        target = { tab: Number(createdTab) };
        owned.add(target.tab);
      } else if (args.url !== undefined) operation = ['browser_navigate', { ...target, url: args.url }];
    } else {
      const operations = {
        refresh: null,
        fit: ['browser_resize', { ...target, off: true }],
        report: ['kitsuvo_report', target],
        navigate: ['browser_navigate', { ...target, url: args.url }],
        back: ['browser_navigate_back', target], forward: ['browser_navigate_forward', target], reload: ['browser_reload', target],
        new: ['browser_tabs', { action: 'new', ...(args.url === undefined ? {} : { url: args.url }) }],
        close: ['browser_tabs', { ...target, action: 'close' }], select: ['browser_tabs', { ...target, action: 'select' }],
        click: ['browser_click', { ...target, ref: args.ref }], hover: ['browser_hover', { ...target, ref: args.ref }],
        type: ['browser_type', { ...target, ref: args.ref, text: args.text, submit: args.submit ?? false }],
        option: ['browser_select_option', { ...target, ref: args.ref, values: args.values }],
        key: ['browser_press_key', { ...target, key: args.key }],
      };
      if (!Object.hasOwn(operations, args.action)) return fail('Unknown browser action.');
      operation = operations[args.action];
    }
    if (operation) {
      for (const field of ['url', 'ref', 'text', 'key']) {
        if (Object.hasOwn(operation[1], field) && typeof operation[1][field] !== 'string') return fail(`Missing ${field}.`);
      }
      if (args.action === 'select' && args.tab === undefined) return fail('Missing tab.');
      if (args.action === 'option' && (!Array.isArray(args.values) || !args.values.every(value => typeof value === 'string'))) return fail('Missing option values.');
      if (args.submit !== undefined && typeof args.submit !== 'boolean') return fail('Invalid submit flag.');
      const result = await call(...operation);
      if (result.isError) return result;
      if (args.action === 'report') report = textOf(result);
      if (args.action === 'new') {
        const createdTab = textOf(result).match(/^Opened tab (\d+)\./m)?.[1];
        if (!createdTab) return fail('The browser did not identify the new panel tab.');
        target = { tab: Number(createdTab) }; owned.add(target.tab);
      }
      if (args.action === 'close' && panelId) {
        owned.delete(target.tab);
        const available = await call('browser_tabs', { action: 'list' });
        if (available.isError) return available;
        const remaining = new Set([...textOf(available).matchAll(/^- tab (\d+)/gm)].map(m => Number(m[1])));
        const previous = [...owned].reverse().find(id => remaining.has(id));
        if (previous !== undefined) target = { tab: previous };
        else {
          const opened = await call('browser_tabs', { action: 'new' });
          if (opened.isError) return opened;
          const id = textOf(opened).match(/^Opened tab (\d+)\./m)?.[1];
          if (!id) return fail('The browser did not identify the replacement panel tab.');
          target = { tab: Number(id) }; owned.add(target.tab);
        }
      }
    }
    // A close/new/select can change the active tab; do not read the old tab.
    const viewTarget = args.action === 'close' && !panelId ? {} : target;
    const snapshot = await call('browser_snapshot', viewTarget);
    if (snapshot.isError) return snapshot;
    const tabs = await call('browser_tabs', { action: 'list' });
    if (tabs.isError) return tabs;
    const page = textOf(snapshot);
    const state = {
      url: page.match(/^Page: (.*)$/m)?.[1] ?? '',
      title: page.match(/^Title: (.*)$/m)?.[1] ?? 'Kitsuvo',
      snapshot: page,
      tabs: [...textOf(tabs).matchAll(/^- tab (\d+)( \[active\])?: (.*) \((.*)\)$/gm)]
        .map(match => ({ tab: Number(match[1]), active: Boolean(match[2]), title: match[3], url: match[4] })),
      // MCP navigation can select a background tab while the desktop's visible
      // active tab stays unchanged. Controls must follow the observed page.
      tab: page.match(/^Tab: (\d+)$/m) ? Number(page.match(/^Tab: (\d+)$/m)[1]) : viewTarget.tab,
      ...(panelId ? { panelId } : {}),
      ...(report === undefined ? {} : { report }),
    };
    state.tab ??= state.tabs.find(item => item.active)?.tab;
    if (panelId && state.tab !== undefined) {
      owned.add(state.tab);
      contexts.set(panelId, { tab: state.tab, owned });
      await backend._kitsuvoPanelRecovery?.save(panelId, state.url);
    }
    let preview;
    let previewNote;
    try {
      const shot = await call('browser_take_screenshot', viewTarget);
      preview = shot.isError ? undefined : shot.content?.find(item => item.type === 'image' && item.mimeType === 'image/png');
      if (!preview) previewNote = textOf(shot) || 'Page previews are unavailable. Use the page text and controls below.';
    } catch {
      previewNote = 'Page previews are unavailable. Use the page text and controls below.';
    }
    return { content: [{ type: 'text', text: `Kitsuvo browser: ${state.title}\n${state.url}\n\n${state.snapshot}` }],
      structuredContent: state, _meta: { preview, previewNote }, isError: false };
  } catch (error) {
    return fail(error.message);
  }
}
