// packages/mcp/src/tools/scan-and-create-issues.ts
import { mcpFetch } from '../client.js';
import { quotaFooter } from '../quota.js';
import { ScanAndCreateIssuesInput } from '../types.js';

interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export const scanAndCreateIssuesTool = {
  name: 'scan_and_create_issues',
  description:
    'Run an accessibility scan on a URL and automatically create issues in the given project for each violation at or above the minimum severity. Returns scan summary + issue IDs created. Scans one page per call. Free plans include 3 scans per day; Pro is unlimited.',
  inputSchema: ScanAndCreateIssuesInput,
  async handler(input: {
    url: string;
    projectId: string;
    minSeverity?: string;
  }): Promise<ToolResponse> {
    const { status, data } = await mcpFetch('/scan/accessibility-and-create-issues', {
      method: 'POST',
      body: input,
    });

    const { remaining, limit } = (data ?? {}) as { remaining?: number; limit?: number };
    const footer = status === 200 ? quotaFooter(remaining, limit) : '';

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) + footer }],
      ...(status !== 200 ? { isError: true } : {}),
    };
  },
};
