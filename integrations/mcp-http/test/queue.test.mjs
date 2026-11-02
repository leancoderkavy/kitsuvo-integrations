import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationQueue } from '../operation-queue.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('expired queued work cannot dispatch while the event loop delays deadline timers', async () => {
  const queue = operationQueue(), effects = [];
  const first = queue.run(() => {
    // Synchronous work blocks timers, but the pump resumes via microtasks.
    const until = performance.now() + 25;
    while (performance.now() < until) { /* simulate a busy native adapter */ }
  });
  const stale = queue.run(() => effects.push('stale mutation'), { timeoutMs: 5 });
  await assert.rejects(stale, /deadline/);
  await first;
  assert.deepEqual(effects, []);
  assert.equal(await queue.run(() => 'ready'), 'ready');
  queue.close();
});

test('queued deadlines include time spent behind a running mutation', async () => {
  const queue = operationQueue(2), events = [];
  const first = queue.run(async () => { events.push('first'); await delay(80); });
  const second = queue.run(() => events.push('stale'), { timeoutMs: 15 });
  await assert.rejects(second, /deadline/);
  assert.equal(await queue.run(() => "replacement"), "replacement");
  await first; await delay(5);
  assert.deepEqual(events, ['first']);
});

test('multi-hop operations cannot renew an expired budget before its timer runs', async () => {
  const queue = operationQueue(); let dispatched = false;
  await assert.rejects(queue.run((signal, remainingMs) => {
    const until = performance.now() + 25;
    while (performance.now() < until) { /* delay timer delivery */ }
    remainingMs(); dispatched = true;
  }, { timeoutMs: 5 }), /deadline/);
  assert.equal(dispatched, false);
  queue.close();
});

test('cancellation aborts running work and never executes queued work', async () => {
  const queue = operationQueue(), controller = new AbortController();
  const first = queue.run(signal => new Promise(resolve => signal.addEventListener('abort', resolve)));
  let executed = false;
  const second = queue.run(() => { executed = true; }, { signal: controller.signal });
  controller.abort(); await assert.rejects(second, /cancelled|aborted/i);
  queue.close(); await assert.rejects(first, /closed/);
  await delay(5); assert.equal(executed, false); assert.equal(queue.pending, 0);
});

test('timing out a non-cancellable mutation does not permit overlapping mutations', async () => {
  const queue = operationQueue(), events = [];
  const first = queue.run(async () => { events.push('start'); await delay(50); events.push('end'); }, { timeoutMs: 10 });
  const second = queue.run(() => events.push('next'));
  await assert.rejects(first, /may have completed/); await second;
  assert.deepEqual(events, ['start', 'end', 'next']);
});

test('closing the queue clears the active operation deadline timer', async () => {
  const timers = () => process.getActiveResourcesInfo().filter(name => name === 'Timeout').length;
  const before = timers();
  const queue = operationQueue(4, 180000);
  let started; const began = new Promise(resolve => started = resolve);
  const active = queue.run(() => { started(); return new Promise(() => {}); }).catch(error => error.message);
  await began;
  assert.ok(timers() > before);
  queue.close();
  assert.equal(await active, 'MCP session closed.');
  assert.equal(timers(), before, 'no three-minute timer keeps the process alive');
});
