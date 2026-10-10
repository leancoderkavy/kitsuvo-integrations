export const BROWSER_RESOURCE_URI: 'ui://kitsuvo/browser.html';
export interface ToolResult {
  content: Array<Record<string, unknown>>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}
export interface EmbedClient {
  readResource(request: { uri: string }): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string }> }>;
  callTool(request: { name: string; arguments?: Record<string, unknown> }): Promise<ToolResult>;
}
export interface KitsuvoEmbed {
  iframe: HTMLIFrameElement;
  refresh(): Promise<ToolResult>;
  navigate(url: string): Promise<ToolResult>;
  update(result: ToolResult): Promise<void>;
  setTheme(theme: 'light' | 'dark'): Promise<void>;
  destroy(): Promise<void>;
}
export function mountKitsuvo(container: HTMLElement, options: {
  client: EmbedClient;
  initialUrl?: string;
  theme?: 'light' | 'dark';
  timeout?: number;
  hostInfo?: { name: string; version: string };
}): Promise<KitsuvoEmbed>;
