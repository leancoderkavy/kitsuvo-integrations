import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalSessions } from '../terminal-sessions.mjs';

function fixture(t) {
  let time = 1000, phase = 'pending';
  const calls = [];
  const browser = { terminal: true, async terminalCall(params, authorize) {
    authorize(); calls.push(params);
    return { session: params.session, state: params.action === 'stop' ? 'closed' : phase, data: '' };
  } };
  const sessions = terminalSessions({ now: () => time }); t.after(() => sessions.close());
  const send = (body, overrides = {}) => sessions.handle({ browserId: 'computer', grantId: 'owner', client: 'device', browser, body, authorize() {}, ...overrides });
  return { send, sessions, browser, calls, setPhase: value => { phase = value; }, advance: ms => { time += ms; } };
}

test('terminal approval is separate, grant-bound and never inherited by another device', async t => {
  const f = fixture(t);
  const requested = await f.send({ action: 'request' });
  assert.equal(requested.status, 200); assert.equal(requested.body.state, 'pending');
  const session = requested.body.session;
  assert.match(session, /^[\w-]{43}$/);
  assert.deepEqual(f.calls[0], { action: 'request', session, client: 'device' });
  assert.equal((await f.send({ action: 'poll', session }, { grantId: 'other' })).status, 404);
  assert.equal((await f.send({ action: 'stop', session }, { grantId: 'other' })).status, 404);
  assert.equal((await f.send({ action: 'poll', session: 'wrong' })).status, 404);
  assert.equal(f.calls.length, 1);
  f.setPhase('running');
  assert.equal((await f.send({ action: 'poll', session })).body.state, 'running');
  f.sessions.revoke('other'); assert.equal(f.calls.length, 2);
  f.sessions.revoke('owner');
  assert.equal(f.calls.at(-1).action, 'stop');
  assert.equal((await f.send({ action: 'poll', session })).status, 404);
});

test('requests are exclusive and throttled; UTF-8 input, size and unsupported actions are bounded', async t => {
  const f = fixture(t), requested = await f.send({ action: 'request' }), session = requested.body.session;
  assert.equal((await f.send({ action: 'request' })).status, 409);
  for (const body of [{ action: 'input', session, data: 'é'.repeat(4097) }, { action: 'input', session, data: '' },
    { action: 'resize', session, rows: 2000, cols: 80 }, { action: 'resize', session, rows: 24, cols: 80.5 },
    { action: 'exec', session, data: 'command' }]) assert.equal((await f.send(body)).status, 400);
  assert.equal(f.calls.length, 1);
  await f.send({ action: 'stop', session });
  assert.equal((await f.send({ action: 'request' })).status, 429);
  f.advance(30001);
  const next = await f.send({ action: 'request' });
  assert.notEqual(next.body.session, session);
  assert.equal(next.body.state, 'pending');
});

test('revocation discards an in-flight terminal response and stops the host shell', async t => {
  const f = fixture(t), requested = await f.send({ action: 'request' }), session = requested.body.session;
  let answer;
  f.browser.terminalCall = (params, authorize) => {
    authorize(); f.calls.push(params);
    return params.action === 'poll' ? new Promise(resolve => { answer = resolve; }) : Promise.resolve({ session, state: 'closed' });
  };
  const pending = f.send({ action: 'poll', session });
  f.sessions.revoke('owner');
  answer({ session, state: 'running', data: Buffer.from('private-output').toString('base64') });
  const result = await pending;
  assert.equal(result.status, 404); assert.ok(!JSON.stringify(result).includes('private-output'));
  assert.equal(f.calls.at(-1).action, 'stop');
});

test('lost polling expires a terminal; connector loss and server close remove sessions', async t => {
  const f = fixture(t), requested = await f.send({ action: 'request' });
  f.advance(16000);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(f.calls.at(-1).action, 'stop');
  assert.equal((await f.send({ action: 'poll', session: requested.body.session })).status, 404);
  f.advance(30001); const next = await f.send({ action: 'request' });
  f.sessions.stop('computer');
  assert.equal((await f.send({ action: 'poll', session: next.body.session })).status, 404);
});

test('unavailable hosts and malformed host output fail closed without returning terminal data', async t => {
  const f = fixture(t);
  assert.equal((await f.send({ action: 'request' }, { browser: { terminal: false } })).status, 409);
  f.browser.terminalCall = async params => ({ session: params.session, state: 'running', data: 'x'.repeat(90001) });
  const result = await f.send({ action: 'request' });
  assert.equal(result.status, 502); assert.ok(result.body.error.length < 200);
});

test('an admitted poll survives token rotation in the same grant without exposing data after revocation', async t => {
  const f = fixture(t), requested = await f.send({ action: 'request' }), session = requested.body.session;
  let answer, credentialValid = true, granted = true;
  f.browser.terminalCall = (params, authorize) => {
    authorize();
    return params.action === 'poll' ? new Promise(resolve => { answer = resolve; }) : Promise.resolve({ session, state: 'closed' });
  };
  const pending = f.send({ action: 'poll', session }, {
    authorize() { assert.ok(credentialValid); }, stillGranted() { assert.ok(granted); },
  });
  credentialValid = false; // Old token rotated after dispatch; the grant is still authorized.
  answer({ session, state: 'running', data: '' });
  assert.equal((await pending).status, 200);
  credentialValid = true;
  const revoked = f.send({ action: 'poll', session }, {
    authorize() { assert.ok(credentialValid); }, stillGranted() { assert.ok(granted); },
  });
  granted = false; answer({ session, state: 'running', data: Buffer.from('private-output').toString('base64') });
  const response = await revoked;
  assert.equal(response.status, 502); assert.ok(!JSON.stringify(response).includes('private-output'));
});
