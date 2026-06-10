// packages/mcp/src/tools/create-issue.ts
import { mcpFetch } from '../client.js';
import { CreateIssueInput } from '../types.js';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const createIssueTool = {
  name: 'create_issue',
  description:
    'Create an issue in an OverlayQA project. Title is required; severity, type, and description default to medium / design-bug / empty.',
  inputSchema: CreateIssueInput,
  async handler(input: {
    projectId: string;
    title: string;
    severity?: string;
    type?: string;
    description?: string;
  }): Promise<ToolResponse> {
    const { status, data } = await mcpFetch('/issues', {
      method: 'POST',
      body: input,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      ...(status !== 201 ? { isError: true } : {}),
    };
  },
};
