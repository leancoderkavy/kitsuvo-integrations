// Crash-consistency and ordering of the relay's asynchronous authorization
// store writes. The store's `io` is wrapped to record, hold or "crash" at each
// filesystem step; a crash is simulated by abandoning the write at that step
// and loading a fresh store from whatever is on disk, as a restarted relay would.
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { durableStore } from '../durable-store.mjs';

const origin = 'https://relay.example';
const hex = c => c.repeat(64), id = c => c.repeat(43);
const later = () => Math.floor(Date.now() / 1000) + 3600;
const identity = (key, browser) => [hex(key), { browserId: id(browser), expiresAt: later() }];
const token = (key, browser, grant = 'g') => [hex(key), { clientId: id('c'), browserId: id(browser), grantId: id(grant), kind: 'refresh', expiresAt: later() }];

async function directory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'kitsuvo-durable-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, 'state.json') };
}
const onDisk = async file => JSON.parse(await readFile(file, 'utf8'));

// Wraps node:fs/promises. `log` records each step in order. `gate(step)` may
// return a promise to hold the write at that step, or throw to crash it there.
function recorder(gate = () => {}) {
  const log = [];
  const step = async (name, ...detail) => { log.push([name, ...detail]); await gate(name, ...detail); };
  const io = {
    async mkdir(...args) { await step('mkdir'); return fsp.mkdir(...args); },
    async open(file, flags, mode) {
      const kind = flags === 'wx' ? 'temp' : 'dir';
      await step('open-' + kind);
      const handle = await fsp.open(file, flags, mode);
      return {
        async writeFile(data) { await step('write-' + kind); return handle.writeFile(data); },
        async sync() { await step('fsync-' + kind); return handle.sync(); },
        async close() { log.push(['close-' + kind]); return handle.close(); },
      };
    },
    async rename(from, to) { await step('rename'); return fsp.rename(from, to); },
    async chmod(...args) { await step('chmod'); return fsp.chmod(...args); },
    async rm(...args) { log.push(['rm']); return fsp.rm(...args); },
  };
  return { io, log, names: () => log.map(([name]) => name) };
}

test('a durable write fsyncs the complete temporary file before the rename and the directory before resolving', async t => {
  const { file } = await directory(t);
  const r = recorder();
  const store = durableStore(file, origin, {}, { io: r.io });
  store.identities.set(...identity('a', 'b'));
  await store.persist().then(() => r.log.push(['resolved']));
  assert.deepEqual(r.names(), ['mkdir', 'open-temp', 'write-temp', 'fsync-temp', 'close-temp', 'rename', 'chmod', 'open-dir', 'fsync-dir', 'close-dir', 'resolved']);
  assert.equal((await onDisk(file)).identities.length, 1);
});

test('a crash at any step of a write leaves the old or the new document, never a partial one', async t => {
  const steps = ['mkdir', 'open-temp', 'write-temp', 'fsync-temp', 'rename', 'chmod', 'open-dir', 'fsync-dir'];
  for (const crashAt of steps) {
    const { dir, file } = await directory(t);
    const store = durableStore(file, origin);
    store.identities.set(...identity('a', 'b')); store.tokens.set(...token('1', 'b'));
    await store.persist();
    const before = await readFile(file, 'utf8');
    // The crashing write adds a second connector and revokes the first token.
    const crashing = durableStore(file, origin, {}, { io: recorder(name => { if (name === crashAt) throw Object.assign(new Error('crash'), { code: 'ECRASH' }); }).io });
    crashing.identities.set(...identity('d', 'e')); crashing.tokens.delete(hex('1'));
    t.mock.method(console, 'error', () => {});
    await assert.rejects(crashing.persist(), /unavailable/);
    t.mock.restoreAll();
    const after = await readFile(file, 'utf8');
    const restarted = durableStore(file, origin);
    assert.ok(after === before || JSON.parse(after).identities.length === 2, `crash at ${crashAt}`);
    // A step after the rename (chmod, directory fsync) may already have replaced it.
    if (steps.indexOf(crashAt) < steps.indexOf('rename')) assert.equal(after, before, `crash at ${crashAt} keeps the old document`);
    assert.ok(restarted.identities.size >= 1);
    assert.deepEqual((await readdir(dir)).sort(), ['state.json'], `crash at ${crashAt} leaves no temporary file behind`);
  }
});

test('an orphaned temporary file from a crash between write and rename is removed at startup and never loaded', async t => {
  const { dir, file } = await directory(t);
  const store = durableStore(file, origin);
  store.identities.set(...identity('a', 'b')); await store.persist();
  let release; const held = new Promise(resolve => { release = resolve; });
  // Hold the second write after its temporary file is fsynced; the "crash" is
  // starting a new store while it is held.
  const writer = durableStore(file, origin, {}, { io: recorder(name => name === 'rename' ? held : undefined).io });
  writer.identities.clear();
  const pending = writer.persist();
  for (let i = 0; i < 50 && (await readdir(dir)).length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await readdir(dir)).length, 2, 'the complete temporary file exists before the rename');
  const restarted = durableStore(file, origin);
  assert.equal(restarted.identities.size, 1, 'the store loads the last renamed document');
  assert.deepEqual(await readdir(dir), ['state.json']);
  release(); t.mock.method(console, 'error', () => {});
  await assert.rejects(pending, /unavailable/, 'the abandoned write cannot complete');
});

test('writes never overlap and bursts coalesce; every caller resolves only after a document with its mutation is durable', async t => {
  const { file } = await directory(t);
  let release; const held = new Promise(resolve => { release = resolve; });
  let hold = true;
  const r = recorder(name => name === 'rename' && hold ? (hold = false, held) : undefined);
  const store = durableStore(file, origin, {}, { io: r.io });
  const resolved = [];
  store.identities.set(...identity('a', 'a'));
  const first = store.persist().then(async () => resolved.push(['first', (await onDisk(file)).identities.length]));
  // Mutations while the first write is held at its rename share one follow-up write.
  store.identities.set(...identity('b', 'b'));
  const second = store.persist().then(async () => resolved.push(['second', (await onDisk(file)).identities.length]));
  store.identities.set(...identity('c', 'c'));
  const third = store.persist().then(async () => resolved.push(['third', (await onDisk(file)).identities.length]));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(resolved, [], 'nothing is acknowledged while the write is held');
  assert.equal(r.names().filter(name => name === 'open-temp').length, 1, 'the follow-up does not start while a write runs');
  release();
  await Promise.all([first, second, third]);
  assert.equal(r.names().filter(name => name === 'rename').length, 2, 'three persists, two writes');
  assert.deepEqual(resolved.map(([name]) => name), ['first', 'second', 'third']);
  assert.ok(resolved[0][1] >= 1);
  assert.equal(resolved[1][1], 3); assert.equal(resolved[2][1], 3);
  assert.equal((await onDisk(file)).identities.length, 3, 'the older snapshot never lands after the newer one');
});

test('a revocation made while an issue write is in flight is acknowledged only once it is durable', async t => {
  const { file } = await directory(t);
  let release; const held = new Promise(resolve => { release = resolve; });
  let hold = true;
  const store = durableStore(file, origin, {}, { io: recorder(name => name === 'fsync-temp' && hold ? (hold = false, held) : undefined).io });
  store.identities.set(...identity('a', 'b'));
  store.tokens.set(...token('1', 'b'));
  const issued = store.persist();
  // Revoke the token before the issuing write has finished.
  store.tokens.delete(hex('1'));
  let acknowledged = false;
  const revoked = store.persist().then(async () => { acknowledged = true; return onDisk(file); });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(acknowledged, false);
  release();
  await issued;
  const state = await revoked;
  assert.deepEqual(state.tokens, [], 'at acknowledgement the revoked token is gone from disk');
  assert.deepEqual(durableStore(file, origin).tokens.size, 0, 'and stays revoked after a restart');
});

test('a failed follow-up write rejects every caller that shared it and closes authorization until a write succeeds', async t => {
  const { file } = await directory(t);
  let release; const held = new Promise(resolve => { release = resolve; });
  let calls = 0;
  t.mock.method(console, 'error', () => {});
  const store = durableStore(file, origin, {}, { io: recorder(name => {
    if (name !== 'rename') return;
    calls += 1;
    if (calls === 1) return held;
    if (calls === 2) throw Object.assign(new Error('full'), { code: 'ENOSPC' });
  }).io });
  store.identities.set(...identity('a', 'a'));
  const first = store.persist();
  store.identities.set(...identity('b', 'b'));
  const second = store.persist(), third = store.persist();
  release();
  await first;
  await assert.rejects(second, /unavailable/);
  await assert.rejects(third, /unavailable/);
  assert.throws(() => store.check(), /unavailable/);
  await store.persist();
  store.check();
  assert.equal((await onDisk(file)).identities.length, 2);
});

test('flush waits for a write in flight and then writes the latest state', async t => {
  const { file } = await directory(t);
  let release; const held = new Promise(resolve => { release = resolve; });
  let hold = true;
  const store = durableStore(file, origin, {}, { io: recorder(name => name === 'rename' && hold ? (hold = false, held) : undefined).io });
  store.identities.set(...identity('a', 'a'));
  const first = store.persist();
  store.identities.set(...identity('b', 'b'));
  const flushed = store.flush();
  release();
  await Promise.all([first, flushed]);
  assert.equal((await onDisk(file)).identities.length, 2);
});
