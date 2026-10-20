import { randomBytes } from 'node:crypto';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createBridge } from '../server.mjs';

export const token = randomBytes(32).toString('base64url');
export const authorization = `Bearer ${token}`;
export const authenticatedBridge = (backend, options = {}) => createBridge(backend, { token, ...options });
export class AuthenticatedTransport extends StreamableHTTPClientTransport {
  constructor(url, options = {}) {
    super(url, { ...options, requestInit: { ...options.requestInit, headers: { Authorization: authorization, ...options.requestInit?.headers } } });
  }
}
export const authenticatedFetch = (url, options = {}) => globalThis.fetch(url, { ...options, headers: { Authorization: authorization, ...options.headers } });
