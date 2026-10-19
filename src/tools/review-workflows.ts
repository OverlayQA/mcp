import { z } from 'zod';
import { mcpFetch } from '../client.js';
import { RunAutoReviewInput, GetReviewResultInput } from '../types.js';
import { request, toolResult } from './request.js';

export const runAutoReviewTool = {
  name: 'run_auto_review',
  description: 'Start Auto Review of a public page in a readable project. Uses your scan allowance and the project’s review settings, ignored findings and already-filed issues. Returns a persistent job ID; results include findings, scores, AI status and screenshot evidence. Does not create issues. Login-required pages need the browser extension.',
  inputSchema: RunAutoReviewInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: (input: z.infer<typeof RunAutoReviewInput>) => request('/scan/auto-review', 'POST', input),
};
export const getReviewResultTool = {
  name: 'get_review_result',
  description: 'Read a previously started review without starting or charging for another run. Returns running progress, failed details, or the complete Auto Review or visual-comparison findings and evidence. Results are retained for 24 hours by default and require access to the original project and workspace.',
  inputSchema: GetReviewResultInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler({ jobId }: z.infer<typeof GetReviewResultInput>) {
    const response = await mcpFetch(`/scan/review-result/${encodeURIComponent(jobId)}`);
    const body = response.data as { status?: string };
    return { ...toolResult(response), ...(body?.status === 'failed' ? { isError: true } : {}) };
  },
};
