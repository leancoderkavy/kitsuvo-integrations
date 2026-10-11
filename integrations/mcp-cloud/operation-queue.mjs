// Serial mutations remain serial even when their caller times out. Admission,
// queued time and execution share one deadline; aborted queued work never runs.
export function operationQueue(limit = 32, defaultTimeoutMs = 180_000) {
  let tail = Promise.resolve(), pending = 0, closed = false;
  const active = new Set();
  return {
    run(operation, { signal, timeoutMs = defaultTimeoutMs } = {}) {
      if (closed || pending >= limit) return Promise.reject(new Error(closed ? 'MCP session closed.' : 'Browser queue busy/full. Retry after pending requests finish.'));
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('Invalid request deadline.'));
      if (signal?.aborted) return Promise.reject(new Error('Browser request cancelled before execution.'));
      pending++;
      const controller = new AbortController();
      let timer, rejectCaller;
      const cancelled = new Promise((_, reject) => { rejectCaller = reject; });
      const cancel = reason => {
        if (controller.signal.aborted) return;
        controller.abort(reason);
        rejectCaller(new Error(`${reason} A running action may have completed; inspect the page before retrying.`));
      };
      active.add(cancel);
      const abort = () => cancel('Browser request cancelled.');
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => cancel('Browser request deadline exceeded.'), timeoutMs);
      const result = tail.then(() => {
        if (controller.signal.aborted || closed) throw new Error('Browser request cancelled before execution.');
        return operation(controller.signal);
      });
      tail = result.catch(() => {}).finally(() => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        active.delete(cancel); pending--;
      });
      return Promise.race([result, cancelled]);
    },
    close() {
      closed = true;
      for (const cancel of active) cancel('MCP session closed.');
    },
    get pending() { return pending; },
  };
}
