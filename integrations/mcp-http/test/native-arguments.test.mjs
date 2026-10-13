import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeArguments } from '../server.mjs';

test('newer browsers explicitly isolate the profile, including headless mode', () => {
  assert.deepEqual(nativeArguments('--separate-profile\n--headless', true), ['mcp', '--separate-profile', '--headless']);
});
test('released legacy browser uses its documented isolated MCP default', () => {
  const legacy = 'AGENT OPTIONS:\n    --agent               Agent mode: control API on 127.0.0.1, separate profile\n    --main-profile Use your own profile';
  assert.deepEqual(nativeArguments(legacy), ['mcp']);
  assert.throws(() => nativeArguments(legacy, true), /does not support headless/);
});
test('unknown help does not silently remove the isolation flag', () => {
  assert.deepEqual(nativeArguments('Unknown CLI'), ['mcp', '--separate-profile']);
});
