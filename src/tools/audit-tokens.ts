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
    "Audit a live URL's design-system token usage. Returns a 0-100 token-health score plus findings (inconsistent font sizes, text colors, spacing, font families, border radii) with severity and evidence. Audits the live page only; the figmaFileKey argument is accepted but Figma comparison is not yet available via MCP.",
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
