// packages/mcp/src/tools/scan-contrast.ts
import { mcpFetch, pollScanJob } from '../client.js';
import { ScanContrastInput } from '../types.js';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const scanContrastTool = {
  name: 'scan_contrast',
  description:
    'Run a color contrast audit on a URL. Returns elements failing WCAG contrast ratios with severity and details.',
  inputSchema: ScanContrastInput,
  async handler(input: { url: string }): Promise<ToolResponse> {
    const { status, data } = await mcpFetch('/scan/contrast', {
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
