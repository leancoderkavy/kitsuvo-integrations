import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFunctionTools } from '../function-tools.mjs';

const definition = { name: 'browser_snapshot', description: 'Read the selected page', inputSchema: {
  type: 'object', properties: { browser: { type: 'string' }, tab: { type: 'number' } }, required: ['browser'] } };
function fixture() {
  const calls = [], tools = [structuredClone(definition)];
  return { calls, tools, async listTools() { return { tools }; }, async callTool(...args) {
    calls.push(args); return { content: [{ type: 'text', text: 'Observed page' }], structuredContent: { title: 'Page' } };
  } };
}
const options = { allowedTools: ['browser_snapshot'], browser: 'task-owned-target', approve: async () => true };
test('function adapters use discovered schemas, bind the exact target and preserve observed results', async () => {
  const client = fixture(), approvals = [];
  const tools = await browserFunctionTools(client, { ...options, approve: async call => { approvals.push(call); call.arguments.browser = 'tampered'; return true; } });
  assert.equal(tools.definitions[0].parameters.properties.browser, undefined);
  assert.equal(tools.openai()[0].type, 'function');
  assert.equal(tools.openai()[0].strict, false, 'preserve native optional arguments rather than requiring every property');
  assert.equal(tools.anthropic()[0].input_schema.type, 'object');
  assert.deepEqual((await tools.call('browser_snapshot', { tab: 2 })).structuredContent, { title: 'Page' });
  assert.equal(client.calls[0][0].arguments.browser, options.browser);
  assert.equal(approvals.length, 1);
  assert.ok(definition.inputSchema.properties.browser, 'original catalog is untouched');
  tools.close(); await assert.rejects(tools.call('browser_snapshot'), /closed/);
});
test('allowlist, target substitution, denial and changed catalogs never dispatch', async () => {
  const client = fixture(), tools = await browserFunctionTools(client, options);
  await assert.rejects(tools.call('browser_type'), /allowlist/);
  await assert.rejects(tools.call('browser_snapshot', { browser: 'other' }), /substitute/);
  const denied = await browserFunctionTools(client, { ...options, approve: async () => false });
  await assert.rejects(denied.call('browser_snapshot'), /not approved/);
  client.tools[0].description = 'A different operation';
  await assert.rejects(tools.call('browser_snapshot'), /contract changed/);
  assert.equal(client.calls.length, 0);
});
test('cancellation, uncertain failures and overlapping calls are never replayed', async () => {
  const client = fixture(); let release;
  client.callTool = async (...args) => { client.calls.push(args); await new Promise(r => release = r); throw new Error('Connection lost; outcome unknown'); };
  const tools = await browserFunctionTools(client, options);
  const first = tools.call('browser_snapshot');
  while (!release) await new Promise(r => setImmediate(r));
  await assert.rejects(tools.call('browser_snapshot'), /active/);
  release(); await assert.rejects(first, /outcome unknown/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(tools.call('browser_snapshot', {}, { signal: abort.signal }), /abort/i);
  assert.equal(client.calls.length, 1);
});
test('missing scope, application approval and invalid deadlines are rejected', async () => {
  for (const change of [{ allowedTools: [] }, { browser: '' }, { approve: undefined }, { timeoutMs: 0 }, { allowedTools: ['unknown'] }])
    await assert.rejects(browserFunctionTools(fixture(), { ...options, ...change }));
});
test('closing while the catalog is being revalidated prevents dispatch', async () => {
  const client = fixture(), tools = await browserFunctionTools(client, options);
  let release, started;
  const checking = new Promise(resolve => { started = resolve; });
  client.listTools = async () => { started(); await new Promise(resolve => { release = resolve; }); return { tools: client.tools }; };
  const pending = tools.call('browser_snapshot');
  await checking;
  tools.close(); release();
  await assert.rejects(pending, /closed/);
  assert.equal(client.calls.length, 0);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function promptly(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Did not settle promptly')), 250);
  })]); } finally { clearTimeout(timer); }
}
test('an expired approval never dispatches, even before deadline timers run', async () => {
  const client = fixture();
  const tools = await browserFunctionTools(client, { ...options, timeoutMs: 10, approve: () => {
    const until = performance.now() + 30;
    while (performance.now() < until) { /* Simulate a blocked application callback. */ }
    return true;
  } });
  await assert.rejects(tools.call('browser_snapshot'), /deadline/i);
  assert.equal(client.calls.length, 0);
});
test('abort during pending approval settles promptly and late approval cannot dispatch', async () => {
  const client = fixture(), approval = deferred(), started = deferred();
  const tools = await browserFunctionTools(client, { ...options, approve: () => { started.resolve(); return approval.promise; } });
  const controller = new AbortController();
  const pending = tools.call('browser_snapshot', {}, { signal: controller.signal });
  await started.promise;
  controller.abort(new Error('Application cancelled'));
  try { await assert.rejects(promptly(pending), /Application cancelled/); }
  finally { approval.resolve(true); }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.calls.length, 0);
});
test('initial discovery and per-call contract checks share bounded deadlines', async () => {
  const client = fixture(), initial = deferred();
  client.listTools = () => initial.promise;
  try { await assert.rejects(promptly(browserFunctionTools(client, { ...options, timeoutMs: 10 })), /deadline/i); }
  finally { initial.resolve({ tools: client.tools }); }
  client.listTools = async () => ({ tools: client.tools });
  const tools = await browserFunctionTools(client, { ...options, timeoutMs: 10 });
  const refresh = deferred();
  client.listTools = () => refresh.promise;
  try { await assert.rejects(promptly(tools.call('browser_snapshot')), /deadline/i); }
  finally { refresh.resolve({ tools: client.tools }); }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.calls.length, 0);
});
test('closing pending approval settles promptly without closing the shared client', async () => {
  const client = fixture(), approval = deferred(), started = deferred(); let clientClosed = false;
  client.close = () => { clientClosed = true; };
  const tools = await browserFunctionTools(client, { ...options, approve: () => { started.resolve(); return approval.promise; } });
  const pending = tools.call('browser_snapshot');
  await started.promise;
  tools.close();
  try { await assert.rejects(promptly(pending), /closed/); }
  finally { approval.resolve(true); }
  assert.equal(clientClosed, false);
  assert.equal(client.calls.length, 0);
});
test('the remaining admission budget reaches the SDK and native queue', async () => {
  const client = fixture(), catalogs = [];
  client.listTools = async (...args) => { catalogs.push(args); return { tools: client.tools }; };
  const tools = await browserFunctionTools(client, { ...options, timeoutMs: 1000, approve: async () => {
    await new Promise(resolve => setTimeout(resolve, 30)); return true;
  } });
  await tools.call('browser_snapshot');
  const [params, , request] = client.calls[0];
  assert.ok(request.timeout > 0 && request.timeout < 990);
  assert.equal(params._meta['kitsuvo/deadlineMs'], request.timeout);
  assert.ok(request.signal instanceof AbortSignal);
  assert.ok(catalogs[0][1].timeout <= 1000);
  assert.ok(catalogs[1][1].timeout < 990);
});
test('aborting dispatched work retains the admission lock until the client settles', async () => {
  const client = fixture(), started = deferred(), result = deferred(); let requestSignal;
  client.callTool = (...args) => { client.calls.push(args); requestSignal = args[2].signal; started.resolve(); return result.promise; };
  const tools = await browserFunctionTools(client, options), controller = new AbortController();
  const pending = tools.call('browser_snapshot', {}, { signal: controller.signal });
  await started.promise;
  controller.abort(new Error('Application cancelled'));
  try {
    await assert.rejects(promptly(pending), /Application cancelled/);
    assert.equal(requestSignal.aborted, true);
    await assert.rejects(tools.call('browser_snapshot'), /active/);
    assert.equal(client.calls.length, 1);
  } finally { result.reject(new Error('Late transport failure; outcome unknown')); }
  await new Promise(resolve => setImmediate(resolve));
  client.callTool = fixture().callTool;
  await tools.call('browser_snapshot');
});
test('deadline during dispatched work returns promptly but retains admission until settlement', async t => {
  // Expire only after dispatch; a busy host may consume a real 10 ms budget
  // during approval/catalog work, correctly leaving no dispatched request.
  let clock = 0;
  t.mock.method(performance, 'now', () => clock);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = fixture(), result = deferred(), started = deferred(); let requestSignal;
  client.callTool = (...args) => { client.calls.push(args); requestSignal = args[2].signal; started.resolve(); return result.promise; };
  const tools = await browserFunctionTools(client, { ...options, timeoutMs: 10 });
  const pending = tools.call('browser_snapshot');
  const rejected = assert.rejects(pending, /deadline/i);
  try {
    await started.promise;
    clock = 11; t.mock.timers.tick(11);
    await rejected;
    assert.equal(requestSignal.aborted, true);
    await assert.rejects(tools.call('browser_snapshot'), /active/);
    assert.equal(client.calls.length, 1);
  } finally { result.resolve({ content: [] }); }
  await new Promise(resolve => setImmediate(resolve));
  client.callTool = fixture().callTool;
  await tools.call('browser_snapshot');
});
test('close during catalog checking rejects before a non-cooperative catalog settles', async () => {
  const client = fixture(), tools = await browserFunctionTools(client, options);
  const catalog = deferred(), started = deferred();
  client.listTools = () => { started.resolve(); return catalog.promise; };
  const pending = tools.call('browser_snapshot');
  await started.promise;
  tools.close();
  try { await assert.rejects(promptly(pending), /closed/); }
  finally { catalog.reject(new Error('Late catalog failure')); }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.calls.length, 0);
});
