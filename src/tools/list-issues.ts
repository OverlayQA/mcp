// packages/mcp/src/tools/list-issues.ts
import { mcpFetch } from '../client.js';
import { ListIssuesInput } from '../types.js';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const listIssuesTool = {
  name: 'list_issues',
  description: 'List issues in a project, optionally filtered by status, severity, or custom labels. Returned issues include their label ids and names.',
  inputSchema: ListIssuesInput,
  async handler(input: {
    projectId: string;
    status?: string;
    severity?: string;
    labelIds?: string[];
  }): Promise<ToolResponse> {
    const params = new URLSearchParams({ projectId: input.projectId });
    if (input.labelIds?.length) params.set('labelIds', input.labelIds.join(','));
    if (input.status) params.set('status', input.status);
    if (input.severity) params.set('severity', input.severity);

    const { status, data } = await mcpFetch(`/issues?${params.toString()}`);

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      ...(status !== 200 ? { isError: true } : {}),
    };
  },
};
