import { readFileSync, readdirSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, chmodSync, statSync, rmSync, promises } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Connector and bearer token secrets are hashed. Client registration metadata
// remains private, including SDK-issued confidential client credentials. Bind the file
// to its issuer; a corrupt or unavailable store must never reset approvals.
export function durableStore(file, origin, capacity = {}, { io = promises, now = () => Date.now() } = {}) {
  const clients = new Map(), tokens = new Map(), identities = new Map();
  const maximum = { clients: 500, tokens: 500, identities: 500, ...capacity };
  // Only the last successfully written document is kept, to skip no-op rewrites.
  // `io` is node:fs/promises; tests inject it to check crash-consistency order.
  // `now` (epoch ms) decides which persisted records have expired at load.
  let failed = false, attempted = 0, written;
  // Temporary files hold private registrations. A crash between write and
  // rename leaves one behind; a failed write (for example a full volume) must
  // not leave another on every retry.
  if (file) try {
    const base = path.basename(file) + '.';
    for (const name of readdirSync(path.dirname(file))) {
      if (name.startsWith(base) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(name.slice(base.length))) rmSync(path.join(path.dirname(file), name), { force: true });
    }
  } catch {}
  if (file) {
    let data;
    try { if (statSync(file).size > 4 * 1024 * 1024) throw new Error('State too large'); data = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid relay authorization store'); }
    if (data) {
      if (data.version !== 1 || data.origin !== origin) throw new Error('Invalid relay authorization store');
      for (const [name, map] of Object.entries({clients, tokens, identities})) {
        if (!Array.isArray(data[name]) || data[name].length > maximum[name]) throw new Error('Invalid relay authorization store');
        for (const entry of data[name]) {
          if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Invalid relay authorization store');
          const [key, value] = entry;
          if (typeof key !== 'string' || !value || !Number.isSafeInteger(value.expiresAt)) throw new Error('Invalid relay authorization store');
          if (name === 'clients') {
            if (!/^[A-Za-z0-9_-]{43}$/.test(key) || value.client?.client_id !== key || !Array.isArray(value.client.redirect_uris)) throw new Error('Invalid relay authorization store');
          } else if (!/^[a-f0-9]{64}$/.test(key) || !/^[A-Za-z0-9_-]{43}$/.test(value.browserId) || (name === 'tokens' && (!['access','refresh'].includes(value.kind) || !/^[A-Za-z0-9_-]{43}$/.test(value.clientId) || !/^[A-Za-z0-9_-]{43}$/.test(value.grantId)))) throw new Error('Invalid relay authorization store');
          if (value.expiresAt > Math.floor(now()/1000)) map.set(key, value);
        }
      }
    }
  }
  // A failed write keeps authorization closed only until a full write succeeds;
  // in-memory state (including revocations) is retried at most every 5 seconds.
  const check = () => {
    if (failed && !running && Date.now() - attempted >= 5000) write(true).catch(() => {});
    if (failed) throw new Error('Relay authorization storage unavailable');
  };
  const directory = file && path.dirname(file);
  const snapshot = () => {
    const durableIds = new Set([...identities.values()].map(item => item.browserId));
    return JSON.stringify({version:1, origin, clients:[...clients], tokens:[...tokens].filter(([,item]) => durableIds.has(item.browserId)), identities:[...identities]});
  };
  const failure = error => {
    if (!failed) console.error(JSON.stringify({ event: 'state_write_failed', error: error.code || error.message }));
    failed = true; return new Error('Relay authorization storage unavailable');
  };
  const success = document => {
    if (failed) console.error(JSON.stringify({ event: 'state_write_recovered' }));
    failed = false; written = document;
  };
  // Crash-consistent replacement: a complete temporary file is fsynced before it
  // is renamed over the store, and the directory is fsynced before the write
  // counts as durable. A crash at any step leaves the old or the new document,
  // never a partial one (startup removes an orphaned temporary file).
  // The synchronous form runs only in the constructor, before any async write.
  function writeSync(document) {
    attempted = Date.now();
    let temporary;
    try {
      mkdirSync(directory, {recursive:true, mode:0o700});
      temporary = file + '.' + randomUUID();
      const fd = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(fd, document); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, file); temporary = undefined; chmodSync(file, 0o600);
      const parent = openSync(directory, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
    } catch (error) {
      if (temporary) try { rmSync(temporary, { force: true }); } catch {}
      throw failure(error);
    }
    success(document);
  }
  async function writeAsync(document) {
    attempted = Date.now();
    let temporary;
    try {
      await io.mkdir(directory, {recursive:true, mode:0o700});
      temporary = file + '.' + randomUUID();
      const handle = await io.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(document); await handle.sync(); } finally { await handle.close(); }
      await io.rename(temporary, file); temporary = undefined; await io.chmod(file, 0o600);
      const parent = await io.open(directory, 'r'); try { await parent.sync(); } finally { await parent.close(); }
    } catch (error) {
      if (temporary) try { await io.rm(temporary, { force: true }); } catch {}
      throw failure(error);
    }
    success(document);
  }
  // Writes never block the event loop and never overlap: one runs at a time, in
  // the order their snapshots were taken, so an older document can never be
  // renamed over a newer one. A write's snapshot is taken synchronously when it
  // starts. Callers that arrive while one is running share a single follow-up
  // write whose snapshot is taken when it starts, after every one of their
  // mutations. So the promise a caller gets resolves only once a document that
  // contains its mutation is durable: a revocation or issued token can be
  // acknowledged on resolution. Bursts coalesce into at most two writes.
  let running, queued;
  function write(force) {
    if (!file) return Promise.resolve();
    if (running) {
      if (!queued) {
        let resolve, reject;
        queued = { promise: new Promise((a, b) => { resolve = a; reject = b; }), resolve, reject, force };
      } else queued.force ||= force;
      return queued.promise;
    }
    const document = snapshot();
    if (!force && !failed && document === written) return Promise.resolve();
    running = writeAsync(document);
    running.then(drain, drain);
    return running;
  }
  function drain() {
    running = undefined;
    const next = queued; queued = undefined;
    if (next) write(next.force).then(next.resolve, next.reject);
  }
  if (file) writeSync(snapshot());
  // save() always writes; persist() is for mutations and skips a document
  // identical to the one already durable on disk. Both return a promise that
  // settles when the current state is durable (or the write failed).
  return {clients, tokens, identities, save: () => write(true), persist: () => write(false), flush: () => write(true), check};
}
