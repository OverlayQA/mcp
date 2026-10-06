import { mcpFetch } from '../client.js';

export function toolError(message: string, code = 'INVALID_INPUT') {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: true, code, message }) }], isError: true };
}

/** A REST answer as a tool result: the body as text, flagged when the status is not 2xx. */
export function toolResult(result: { status: number; data: unknown }) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
    ...(result.status < 200 || result.status >= 300 ? { isError: true } : {}),
  };
}

export async function request(path: string, method = 'GET', body?: unknown, idempotencyKey?: string) {
  return toolResult(await mcpFetch(path, { method, body, idempotencyKey }));
}
