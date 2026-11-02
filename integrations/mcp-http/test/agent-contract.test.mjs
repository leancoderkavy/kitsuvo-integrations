import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browserInstructions } from '../agent-contract.mjs';

test('independently packaged bridges keep identical safety guidance', async () => {
  const source = await readFile(new URL('../agent-contract.mjs', import.meta.url), 'utf8');
  assert.equal(source, await readFile(new URL('../../mcp-cloud/agent-contract.mjs', import.meta.url), 'utf8'));
  assert.ok(browserInstructions.length < 512);
});
