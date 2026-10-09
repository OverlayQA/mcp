import { z } from 'zod';
import { issueIdentifier } from '../types.js';
import { request } from './request.js';

export const verifyIssueTool = {
  name: 'verify_issue',
  description: 'Check whether a resolved, verified, or closed issue is fixed on its public page. Uses the existing capture and verification engine and your verification allowance. Requires an original screenshot and a verifiable issue type. Returns the saved verdict, explanation, confidence, and after-screenshot evidence; passed_with_caveat, failed, inconclusive, and error are not an unconditional pass. Does not change issue status. Login-required and localhost pages need the browser extension. Reuse requestId only when retrying the same check after a lost response. Availability follows the verification rollout.',
  inputSchema: z.object({
    issueId: issueIdentifier,
    requestId: z.string().uuid().describe('New UUID per verification; reuse to retry the same check without creating another result'),
  }),
  handler: ({ issueId, requestId }: { issueId: string; requestId: string }) =>
    request(`/issues/${encodeURIComponent(issueId)}/verify`, 'POST', { idempotencyKey: requestId }),
};

export const getIssueVerificationsTool = {
  name: 'get_issue_verifications',
  description: 'Read the latest 50 saved verification results for an issue, newest first. Includes verdicts, explanations, confidence, after-screenshot URLs, capture context, and timestamps. This does not run a new check. An issue status of verified or a no-longer-detected flag alone is not a verification pass.',
  inputSchema: z.object({ issueId: issueIdentifier }),
  handler: ({ issueId }: { issueId: string }) => request(`/issues/${encodeURIComponent(issueId)}/verifications`),
};
