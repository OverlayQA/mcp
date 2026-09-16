// packages/mcp/src/tools/update-issue.ts
import { mcpFetch } from '../client.js';
import { UpdateIssueInput } from '../types.js';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface UpdateIssueArgs {
  issueId: string;
  status: string;
}

/**
 * PATCH /api/mcp/issues/:id with the new status. The server route reuses the
 * dashboard's own update handler, so a teammate sees the same notification
 * as if the status had been changed in the app.
 */
export function buildUpdateIssueRequest(input: UpdateIssueArgs): {
  path: string;
  method: 'PATCH';
  body: { status: string };
} {
  return {
    path: `/issues/${encodeURIComponent(input.issueId)}`,
    method: 'PATCH',
    body: { status: input.status },
  };
}

export const updateIssueTool = {
  name: 'update_issue',
  description:
    "Change an issue's status (open, in-progress, resolved, verified or closed), for example to mark an issue resolved after you fixed it. Accepts the issue id or its display id such as OQ-12.",
  inputSchema: UpdateIssueInput,
  async handler(input: UpdateIssueArgs): Promise<ToolResponse> {
    const { path, method, body } = buildUpdateIssueRequest(input);
    const { status, data } = await mcpFetch(path, { method, body });

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      ...(status !== 200 ? { isError: true } : {}),
    };
  },
};
