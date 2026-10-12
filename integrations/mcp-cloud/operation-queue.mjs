// Distributed independently; keep both implementations identical.
export function operationQueue(capacity = 32, timeoutMs = 180000) {
  const waiting = []; let active, closed = false;
  const pump = async () => {
    if (active || closed) return;
    const item = waiting.shift(); if (!item) return;
    active = item;
    try {
      item.controller.signal.throwIfAborted();
      item.resolve(await item.operation(item.controller.signal, ()=>Math.max(1,Math.ceil(item.deadline-performance.now()))));
    } catch (e) { item.reject(e); }
    finally { item.cleanup(); active = undefined; void pump(); }
  };
  return {
    run(operation, { signal, timeoutMs: deadlineMs = timeoutMs } = {}) {
      if (closed) return Promise.reject(new Error('MCP session closed.'));
      if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return Promise.reject(new Error('Invalid request deadline.'));
      if (waiting.length + Number(!!active) >= capacity) return Promise.reject(new Error('Browser queue busy/full.'));
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        const duration = Math.max(1, Math.min(Number(deadlineMs) || timeoutMs, timeoutMs));
        const item = { operation, controller, resolve, reject, deadline:performance.now()+duration };
        const cancel = () => {
          const index = waiting.indexOf(item);
          if (index >= 0) { waiting.splice(index,1); item.cleanup(); }
          reject(controller.signal.reason);
        };
        const abort = () => controller.abort(signal.reason);
        const timer = setTimeout(()=>controller.abort(new Error('Browser request deadline exceeded. A dispatched mutation may have completed; inspect state before retrying.')),duration);
        item.cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort',abort); controller.signal.removeEventListener('abort',cancel); };
        controller.signal.addEventListener('abort',cancel,{once:true});
        signal?.addEventListener('abort',abort,{once:true});
        waiting.push(item); queueMicrotask(()=>void pump());
      });
    },
    get pending() { return waiting.length + Number(!!active); },
    close() {
      closed = true;
      for (const item of [...waiting, ...(active ? [active] : [])]) item.controller.abort(new Error('MCP session closed.'));
    },
  };
}
