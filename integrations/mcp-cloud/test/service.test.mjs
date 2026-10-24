import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateConfig, launchAgent, windowsTask, startControl, controlRequest, connectorIdentity } from '../service.mjs';

const config = { origin: 'https://relay.example', binary: path.resolve('kitsuvo'), profile: path.resolve('isolated-test-profile'), node: process.execPath, script: path.resolve('service.mjs'), consent: 'isolated-browser-cloud-access-v1' };
test('persistent startup requires explicit consent and fixed HTTPS destination', () => {
  assert.equal(validateConfig(config).origin, config.origin);
  for (const origin of ['http://relay.example', 'https://user:password@relay.example', 'https://relay.example/path', 'https://relay.example?token=secret']) assert.throws(() => validateConfig({ ...config, origin }));
  assert.throws(() => validateConfig({ ...config, consent: undefined }));
  assert.throws(() => validateConfig({ ...config, script: 'service.mjs' }));
});
test('macOS launch agent keeps connector independent of desktop lifetime', () => {
  const plist = launchAgent({ ...config, script: '/Users/test/a&b/service.mjs' }, '/Users/test/state');
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><true\/>/);
  assert.match(plist, /a&amp;b/);
  assert.match(plist, /<string>run<\/string>/);
});
test('Windows user task stays alive without runtime limit or battery termination', () => {
  const script = windowsTask({ ...config, node: "C:\\User's Files\\node.exe", script: 'C:\\Program Files\\Kitsuvo\\service.mjs' }, 'C:\\Users\\test\\state');
  assert.match(script, /C:\\User''s Files\\node.exe/);
  assert.match(script, /-LogonType Interactive -RunLevel Limited/);
  assert.match(script, /-ExecutionTimeLimit \(\[TimeSpan\]::Zero\)/);
  assert.match(script, /-MultipleInstances IgnoreNew/);
  assert.match(script, /-DontStopIfGoingOnBatteries/);
  assert.match(script, /Start-ScheduledTask/);
});
test('local approval endpoint rejects unsolicited grants, browser origins and wrong credentials', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kitsuvo-service-test-'));
  let control; const approved = [];
  const code = 'x'.repeat(43);
  const connection = { review(id) { queueMicrotask(() => control.receive({ type: 'review', id, clientName: 'ChatGPT', redirectUri: 'https://chatgpt.com/connector/oauth/test', scope: ['browser'] })); }, approve(id) { approved.push(id); } };
  try {
    control = await startControl({ connection, directory });
    control.receive({ type: 'connected' });
    const state = JSON.parse(await readFile(path.join(directory, 'control.json')));
    if (process.platform !== 'win32') assert.equal((await stat(path.join(directory, 'control.json'))).mode & 0o777, 0o600);
    assert.equal((await controlRequest(directory, { action: 'status' })).connected, true);
    await assert.rejects(controlRequest(directory, { action: 'approve', challenge: code }));
    for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Authorization: `Bearer ${state.key}`, Origin: 'https://attacker.example' }]) {
      const response = await fetch(`http://127.0.0.1:${state.port}`, { method: 'POST', headers, body: '{}' }); assert.equal(response.status, 403);
    }
    const review = await controlRequest(directory, { action: 'review', code });
    assert.equal(review.clientName, 'ChatGPT'); assert.equal(approved.length, 0);
    await controlRequest(directory, { action: 'approve', challenge: review.challenge }); assert.deepEqual(approved, [code]);
    await assert.rejects(controlRequest(directory, { action: 'approve', challenge: review.challenge }));
  } finally { await control?.close(); await rm(directory, { recursive: true, force: true }); }
});


test('private connector identity is stable across concurrent startup, restart and bound to its relay', async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'kitsuvo-identity-'));
  try {
    const keys=await Promise.all(Array.from({length:10},()=>connectorIdentity(directory,config.origin)));
    const first=await connectorIdentity(directory,config.origin);
    assert.ok(keys.every(key=>key===first));
    assert.equal(first.length,43);
    if(process.platform!=='win32') assert.equal((await stat(path.join(directory,'identity.json'))).mode&0o777,0o600);
    await assert.rejects(connectorIdentity(directory,'https://different.example'));
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('local revocation waits for relay acknowledgement', async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'kitsuvo-revoke-')); let control;
  try {
    control=await startControl({directory,connection:{revoke(){queueMicrotask(()=>control.receive({type:'revoked'}));}}});
    control.receive({type:'connected',durable:true});
    assert.equal((await controlRequest(directory,{action:'status'})).durable,true);
    assert.deepEqual(await controlRequest(directory,{action:'revoke'}),{revoked:true});
  } finally {await control?.close();await rm(directory,{recursive:true,force:true});}
});

test('macOS 13 and earlier refuse cloud access with an actionable message, not a generic failure', async () => {
  const { checkIsolationSupport, ConnectorError, isolationMessage } = await import('../connect.mjs');
  for (const release of ['22.6.0', '21.1.0', '19.6.0']) assert.throws(() => checkIsolationSupport('darwin', release), error => error instanceof ConnectorError && /macOS 14/.test(error.message) && /Nothing was connected/.test(error.message));
  for (const [platform, release] of [['darwin', '23.0.0'], ['darwin', '25.6.0'], ['win32', '10.0.22631'], ['linux', '6.8.0']]) assert.doesNotThrow(() => checkIsolationSupport(platform, release));
  assert.match(isolationMessage, /Update macOS/); assert.match(isolationMessage, /kitsuvo mcp/);
  // User-facing connector errors reach the terminal verbatim.
  const { execFile } = await import('node:child_process');
  const env = { ...process.env }; delete env.KITSUVO_CLOUD_ORIGIN;
  const stderr = await new Promise(resolve => execFile(process.execPath, [new URL('../connect.mjs', import.meta.url).pathname], { env }, (_error, _out, err) => resolve(err)));
  assert.match(stderr, process.platform === 'darwin' && Number.parseInt((await import('node:os')).release(), 10) < 23 ? /macOS 14/ : /Set KITSUVO_CLOUD_ORIGIN/);
});
