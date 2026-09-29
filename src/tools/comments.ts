import { z } from 'zod';
import { issueIdentifier } from '../types.js';
import { request, toolError } from './request.js';

const commentId = z.string().uuid().describe('Native comment UUID from list_comments');
const mentions = z.array(z.string().uuid()).max(20).describe('Teammate userIds from list_project_members. In content, use @[userId] for each mention.');
// Same product budget as shared/commentAttachments.ts: ten PNG/JPG/PDF files, 10 MiB total.
const files = z.array(z.object({
  filename: z.string().min(1).max(255).describe('Filename with .png, .jpg, .jpeg, or .pdf extension'),
  contentType: z.enum(['image/png', 'image/jpeg', 'application/pdf']).describe('File MIME type'),
  base64: z.string().min(1).max(Math.ceil(10 * 1024 * 1024 / 3) * 4).describe('Base64 file bytes, without a data URL prefix'),
})).max(10).optional().describe('Optional attachments; at most 10 MiB total. Server validates file bytes.');
const createInput = z.object({
  issueId: issueIdentifier,
  content: z.string().max(5000).describe('Comment text; may be empty when attaching files'),
  visibility: z.enum(['internal', 'public']).describe('internal = Team only; public = Team and clients'),
  mentionedUserIds: mentions.optional(),
  attachments: files,
  requestId: z.string().uuid().describe('New UUID for this comment. Reuse it only when retrying the same comment after an uncertain response, to avoid duplicates.'),
});

export const listCommentsTool = {
  name: 'list_comments',
  description: 'Read an issue discussion, including comment authors, audience, mentions and attachment metadata. Returns native and linked comments; edit/delete accept native comment IDs only.',
  inputSchema: z.object({ issueId: issueIdentifier }),
  handler: ({ issueId }: { issueId: string }) => request(`/issues/${encodeURIComponent(issueId)}/comments`),
};
export const createCommentTool = {
  name: 'create_comment',
  description: 'Post a comment with explicit audience (Team only or Team and clients), optional teammate mentions and PNG/JPG/PDF files. Reuse requestId when retrying the same submission after a lost response.',
  inputSchema: createInput,
  handler({ issueId, requestId, ...body }: z.infer<typeof createInput>) {
    if (!body.content.trim() && !body.attachments?.length) return Promise.resolve(toolError('Write a comment or attach a file.'));
    return request(`/issues/${encodeURIComponent(issueId)}/comments`, 'POST', { ...body, mentionedUserIds: body.mentionedUserIds ?? [] }, requestId);
  },
};
const updateInput = z.object({ issueId: issueIdentifier, commentId, content: z.string().min(1).max(5000).describe('Replacement comment text'), mentionedUserIds: mentions });
export const updateCommentTool = {
  name: 'update_comment',
  description: 'Edit your own native comment text and mention list. Audience and attached files stay unchanged. Supply the complete mention list, including retained mentions.',
  inputSchema: updateInput,
  handler({ issueId, commentId, ...body }: z.infer<typeof updateInput>) { return request(`/issues/${encodeURIComponent(issueId)}/comments/${commentId}`, 'PATCH', body); },
};
export const deleteCommentTool = {
  name: 'delete_comment',
  description: 'Delete your own native comment and its attached files. This also removes it from client-visible discussions when its audience was public.',
  inputSchema: z.object({ issueId: issueIdentifier, commentId }),
  handler: ({ issueId, commentId }: { issueId: string; commentId: string }) => request(`/issues/${encodeURIComponent(issueId)}/comments/${commentId}`, 'DELETE'),
};
export const getCommentAttachmentTool = {
  name: 'get_comment_attachment',
  description: 'Read a native comment attachment as filename and base64 bytes. Uses the same issue permissions as reading comments. Attachment IDs come from list_comments.',
  inputSchema: z.object({ issueId: issueIdentifier, commentId, attachmentId: z.string().uuid().describe('Attachment UUID from list_comments') }),
  handler: ({ issueId, commentId, attachmentId }: { issueId: string; commentId: string; attachmentId: string }) => request(`/issues/${encodeURIComponent(issueId)}/comments/${commentId}/attachments/${attachmentId}`),
};
