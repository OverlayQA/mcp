// packages/mcp/src/tools/scan-accessibility.ts
import { mcpFetch, pollScanJob } from '../client.js';
import { quotaFooter } from '../quota.js';
import { ScanAccessibilityInput } from '../types.js';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const scanAccessibilityTool = {
  name: 'scan_accessibility',
  description:
    'Run an accessibility audit on a URL. Returns WCAG violations with severity, descriptions, and an overall score. Scans one page per call. Free plans include 3 scans per day; Pro is unlimited.',
  inputSchema: ScanAccessibilityInput,
  async handler(input: { url: string; projectId?: string }): Promise<ToolResponse> {
    const { status, data } = await mcpFetch('/scan/accessibility', {
      method: 'POST',
      body: input,
    });

    if (status !== 200) {
      return { content: [{ type: 'text', text: JSON.stringify(data) }], isError: true };
    }

    const { jobId, remaining, limit } = data as {
      jobId: string;
      remaining?: number;
      limit?: number;
    };
    const result = await pollScanJob(jobId);

    const isFailed =
      result.status !== 200 || (result.data as { status?: string } | null)?.status === 'failed';

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result.data, null, 2) + quotaFooter(remaining, limit),
        },
      ],
      ...(isFailed ? { isError: true } : {}),
    };
  },
};
