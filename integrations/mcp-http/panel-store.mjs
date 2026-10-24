import { readFile, mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Optional service-local recovery. Store page URLs, never page text or element references. Native IDs are deliberately not persisted: reboot can
// reuse an ID for a completely different page.
export async function panelStore(file, profile) {
  if (!path.isAbsolute(file) || !path.isAbsolute(profile)) throw new Error('Absolute panel state paths required');
  let records = {};
  try {
    const raw = await readFile(file, 'utf8');
    if (raw.length > 2 * 1024 * 1024) throw new Error('Panel state too large');
    const state = JSON.parse(raw);
    if (state.version !== 1 || state.profile !== profile || !state.records || typeof state.records !== 'object' || Array.isArray(state.records) || Object.keys(state.records).length > 500) throw new Error('Invalid panel state');
    for (const [id, value] of Object.entries(state.records)) {
      if (!/^[0-9a-f-]{36}$/.test(id) || !value || (value.url !== null && (typeof value.url !== 'string' || value.url.length > 2048)) || !Number.isSafeInteger(value.expires)) throw new Error('Invalid panel state');
      if (value.expires > Date.now()) records[id] = value;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lifetime = 90 * 86400000, refreshAfter = 3600000;
  // Writes are serialized, and one queued write covers every save made before it
  // starts. Concurrent saves could otherwise rename an older snapshot last and
  // drop a newer panel from disk.
  let tail = Promise.resolve(), queued;
  const write = async () => {
    await mkdir(path.dirname(file), {recursive:true, mode:0o700});
    const temporary = file + '.' + randomUUID();
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({version:1, profile, records})); await handle.sync();
      await handle.close(); handle = undefined; await rename(temporary, file);
    } finally { await handle?.close(); await rm(temporary, {force:true}); }
  };
  const flush = () => {
    if (queued) return queued;
    queued = tail.then(() => { queued = undefined; return write(); });
    tail = queued.catch(() => {});
    return queued;
  };
  return {
    get(id) { return records[id]?.expires > Date.now() ? records[id] : undefined; },
    async save(id, url) {
      if (typeof url !== 'string' || url.length > 2048 || !/^https?:\/\//.test(url)) url = null;
      const previous = records[id], expires = Date.now() + lifetime;
      records[id] = {url, expires};
      // Every panel action saves. An unchanged URL only extends a 90-day expiry,
      // so rewrite (with fsync) at most hourly for it.
      if (previous && previous.url === url && previous.expires > expires - refreshAfter) { records[id] = previous; return; }
      for (const key of Object.keys(records).sort((a,b)=>records[b].expires-records[a].expires).slice(500)) delete records[key];
      return flush();
    },
  };
}
