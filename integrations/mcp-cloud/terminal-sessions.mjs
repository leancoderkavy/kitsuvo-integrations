// Human remote terminals are deliberately outside MCP. Browser OAuth only
// permits requesting approval; the native host chooses the folder and shell.
// No terminal input, output or approval is persisted or sent to telemetry.
import { randomBytes } from 'node:crypto';

export function terminalSessions({ now = () => Date.now() } = {}) {
  const sessions = new Map(), cooldown = new Map();
  function stop(browserId) {
    const item = sessions.get(browserId);
    if (!item) return;
    sessions.delete(browserId);
    item.browser.terminalCall({ action: 'stop', session: item.id }, () => {}).catch(() => {});
  }
  const sweep = setInterval(() => {
    for (const [browserId, item] of sessions) if (now() - item.seen >= 15000) stop(browserId);
    for (const [browserId, until] of cooldown) if (until <= now()) cooldown.delete(browserId);
  }, 1000);
  sweep.unref();
  return {
    revoke(grantId) { for (const [id, item] of sessions) if (item.grantId === grantId) stop(id); },
    stop,
    close() { clearInterval(sweep); for (const id of sessions.keys()) stop(id); },
    async handle({ browserId, grantId, client, browser, body, authorize, stillGranted = authorize }) {
      const fail = (status, error) => ({ status, body: { error } });
      if (!browser?.terminal) return fail(409, 'This computer does not support remote terminals. Use the current desktop app with Developer tools enabled.');
      if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Invalid terminal request.');
      const { action, session, data, rows, cols } = body;
      if (!['request', 'poll', 'input', 'resize', 'stop'].includes(action)) return fail(400, 'Invalid terminal action.');
      if (action === 'input' && (typeof data !== 'string' || !data.length || Buffer.byteLength(data) > 8192)) return fail(400, 'Terminal input must be between 1 and 8192 bytes.');
      if (action === 'resize' && (![rows, cols].every(Number.isInteger) || rows < 2 || rows > 200 || cols < 10 || cols > 400)) return fail(400, 'Invalid terminal size.');
      let item = sessions.get(browserId);
      if (action === 'request') {
        if (item) return fail(409, 'A remote terminal session is already open on this computer.');
        if ((cooldown.get(browserId) || 0) > now()) return fail(429, 'Wait 30 seconds before requesting another terminal.');
        const id = randomBytes(32).toString('base64url');
        item = { id, grantId, browser, seen: now() };
        sessions.set(browserId, item); cooldown.set(browserId, now() + 30000);
      } else if (!item || item.grantId !== grantId || item.id !== session) {
        return fail(404, 'This terminal session has ended or belongs to another device.');
      }
      item.seen = now();
      const params = { action, session: item.id, ...(action === 'request' ? { client } : {}),
        ...(action === 'input' ? { data } : {}), ...(action === 'resize' ? { rows, cols } : {}) };
      try {
        const result = await browser.terminalCall(params, () => {
          authorize();
          if (sessions.get(browserId) !== item) throw new Error('Terminal ended.');
        });
        // Revocation/disconnect while the host answered must not leak output.
        stillGranted();
        if (sessions.get(browserId) !== item) return fail(404, 'This terminal session has ended.');
        if (result?.session !== item.id || !['pending', 'running', 'closed', 'rejected'].includes(result?.state) ||
            (result.data !== undefined && (typeof result.data !== 'string' || result.data.length > 90000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(result.data)))) throw new Error('Invalid terminal response.');
        if (action === 'stop' || ['closed', 'rejected'].includes(result.state)) sessions.delete(browserId);
        return { status: 200, body: result };
      } catch {
        stop(browserId);
        return fail(502, 'Terminal unavailable. Check the host computer, enable Developer tools, and request a new session.');
      }
    },
  };
}
