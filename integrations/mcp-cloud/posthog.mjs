import { PostHog } from 'posthog-node';

const relayDistinctId = 'kitsuvo-mcp-relay';
const sources = new Set(['mcp-session', 'express', 'websocket-message', 'websocket', 'unhandled-rejection', 'uncaught-exception']);
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const paths = new Set(['/mcp', '/register', '/authorize', '/token', '/revoke', '/health',
  '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']);
const errorTypes = new Set(['Error', 'TypeError', 'SyntaxError', 'RangeError', 'URIError', 'AggregateError']);
const errorCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE']);

export const noopTelemetry = Object.freeze({
  captureException() {},
  async shutdown() {},
});

// Parser/SDK exceptions can contain complete request bodies, URLs or credentials
// in their messages, causes and stack. Send a fresh generic exception and bounded
// service context only; never pass the original error object to an external SDK.
export function createPostHogTelemetry({ env = process.env, PostHogClient = PostHog } = {}) {
  const apiKey = env.KITSUVO_POSTHOG_KEY;
  if (!apiKey) return noopTelemetry;

  const client = new PostHogClient(apiKey, {
    ...(env.POSTHOG_HOST ? { host: env.POSTHOG_HOST } : {}),
    disableGeoip: true,
    enableExceptionAutocapture: false,
  });

  return {
    captureException(error, context = {}) {
      try {
        const name = errorTypes.has(error?.name) ? error.name : 'Error';
        const safeError = new Error('Relay service operation failed');
        safeError.name = name;
        safeError.stack = `${name}: Relay service operation failed`;
        const properties = {
          service: relayDistinctId,
          source: sources.has(context.source) ? context.source : 'unknown',
          error_type: name,
        };
        if (errorCodes.has(error?.code)) properties.error_code = error.code;
        if (context.method) properties.method = methods.has(context.method) ? context.method : 'other';
        if (context.path) properties.path = paths.has(context.path) ? context.path : 'other';
        client.captureException(safeError, relayDistinctId, properties);
      } catch {
        // Telemetry must never interfere with relaying or error handling.
      }
    },
    async shutdown() {
      try {
        // posthog-node drains its event queue as part of shutdown.
        await client.shutdown();
      } catch {
        // A telemetry outage must not delay process shutdown.
      }
    },
  };
}
