// packages/mcp/src/tools/list-projects.ts
import { mcpFetch } from '../client.js';
import { ListProjectsInput } from '../types.js';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const listProjectsTool = {
  name: 'list_projects',
  description: "List all OverlayQA projects in the authenticated user's team.",
  inputSchema: ListProjectsInput,
  async handler(_input: Record<string, never>): Promise<ToolResponse> {
    const { status, data } = await mcpFetch('/projects');

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      ...(status !== 200 ? { isError: true } : {}),
    };
  },
};
