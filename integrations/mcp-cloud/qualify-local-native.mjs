// Run OAuth/native App qualification against a disposable loopback relay.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRelay } from './server.mjs';

const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const relay = createRelay({ origin });
await new Promise(resolve => relay.http.listen(port, '127.0.0.1', resolve));
try {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./smoke-native.mjs', import.meta.url)), '--app'], {
    env: { ...process.env, KITSUVO_CLOUD_ORIGIN: origin, KITSUVO_CLOUD_SMOKE: '1' },
    stdio: 'inherit', windowsHide: true,
  });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  if (result.code !== 0 || result.signal) throw new Error('Local native cloud relay qualification failed.');
} finally {
  await relay.close();
}
