import { requestBudget, toolCatalogue } from './client-requests.mjs';

// Adapt an already authenticated MCP client to function-tool hosts. No model,
// credential storage, browser discovery, network listener or automatic retries.
// Preserve array ordering, but ignore JSON object insertion order.
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const catalogOf = (client, budget) => toolCatalogue(params => budget.wait(client.listTools(params, {
  timeout: budget.remaining(), signal: budget.signal,
})));

// Approval must see the same data JSON transports will send. Do not invoke
// getters/toJSON hooks or silently turn unsupported values into missing/null.
function jsonArguments(value, budget) {
  const ancestors = new Set(); let count = 0;
  const invalid = () => new Error('Tool arguments must contain plain JSON data without accessors, custom types or cycles.');
  const copy = (input, depth) => {
    if (++count > 100_000 || depth > 128) throw new Error('JSON arguments exceed 128 levels or 100000 values.');
    budget.remaining();
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input === 0 ? 0 : input;
    if (typeof input !== 'object') throw invalid();
    const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
    // Also allow plain records from another realm, and null-prototype records.
    if ((!array && prototype !== null && Object.getPrototypeOf(prototype) !== null) || ancestors.has(input)) throw invalid();
    const properties = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(properties);
    if (array && (properties.length.value > 100_000 || keys.length !== properties.length.value + 1)) throw invalid();
    const output = array ? [] : {};
    ancestors.add(input);
    try {
      for (const key of keys) {
        if (array && key === 'length') continue;
        const property = properties[key];
        if (typeof key !== 'string' || !property.enumerable || !Object.hasOwn(property, 'value')) throw invalid();
        if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= properties.length.value)) throw invalid();
        Object.defineProperty(output, key, { value: copy(property.value, depth + 1), enumerable: true, writable: true, configurable: true });
      }
    } finally { ancestors.delete(input); }
    return output;
  };
  return copy(value, 0);
}

export async function browserFunctionTools(client, { allowedTools, browser, approve, timeoutMs = 60_000, signal: lifetimeSignal } = {}) {
  if (!Array.isArray(allowedTools) || !allowedTools.length || allowedTools.some(name => typeof name !== 'string' || !name))
    throw new Error('An explicit nonempty tool allowlist is required.');
  if (typeof browser !== 'string' || !browser.trim() || browser.length > 2048 || /[\r\n\0]/.test(browser))
    throw new Error('An explicit browser target from Kitsuvo is required.');
  if (typeof approve !== 'function') throw new Error('An application approval callback is required for every call.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180_000) throw new Error('Timeout must be 1–180000 milliseconds.');
  const names = [...new Set(allowedTools)];
  let inFlight = false, closed = false, active;
  const discovery = requestBudget(timeoutMs, lifetimeSignal);
  let catalog;
  try {
    catalog = await catalogOf(client, discovery);
  } finally { discovery.cleanup(); }
  const byName = new Map(catalog.map(tool => [tool.name, structuredClone(tool)]));
  if (names.some(name => !byName.has(name))) throw new Error('An allowed tool is unavailable in this connection.');
  const definitions = names.map(name => {
    const tool = byName.get(name), parameters = structuredClone(tool.inputSchema);
    // The application owns the immutable target. It is not a model argument.
    if (parameters.properties) delete parameters.properties.browser;
    if (parameters.required) parameters.required = parameters.required.filter(name => name !== 'browser');
    return { name, description: tool.description || name, parameters };
  });
  return {
    get definitions() { return structuredClone(definitions); },
    openai: () => definitions.map(tool => ({ type: 'function', ...structuredClone(tool), strict: false })),
    anthropic: () => definitions.map(({ name, description, parameters }) => ({ name, description, input_schema: structuredClone(parameters) })),
    async call(name, args = {}, { signal } = {}) {
      if (closed) throw new Error('Adapter is closed.');
      if (!names.includes(name)) throw new Error('Tool is not in this connection allowlist.');
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object.');
      if (inFlight) throw new Error('Another tool call is active; inspect its result before continuing.');
      const requestSignal = lifetimeSignal ? AbortSignal.any([lifetimeSignal, ...(signal ? [signal] : [])]) : signal;
      requestSignal?.throwIfAborted();
      const budget = requestBudget(timeoutMs, requestSignal);
      inFlight = true;
      active = budget;
      const work = (async () => {
        const input = jsonArguments(args, budget);
        if (Object.hasOwn(input, 'browser') && input.browser !== browser) throw new Error('Cannot substitute the bound browser target.');
        const arguments_ = { ...input, browser };
        budget.remaining();
        const approved = await budget.wait(approve({ name, arguments: structuredClone(arguments_) }, { signal: budget.signal }));
        if (closed) throw new Error('Adapter is closed.');
        if (approved !== true) throw new Error('Tool call was not approved.');
        // A changing catalog cannot silently replace an approved tool contract.
        const current = (await catalogOf(client, budget)).find(tool => tool.name === name);
        if (!current || JSON.stringify(canonical(current)) !== JSON.stringify(canonical(byName.get(name))))
          throw new Error('Tool contract changed. Recreate and review the adapter before calling it.');
        if (closed) throw new Error('Adapter is closed.');
        const timeout = budget.remaining();
        // Await the actual client promise here, retaining admission until it
        // settles even when the caller's cancellation race returns earlier.
        return await client.callTool({ name, arguments: arguments_, _meta: { 'kitsuvo/deadlineMs': timeout } },
          undefined, { timeout, signal: budget.signal });
      })().finally(() => { inFlight = false; active = undefined; });
      try { return await budget.wait(work); }
      finally { budget.cleanup(); }
    },
    // The application owns the MCP client's lifetime and browser cleanup.
    // Closing this adapter never closes another task's shared connection.
    close() { closed = true; active?.abort(new Error('Adapter is closed.')); },
  };
}
