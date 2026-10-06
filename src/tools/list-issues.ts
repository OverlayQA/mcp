import { z } from 'zod';
import { ListIssuesInput } from '../types.js';
import { mcpFetch } from '../client.js';
import { toolResult } from './request.js';

/** RED stub: today's behaviour, the answer passed straight through. */
export function listIssuesResult(_input: Record<string, unknown>, result: { status: number; data: unknown }) {
  return toolResult(result);
}

export const listIssuesTool = {
  name: 'list_issues',
  description: 'List project issues with labels, description, ownership and ignored state. Filter by status, severity, type, labels, assignee, creator, or active/finished/ignored state. Returns page, pageSize, total and hasMore; continue to the next page while hasMore is true. Use get_issue for full capture evidence.',
  inputSchema: ListIssuesInput,
  async handler(input: z.infer<typeof ListIssuesInput>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && (!Array.isArray(value) || value.length)) params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    return listIssuesResult(input, await mcpFetch(`/issues?${params}`));
  },
};
