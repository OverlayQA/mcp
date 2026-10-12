import { z } from 'zod';
import { mcpFetch } from '../client.js';
import { toolError, toolResult } from './request.js';

const projectId = z.string().uuid().describe('Project UUID from list_projects');
const reviewId = z.string().uuid().describe('Client review UUID from list_client_reviews; not the public link token');
const emails = z.array(z.string().max(320)).max(20)
  .describe('Complete client email list. Existing addresses keep their invitation and reminder history; omitted addresses are removed.');
const expiresAt = z.string().datetime().optional().describe('Expiry as an ISO-8601 UTC instant');
const allowResponsiveViews = z.boolean().optional();

export const listClientReviewsInput = z.object({ projectId });
export const createClientReviewInput = z.object({
  projectId,
  pageUrl: z.string().url().max(2000).refine(value => /^https?:\/\//i.test(value), 'Use HTTP or HTTPS'),
  mode: z.enum(['live', 'snapshot']),
  title: z.string().trim().max(200).optional(),
  clientEmails: emails.optional(),
  welcomeNote: z.string().max(500).optional().describe('Optional note shown to guests at the top of the review'),
  privateComments: z.boolean().optional().describe('When true, each guest sees only their own comments; teammates can see all comments'),
  expiresAt, allowResponsiveViews,
  viewportWidth: z.number().int().min(320).max(3840).optional(),
  viewportHeight: z.number().int().min(320).max(2160).optional(),
});
export const updateClientReviewInput = z.object({
  reviewId, revoke: z.boolean().optional(), expiresAt, allowResponsiveViews,
});
export const setClientReviewRecipientsInput = z.object({ reviewId, emails });

/** Older APIs must not turn an unavailable review capability into an empty list. */
export function clientReviewResult(result: { status: number; data: unknown }) {
  const body = result.data as { error?: { message?: string } } | null;
  if (result.status === 404 && (!body || typeof body !== 'object' || body.error?.message === 'Route not found')) {
    return toolError('Client review tools are not available on this server. Update the server before using this client.', 'CLIENT_REVIEWS_UNAVAILABLE');
  }
  return toolResult(result);
}
async function request(path: string, method = 'GET', body?: unknown) {
  return clientReviewResult(await mcpFetch(path, { method, body }));
}

export const listClientReviewsTool = {
  name: 'list_client_reviews',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  description: 'List a project’s client review links, share URLs, titles, capture status, expiry, visits, comments, doneReviewers and clients. Each client includes invitedAt, inviteFailed, lastReminderAt, done, commented and unsubscribed. Done reviewing means that reviewer finished giving feedback, not that issues are fixed or that every client is done. invitationsEnabled reports the delivery switch; reminders follow the existing automatic schedule.',
  inputSchema: listClientReviewsInput,
  handler: ({ projectId }: z.infer<typeof listClientReviewsInput>) => request(`/client-reviews/project/${projectId}`),
};
export const createClientReviewTool = {
  name: 'create_client_review',
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  description: 'Create a public client review link for a website in a writable project, optionally with a title, client emails, welcome note and private guest comments. Snapshot mode starts asynchronous capture; read list_client_reviews for readiness. New client emails may receive an invitation and automatic day 3/7/10 reminders. Requires explicit intent to share and, when emails are supplied, invite those people. If invitationsEnabled is false, addresses are saved but not sent and may be invited when delivery is enabled. Inspect invites for per-address sent/skipped results. After a lost response, list links before creating again to avoid duplicates.',
  inputSchema: createClientReviewInput,
  handler: (body: z.infer<typeof createClientReviewInput>) => request('/client-reviews', 'POST', body),
};
export const updateClientReviewTool = {
  name: 'update_client_review',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  description: 'Change a client review link’s expiry or responsive previews, or revoke/restore access. Supply only fields to change. Revoked or expired links stop scheduled reminders. This does not mark a reviewer done or change issue status.',
  inputSchema: updateClientReviewInput,
  handler: ({ reviewId, ...body }: z.infer<typeof updateClientReviewInput>) => {
    if (!Object.keys(body).length) return Promise.resolve(toolError('Supply revoke, expiresAt or allowResponsiveViews.'));
    return request(`/client-reviews/${reviewId}`, 'PATCH', body);
  },
};
export const setClientReviewRecipientsTool = {
  name: 'set_client_review_recipients',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  description: 'Replace a client review link’s COMPLETE client email list. Requires explicit intent to invite or remove these people. New addresses may receive an invitation and automatic day 3/7/10 reminders; retained addresses keep their history and are not invited again. Removed addresses stop reminders; an empty list removes all recipients but leaves the public link working. If invitationsEnabled is false, addresses are saved for later delivery. Read clients and invites for actual per-address state. Reminders stop after that address comments, marks done, unsubscribes, or the link expires/is revoked.',
  inputSchema: setClientReviewRecipientsInput,
  handler: ({ reviewId, ...body }: z.infer<typeof setClientReviewRecipientsInput>) => request(`/client-reviews/${reviewId}/recipients`, 'PUT', body),
};
