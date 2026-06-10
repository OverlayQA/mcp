// packages/mcp/src/tools/audit-tokens.ts
import { mcpFetch } from '../client.js';
import { AuditTokensInput } from '../types.js';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const auditTokensTool = {
  name: 'audit_tokens',
  description:
    'Audit a live URL for design token usage and compliance. Optionally compares against a Figma file.',
  inputSchema: AuditTokensInput,
  async handler(input: { url: string; figmaFileKey?: string }): Promise<ToolResponse> {
    const { status, data } = await mcpFetch('/audit/tokens', {
      method: 'POST',
      body: input,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      ...(status !== 200 ? { isError: true } : {}),
    };
  },
};
