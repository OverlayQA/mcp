// packages/mcp/src/tools/scan-accessibility.ts
import { mcpFetch, pollScanJob } from '../client.js';
import { ScanAccessibilityInput } from '../types.js';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const scanAccessibilityTool = {
  name: 'scan_accessibility',
  description:
    'Run an accessibility audit on a URL. Returns WCAG violations with severity, descriptions, and an overall score.',
  inputSchema: ScanAccessibilityInput,
  async handler(input: { url: string; projectId?: string }): Promise<ToolResponse> {
    const { status, data } = await mcpFetch('/scan/accessibility', {
      method: 'POST',
      body: input,
    });

    if (status !== 200) {
      return { content: [{ type: 'text', text: JSON.stringify(data) }], isError: true };
    }

    const { jobId } = data as { jobId: string };
    const result = await pollScanJob(jobId);

    const isFailed =
      result.status !== 200 || (result.data as { status?: string } | null)?.status === 'failed';

    return {
      content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }],
      ...(isFailed ? { isError: true } : {}),
    };
  },
};
