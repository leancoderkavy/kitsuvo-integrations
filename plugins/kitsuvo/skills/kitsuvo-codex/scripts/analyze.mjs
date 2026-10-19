import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

// No listener, browser process, shell interpolation, AI provider or fetch.
export async function analyze(snapshot, binary = process.env.KITSUVO_BINARY ||
  (process.platform === 'darwin' && existsSync('/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo')
    ? '/Applications/Kitsuvo.app/Contents/MacOS/kitsuvo' : 'kitsuvo')) {
  if (snapshot?.skipped) return { skipped: String(snapshot.skipped).slice(0, 300) };
  if (snapshot?.source !== 'codex-live-dom' || typeof snapshot.html !== 'string' ||
      Buffer.byteLength(snapshot.html) > 6000000) throw new Error('Expected a bounded Codex live DOM capture.');
  const url = new URL(snapshot.url);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Expected a query-free HTTP(S) page address.');
  }
  const dir = await mkdtemp(join(tmpdir(), 'kitsuvo-codex-analysis-'));
  try {
    const file = join(dir, 'page.html');
    await writeFile(file, snapshot.html, { mode: 0o600 });
    const { stdout } = await promisify(execFile)(binary,
      ['scan', '--file', file, '--url', url.href, '--json'], { timeout: 30000, maxBuffer: 4000000 });
    return { source: 'codex-live-dom', url: url.href, truncated: snapshot.truncated === true,
      limitations: ['Sanitized DOM evidence only; missing evidence can lower the score.',
        'Analysis on request; no automatic navigation interception or search-result hiding.'],
      detection: JSON.parse(stdout) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let size = 0; const chunks = [];
    for await (const chunk of process.stdin) {
      size += chunk.length; if (size > 8000000) throw new Error('Capture too large.'); chunks.push(chunk);
    }
    console.log(JSON.stringify(await analyze(JSON.parse(Buffer.concat(chunks).toString('utf8')))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
