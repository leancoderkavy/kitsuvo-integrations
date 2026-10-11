import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationQueue } from '../operation-queue.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('queued deadlines include time spent behind a running mutation', async () => {
  const queue = operationQueue(2), events = [];
  const first = queue.run(async () => { events.push('first'); await delay(80); }, { timeoutMs: 200 });
  const second = queue.run(() => events.push('stale'), { timeoutMs: 15 });
  await assert.rejects(second, /deadline/);
  await assert.rejects(queue.run(() => {}), /full/);
  await first; await delay(5);
  assert.deepEqual(events, ['first']);
});

test('cancellation aborts running work and never executes queued work', async () => {
  const queue = operationQueue(), controller = new AbortController();
  const first = queue.run(signal => new Promise(resolve => signal.addEventListener('abort', resolve)));
  let executed = false;
  const second = queue.run(() => { executed = true; }, { signal: controller.signal });
  controller.abort(); await assert.rejects(second, /cancelled/);
  queue.close(); await assert.rejects(first, /closed/);
  await delay(5); assert.equal(executed, false); assert.equal(queue.pending, 0);
});

test('timing out a non-cancellable mutation does not permit overlapping mutations', async () => {
  const queue = operationQueue(), events = [];
  const first = queue.run(async () => { events.push('start'); await delay(50); events.push('end'); }, { timeoutMs: 10 });
  const second = queue.run(() => events.push('next'), { timeoutMs: 100 });
  await assert.rejects(first, /may have completed/); await second;
  assert.deepEqual(events, ['start', 'end', 'next']);
});
