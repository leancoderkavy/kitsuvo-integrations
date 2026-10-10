import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

export const APP_URI = 'ui://kitsuvo/browser.html';
export const APP_MIME = 'text/html;profile=mcp-app';
const uiMeta = { ui: { resourceUri: APP_URI }, 'ui/resourceUri': APP_URI };
const tab = { type: 'integer', minimum: 0 };
export const appTools = [
  {
    name: 'kitsuvo_browser', title: 'Open Kitsuvo in chat',
    description: 'Open the interactive Kitsuvo browser panel inside ChatGPT or Claude. Optionally navigate to a URL. The desktop Kitsuvo engine must run on the connected computer.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' }, tab }, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: uiMeta,
  },
  {
    name: 'kitsuvo_browser_action', title: 'Use browser panel',
    description: 'Controls for the interactive browser panel.',
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: ['refresh', 'report', 'navigate', 'back', 'forward', 'reload', 'new', 'close', 'select', 'click', 'hover', 'type', 'option', 'key'] },
      tab, url: { type: 'string' }, ref: { type: 'string' }, text: { type: 'string' },
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
export async function callBrowserApp(backend, name, args = {}) {
  const call = (name, arguments_) => backend.callTool({ name, arguments: arguments_ }, undefined, { timeout: 180_000 });
  const fail = message => ({ content: [{ type: 'text', text: message }], isError: true });
  try {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return fail('Expected an arguments object.');
    if (args.tab !== undefined && (!Number.isInteger(args.tab) || args.tab < 0)) return fail('Invalid tab.');
    const target = args.tab === undefined ? {} : { tab: args.tab };
    let operation;
    let report;
    if (name === 'kitsuvo_browser') {
      if (args.url !== undefined) operation = ['browser_navigate', { ...target, url: args.url }];
    } else {
      const operations = {
        refresh: null,
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
    }
    // A close/new/select can change the active tab; do not read the old tab.
    const viewTarget = ['close', 'new', 'select'].includes(args.action) ? {} : target;
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
      tab: viewTarget.tab,
      ...(report === undefined ? {} : { report }),
    };
    state.tab ??= state.tabs.find(item => item.active)?.tab;
    let preview;
    let previewNote;
    try {
      const shot = await call('browser_take_screenshot', viewTarget);
      preview = shot.isError ? undefined : shot.content?.find(item => item.type === 'image' && item.mimeType === 'image/png');
      if (!preview) previewNote = textOf(shot) || 'Page previews are unavailable. Use the page text and controls below.';
    } catch {
      previewNote = 'Page previews are unavailable. Use the page text and controls below.';
    }
    return { content: [{ type: 'text', text: `Kitsuvo browser: ${state.title}\n${state.url}` }],
      structuredContent: state, _meta: { preview, previewNote }, isError: false };
  } catch (error) {
    return fail(error.message);
  }
}
