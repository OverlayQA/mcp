/**
 * Client-side telemetry: what the OverlayQA server learns about a tool call
 * beyond the call itself, and how it travels.
 *
 * Two request headers, both optional, both read by routes/mcp/telemetry.ts
 * on the server:
 *
 *   x-overlayqa-mcp-intent   the agent-stated purpose for THIS call, taken
 *                            from the `context` argument every tool advertises
 *                            (URI-encoded: headers are ASCII). Stripped from
 *                            the arguments before the tool handler runs, and
 *                            scoped to the call with AsyncLocalStorage so two
 *                            concurrent calls never swap purposes.
 *   x-overlayqa-mcp-client   `<name>/<version>` of the editor, from the MCP
 *                            initialize handshake (clientInfo). Says whether a
 *                            call came from Claude Code, Cursor or Windsurf.
 *
 * What is deliberately NOT sent: the conversation, the tool's response, or
 * any argument the tool itself does not need. The server caps and redacts the
 * purpose; the privacy policy (overlayqa.com/privacy, Usage Data) discloses
 * both headers.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

export interface ToolResponse {
  // The MCP SDK types a tool result as an open record, so the index signature
  // is what lets these tools register without a cast.
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** A tool file's export: its own concrete input shape and handler. */
export interface RawTool {
  name: string;
  description: string;
  inputSchema: { shape: Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<ToolResponse>;
}

/** What is registered with the MCP SDK: the same tool plus the context field. */
export interface WrappedTool {
  name: string;
  description: string;
  inputSchema: { shape: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<ToolResponse>;
}

export const CONTEXT_MAX_CHARS = 280;

/**
 * Advertised on every tool. The description is the instruction the agent
 * reads, so it asks for the purpose and forbids the things that must never
 * travel: this is the same pattern PostHog's own MCP uses for its `context`
 * argument.
 */
export const CONTEXT_FIELD = z
  .string()
  .max(CONTEXT_MAX_CHARS)
  .optional()
  .describe(
    'One sentence on why you are calling this tool, for OverlayQA product analytics. Describe the purpose only ' +
      '(for example "checking the checkout page for contrast issues"). Never include credentials, personal data, ' +
      "or the user's message verbatim.",
  );

const intentStore = new AsyncLocalStorage<string | undefined>();

/** Run `fn` with `intent` as the purpose every request inside it carries. */
export function withIntent<T>(intent: string | undefined, fn: () => Promise<T>): Promise<T> {
  return intentStore.run(intent, fn);
}

/** The purpose of the tool call currently executing, if the agent supplied one. */
export function currentIntent(): string | undefined {
  return intentStore.getStore();
}

type ClientInfo = { name: string; version: string } | undefined;
let clientInfoProvider: () => ClientInfo = () => undefined;

/**
 * The editor's identity is only known after the MCP initialize handshake, so
 * the entry point hands over a reader rather than a value.
 */
export function setClientInfoProvider(provider: () => ClientInfo): void {
  clientInfoProvider = provider;
}

/** Headers mcpFetch merges into every request; empty when nothing is known. */
export function buildTelemetryHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const client = clientInfoProvider();
  if (client?.name) {
    headers['x-overlayqa-mcp-client'] = client.version ? `${client.name}/${client.version}` : client.name;
  }
  const intent = currentIntent();
  if (intent) {
    headers['x-overlayqa-mcp-intent'] = encodeURIComponent(intent);
  }
  return headers;
}

/**
 * Adds the `context` argument to a tool's advertised schema, strips it from
 * the arguments the tool sees, and scopes the purpose around the handler.
 */
export function wrapTool(tool: RawTool): WrappedTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: { shape: { ...tool.inputSchema.shape, context: CONTEXT_FIELD } },
    handler: (args) => {
      const { context, ...rest } = args;
      const intent = typeof context === 'string' && context.trim() ? context.trim() : undefined;
      return withIntent(intent, () => tool.handler(rest));
    },
  };
}
