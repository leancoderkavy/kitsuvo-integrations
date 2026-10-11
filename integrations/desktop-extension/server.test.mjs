import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function launch(binary, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
      env: { ...process.env, KITSUVO_BINARY: binary }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Launcher timed out')); }, 5000);
    child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

test('missing executable exits cleanly with setup instructions on stderr only', async () => {
  const result = await launch('/kitsuvo-test/missing-executable');
  assert.equal(result.code, 1); assert.equal(result.stdout, '');
  assert.match(result.stderr, /check the configured executable path/);
});

test('launcher preserves protocol bytes and passes only mcp without a shell', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'kitsuvo-launcher-'));
  try {
    const binary = join(directory, 'executable with spaces');
    await writeFile(binary, `#!${process.execPath}\nif (process.argv.slice(2).join(',') !== 'mcp') process.exit(9);\nprocess.stdin.pipe(process.stdout);\n`);
    await chmod(binary, 0o755);
    const input = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n';
    const result = await launch(binary, input);
    assert.equal(result.code, 0); assert.equal(result.stdout, input); assert.equal(result.stderr, '');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
