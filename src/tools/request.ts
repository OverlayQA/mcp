import { mcpFetch } from '../client.js';

export function toolError(message: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: true, code: 'INVALID_INPUT', message }) }], isError: true };
}

export async function request(path: string, method = 'GET', body?: unknown, idempotencyKey?: string) {
  const result = await mcpFetch(path, { method, body, idempotencyKey });
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
    ...(result.status < 200 || result.status >= 300 ? { isError: true } : {}),
  };
}
