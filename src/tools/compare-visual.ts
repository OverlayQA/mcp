// packages/mcp/src/tools/compare-visual.ts
import { mcpFetch } from '../client.js';
import { CompareVisualInput } from '../types.js';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const compareVisualTool = {
  name: 'compare_visual',
  description:
    'Compare a live URL against a Figma frame. Returns visual differences and a match score.',
  inputSchema: CompareVisualInput,
  async handler(input: {
    url: string;
    figmaFileKey: string;
    figmaNodeId: string;
  }): Promise<ToolResponse> {
    const { status, data } = await mcpFetch('/compare/visual', {
      method: 'POST',
      body: input,
    });

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      ...(status !== 200 ? { isError: true } : {}),
    };
  },
};
