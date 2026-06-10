// packages/mcp/src/tools/create-project.ts
import { mcpFetch } from '../client.js';
import { CreateProjectInput } from '../types.js';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const createProjectTool = {
  name: 'create_project',
  description:
    'Create a new OverlayQA project. Returns the project id, name, slug, displayPrefix, and url.',
  inputSchema: CreateProjectInput,
  async handler(input: { name: string; url?: string }): Promise<ToolResponse> {
    const { status, data } = await mcpFetch('/projects', {
      method: 'POST',
      body: input,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      ...(status !== 201 ? { isError: true } : {}),
    };
  },
};
