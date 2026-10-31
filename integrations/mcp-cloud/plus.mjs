// Kitsuvo Plus relay capacity. The relay checks a connector's activation code
// offline against the pinned Ed25519 public key, exactly as the desktop app does
// (src/plus.rs verify). It never calls kitsuvo.com and keeps only the
// subscription hash and expiry, in memory, for as long as the connector is live.
import { createPublicKey, verify } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const PLUS_PRODUCT = 'kitsuvo-plus-personal-v1';
const maxCode = 2048, week = 7 * 86400;
const claimKeys = ['expires_at', 'issued_at', 'product', 'subject', 'version'];
const shape = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

// Raw 32-byte key as 64 hex characters (the site's PLUS_PUBLIC_KEY_HEX).
// Unset means Plus is off and every connector gets free limits.
export function plusPublicKey(hex) {
  if (!hex) return undefined;
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new Error('PLUS_PUBLIC_KEY_HEX must be 64 lowercase hex characters.');
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
}

// Claims without checking the signature; only for the connector to skip
// sending a code that has already expired.
function claimsOf(code) {
  if (typeof code !== 'string' || code.length > maxCode || !shape.test(code)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(code.split('.')[0], 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : undefined;
  } catch { return undefined; }
}

// Returns { subject, expiresAt } for a genuine, current Plus code, else undefined.
export function verifyPlus(code, key, time) {
  if (!key) return undefined;
  const claims = claimsOf(code);
  if (!claims) return undefined;
  const [body, signature] = code.split('.');
  const raw = Buffer.from(signature, 'base64url');
  try { if (raw.length !== 64 || !verify(null, Buffer.from(body), key, raw)) return undefined; } catch { return undefined; }
  const { version, product, subject, issued_at: issued, expires_at: expires } = claims;
  if (Object.keys(claims).sort().join() !== claimKeys.join() || version !== 1 || product !== PLUS_PRODUCT
      || typeof subject !== 'string' || !/^[a-f0-9]{64}$/i.test(subject)
      || !Number.isSafeInteger(issued) || !Number.isSafeInteger(expires)
      || issued > time + 300 || expires <= time || expires <= issued || expires - issued > week) return undefined;
  return { subject: subject.toLowerCase(), expiresAt: expires };
}

// Where the desktop app keeps the code: <OS config dir>/kitsuvo/plus-license.txt.
export function defaultPlusLicensePath(platform = process.platform, env = process.env, home = homedir()) {
  const base = platform === 'win32' ? env.APPDATA || path.join(home, 'AppData', 'Roaming')
    : platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
    : env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, 'kitsuvo', 'plus-license.txt');
}

// KITSUVO_PLUS=off disables sending. KITSUVO_PLUS_LICENSE holds a code;
// otherwise the file is --plus-license, KITSUVO_PLUS_LICENSE_FILE or the
// desktop app's. A missing, oversized, malformed or expired code is undefined.
export function plusSource({ env = process.env, file } = {}) {
  if (['0', 'off', 'false', 'no'].includes(String(env.KITSUVO_PLUS || '').toLowerCase())) return undefined;
  const inline = env.KITSUVO_PLUS_LICENSE;
  const location = file || env.KITSUVO_PLUS_LICENSE_FILE || defaultPlusLicensePath(process.platform, env);
  return async (time = Math.floor(Date.now() / 1000)) => {
    let code = inline;
    if (code === undefined) {
      try {
        if ((await stat(location)).size > maxCode) return undefined;
        code = await readFile(location, 'utf8');
      } catch { return undefined; }
    }
    code = code.trim();
    const claims = claimsOf(code);
    return claims && Number.isSafeInteger(claims.expires_at) && claims.expires_at > time ? code : undefined;
  };
}

// Re-reads the code (the desktop app renews it about two days before expiry)
// and sends it to the relay whenever it changes.
export function watchPlus(read, send, { initial, intervalMs = 3600000 } = {}) {
  let last = initial;
  const check = async () => { const code = await read(); if (code && code !== last) { last = code; send(code); } };
  const timer = setInterval(() => { void check().catch(() => {}); }, intervalMs); timer.unref();
  return { check, stop: () => clearInterval(timer) };
}
