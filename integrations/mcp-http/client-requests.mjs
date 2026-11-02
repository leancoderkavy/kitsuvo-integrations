// Internal bounded discovery helpers, kept identical for independent MCP packages.
export function requestBudget(timeoutMs, signal) {
  const controller = new AbortController(), deadline = performance.now() + timeoutMs;
  const expire = () => controller.abort(new Error('Browser request deadline exceeded. A dispatched mutation may have completed; inspect state before retrying.'));
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(expire, timeoutMs);
  const remaining = () => {
    if (performance.now() >= deadline) expire();
    controller.signal.throwIfAborted();
    return Math.max(1, Math.ceil(deadline - performance.now()));
  };
  return {
    signal: controller.signal, remaining,
    abort: reason => controller.abort(reason),
    async wait(operation) {
      let onAbort;
      // Observe late rejections too: cancellation does not make an application's
      // promise or an uncooperative client's dispatched operation disappear.
      const cancelled = new Promise((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        try { remaining(); } catch (error) { reject(error); }
      });
      try {
        const result = await Promise.race([operation, cancelled]);
        remaining();
        return result;
      } finally { controller.signal.removeEventListener('abort', onAbort); }
    },
    cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', abort); },
  };
}

export async function toolCatalogue(listTools, reservedNames = []) {
  const tools = [], names = new Set(), cursors = new Set(), reserved = new Set(reservedNames); let cursor;
  for (let page = 0; page < 16; page++) {
    const result = await listTools(cursor === undefined ? undefined : { cursor });
    if (!Array.isArray(result?.tools)) throw new Error('Invalid tool catalog.');
    for (const tool of result.tools) {
      if (typeof tool?.name !== 'string' || !tool.name || names.has(tool.name) || reserved.has(tool.name) || names.size + reserved.size >= 2048)
        throw new Error('Invalid or ambiguous tool catalog.');
      names.add(tool.name); tools.push(structuredClone(tool));
    }
    if (result.nextCursor === undefined) return tools;
    cursor = result.nextCursor;
    if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('Invalid tool catalog pagination.');
    cursors.add(cursor);
  }
  throw new Error('Tool catalog exceeds the pagination limit.');
}
// Share a complete read, never a partial page chain. Callers register invalidate
// with their own SDK notification handler so this helper has no SDK dependency.
export function catalogueCache(backend, reservedNames = []) {
  let promise;
  return {
    invalidate() { promise = undefined; },
    read() {
      if (!promise) {
        const pending = (async () => {
          const budget = requestBudget(180000);
          try {
            let meta;
            const tools = await toolCatalogue(async params => {
              const result = await budget.wait(backend.listTools(params, {
                timeout: budget.remaining(), signal: budget.signal,
              }));
              if (params === undefined && result?._meta !== undefined) meta = structuredClone(result._meta);
              return result;
            }, reservedNames);
            budget.remaining();
            return { tools, ...(meta !== undefined ? { _meta: meta } : {}) };
          } finally { budget.cleanup(); }
        })().catch(error => {
          // An old rejected read must not evict a newer, invalidated generation.
          if (promise === pending) promise = undefined;
          throw error;
        });
        promise = pending;
      }
      return promise;
    },
  };
}
