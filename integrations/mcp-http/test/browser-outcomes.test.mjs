import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callBrowserApp } from '../browser-app.mjs';

const receipt = { operation: 'type', execution: 'acknowledged', task_outcome: 'unverified', observation: 'observed', retry: 'inspect_before_retry' };
const text = value => ({ content: [{ type: 'text', text: value }] });
function fixture() {
  let document = 'doc-a', unreadable = false;
  const calls = [];
  return { calls, changeDocument() { document = 'doc-b'; }, blockRead() { unreadable = true; },
    async callTool({ name, arguments: args }) {
      calls.push({ name, args });
      if (name === 'browser_snapshot') return unreadable ? { ...text('Sensitive page refused'), isError: true }
        : text(`Page: https://example.com/\nTitle: Fixture\nTab: 1\nDocument: ${document}\n- textbox "Name" [ref=e1]`);
      if (name === 'browser_tabs') return text('- tab 1 [selected for this session]: Fixture (https://example.com/)');
      if (name === 'browser_take_screenshot') return { content: [{ type: 'image', mimeType: 'image/png', data: 'cG5n' }] };
      if (name === 'browser_type') return { ...text('Typed into Name'), isError: false, structuredContent: { schema_version: 1, action_receipt: receipt } };
      throw Error(`Unexpected tool: ${name}`);
    },
  };
}

test('panels preserve action receipts without upgrading a UI observation to completion', async () => {
  const backend = fixture();
  const result = await callBrowserApp(backend, 'kitsuvo_browser_action', { action: 'type', tab: 1, ref: 'e1', text: 'Ada' });
  assert.deepEqual(result.structuredContent.action_receipt, receipt);
  assert.match(result.content[0].text, /unverified/);
  assert.equal(result.isError, false);
});

test('a read failure after acknowledged input retains the receipt and never replays input', async () => {
  const backend = fixture(); backend.blockRead();
  const result = await callBrowserApp(backend, 'kitsuvo_browser_action', { action: 'type', tab: 1, ref: 'e1', text: 'Ada', submit: true });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent.action_receipt, receipt);
  assert.equal(backend.calls.filter(call => call.name === 'browser_type').length, 1);
  assert.ok(!backend.calls.some(call => call.name === 'browser_take_screenshot'));
});

test('each panel forwards the document it observed even if another panel refreshed the same tab', async () => {
  const backend = fixture();
  const first = (await callBrowserApp(backend, 'kitsuvo_browser', { tab: 1 })).structuredContent;
  backend.changeDocument();
  await callBrowserApp(backend, 'kitsuvo_browser', { tab: 1 });
  await callBrowserApp(backend, 'kitsuvo_browser_action', { action: 'type', tab: 1, panelId: first.panelId, ref: 'e1', text: 'Ada' });
  assert.equal(backend.calls.find(call => call.name === 'browser_type').args.document_id, 'doc-a');
});


test('a thrown read error after input retains the acknowledgement', async () => {
  const backend = fixture(), original = backend.callTool;
  backend.callTool = async params => {
    if (params.name === 'browser_snapshot') throw Error('Read connection lost');
    return original(params);
  };
  const result = await callBrowserApp(backend, 'kitsuvo_browser_action', { action: 'type', tab: 1, ref: 'e1', text: 'Ada' });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent.action_receipt, receipt);
  assert.match(result.content[0].text, /Read connection lost/);
  assert.equal(backend.calls.filter(call => call.name === 'browser_type').length, 1);
});

for (const action of ['click', 'type', 'key']) test(`an existing panel cannot redirect ${action} input to a different tab`, async () => {
  const backend = fixture();
  const panel = (await callBrowserApp(backend, 'kitsuvo_browser', { tab: 1 })).structuredContent;
  backend.calls.length = 0;
  const result = await callBrowserApp(backend, 'kitsuvo_browser_action', {
    panelId: panel.panelId, tab: 2, action, ref: 'e1', text: 'Ada', key: 'Enter',
  });
  assert.equal(result.isError, true);
  assert.equal(backend.calls.length, 0, 'stale panel input must not reach any native tool');
});

test('a lost panel context cannot dispatch input just because a tab number is supplied', async () => {
  const backend = fixture();
  const result = await callBrowserApp(backend, 'kitsuvo_browser_action', {
    panelId: '11111111-1111-1111-1111-111111111111', tab: 1, action: 'type', ref: 'e1', text: 'Ada',
  });
  assert.equal(result.isError, true);
  assert.equal(backend.calls.length, 0);
});
