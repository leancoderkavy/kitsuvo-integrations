import { readFileSync, readdirSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, chmodSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Connector and bearer token secrets are hashed. Client registration metadata
// remains private, including SDK-issued confidential client credentials. Bind the file
// to its issuer; a corrupt or unavailable store must never reset approvals.
export function durableStore(file, origin, capacity = {}) {
  const clients = new Map(), tokens = new Map(), identities = new Map();
  const maximum = { clients: 500, tokens: 500, identities: 500, ...capacity };
  let failed = false, attempted = 0;
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
          if (value.expiresAt > Math.floor(Date.now()/1000)) map.set(key, value);
        }
      }
    }
  }
  // A failed write keeps authorization closed only until a full write succeeds;
  // in-memory state (including revocations) is retried at most every 5 seconds.
  const check = () => {
    if (failed && Date.now() - attempted >= 5000) { try { save(); } catch {} }
    if (failed) throw new Error('Relay authorization storage unavailable');
  };
  const save = () => {
    if (!file) return;
    attempted = Date.now();
    let temporary;
    try {
      mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
      temporary = file + '.' + randomUUID();
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        const durableIds = new Set([...identities.values()].map(item => item.browserId));
        writeFileSync(fd, JSON.stringify({version:1, origin, clients:[...clients], tokens:[...tokens].filter(([,item]) => durableIds.has(item.browserId)), identities:[...identities]}));
        fsyncSync(fd);
      } finally { closeSync(fd); }
      renameSync(temporary, file); temporary = undefined; chmodSync(file, 0o600);
      const parent = openSync(path.dirname(file), 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
    } catch (error) {
      if (temporary) try { rmSync(temporary, { force: true }); } catch {}
      if (!failed) console.error(JSON.stringify({ event: 'state_write_failed', error: error.code || error.message }));
      failed = true; throw new Error('Relay authorization storage unavailable');
    }
    if (failed) console.error(JSON.stringify({ event: 'state_write_recovered' }));
    failed = false;
  };
  save();
  return {clients, tokens, identities, save, check};
}
