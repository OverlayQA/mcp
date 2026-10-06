import { z } from 'zod';
import { ListIssuesInput } from '../types.js';
import { mcpFetch } from '../client.js';
import { toolError, toolResult } from './request.js';

/** Filters a server must echo back in `filters` once it has applied them. */
const ECHOED_FILTERS = ['createdAfter', 'pageUrl'] as const;

/**
 * A server older than these filters strips the query keys it does not know
 * and answers with the whole project. Read as-is, an agent polling with
 * createdAfter would take every old issue for a new one. Servers that apply a
 * filter echo it, so an answer without the echo is refused instead.
 */
export function listIssuesResult(input: z.infer<typeof ListIssuesInput>, result: { status: number; data: unknown }) {
  const ok = result.status >= 200 && result.status < 300;
  const echoed = (result.data as { filters?: Record<string, unknown> } | null)?.filters ?? {};
  const ignored = ok ? ECHOED_FILTERS.filter((key) => input[key] !== undefined && echoed[key] == null) : [];
  if (ignored.length) {
    return toolError(
      `The OverlayQA server did not apply ${ignored.join(' and ')}, so its answer would have listed issues outside that filter. Retry without ${ignored.length > 1 ? 'them' : 'it'}, or try again later.`,
      'FILTER_NOT_SUPPORTED',
    );
  }
  return toolResult(result);
}

export const listIssuesTool = {
  name: 'list_issues',
  description: 'List project issues with labels, description, ownership and ignored state. Filter by status, severity, type, labels, assignee, creator, page (pageUrl), or active/finished/ignored state, and use createdAfter to ask only for issues newer than the last one seen. Each issue carries source (client means a reviewer filed it on a share link), commentCount, lastCommentAt and lastCommentBy (reviewer or team): an issue still needs a reply when source is client and commentCount is 0, or lastCommentBy is reviewer. Returns page, pageSize, total and hasMore; continue to the next page while hasMore is true. Use get_issue for full capture evidence and the discussion.',
  inputSchema: ListIssuesInput,
  async handler(input: z.infer<typeof ListIssuesInput>) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && (!Array.isArray(value) || value.length)) params.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    return listIssuesResult(input, await mcpFetch(`/issues?${params}`));
  },
};
