import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationQueue } from '../operation-queue.mjs';

test('expired relay work cannot dispatch while the event loop delays deadline timers', async () => {
  const queue = operationQueue(), effects = [];
  const first = queue.run(() => {
    const until = performance.now() + 25;
    while (performance.now() < until) { /* simulate a busy connector */ }
  });
  const stale = queue.run(() => effects.push('stale mutation'), { timeoutMs: 5 });
  await assert.rejects(stale, /deadline/);
  await first;
  assert.deepEqual(effects, []);
  assert.equal(await queue.run(() => 'ready'), 'ready');
  queue.close();
});

test('connector hops cannot renew an expired budget before its timer runs', async () => {
  const queue = operationQueue(); let dispatched = false;
  await assert.rejects(queue.run((signal, remainingMs) => {
    const until = performance.now() + 25;
    while (performance.now() < until) { /* delay timer delivery */ }
    remainingMs(); dispatched = true;
  }, { timeoutMs: 5 }), /deadline/);
  assert.equal(dispatched, false);
  queue.close();
});
