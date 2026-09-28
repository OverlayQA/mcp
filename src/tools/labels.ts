import { z } from 'zod';
import { mcpFetch } from '../client.js';

const projectId = z.string().uuid().describe('A project in the workspace whose labels to use');
const labelId = z.string().uuid().describe('Label id returned by list_labels or create_label');
const name = z.string().min(1).max(50).describe('Label name, shared across the workspace');
async function request(path: string, method = 'GET', body?: unknown) {
  const result = await mcpFetch(path, { method, body });
  return { content: [{ type: 'text' as const, text: JSON.stringify(result.data, null, 2) }],
    ...(result.status < 200 || result.status >= 300 ? { isError: true } : {}) };
}

export const listLabelsTool = {
  name: 'list_labels',
  description: 'List the workspace label library and your write/manage permissions. Optionally include an issue UUID to see its assigned labels.',
  inputSchema: z.object({ projectId, issueId: z.string().uuid().optional() }),
  handler: (input: { projectId: string; issueId?: string }) => request(`/labels?${new URLSearchParams(input)}`),
};
export const createLabelTool = {
  name: 'create_label',
  description: 'Create a reusable workspace label. Editors can create labels; retries and case-insensitive duplicate names return the existing label. Apply it with set_issue_label.',
  inputSchema: z.object({ projectId, name }),
  handler: (input: { projectId: string; name: string }) => request('/labels', 'POST', input),
};
export const renameLabelTool = {
  name: 'rename_label',
  description: 'Rename a label throughout its workspace. Requires workspace owner or admin permission. Assignments are preserved; existing shared reports keep their original names.',
  inputSchema: z.object({ projectId, labelId, name }),
  handler: (input: { projectId: string; labelId: string; name: string }) => request(`/labels/${input.labelId}`, 'PATCH', { projectId: input.projectId, name: input.name }),
};
export const deleteLabelTool = {
  name: 'delete_label',
  description: 'Delete a label from the workspace and all its issues. Requires workspace owner or admin permission. Issues themselves are retained.',
  inputSchema: z.object({ projectId, labelId }),
  handler: (input: { projectId: string; labelId: string }) => request(`/labels/${input.labelId}?${new URLSearchParams({ projectId: input.projectId })}`, 'DELETE'),
};
export const setIssueLabelTool = {
  name: 'set_issue_label',
  description: 'Apply (applied=true) or remove (applied=false) one workspace label on an issue. Other labels and issue text remain unchanged. Safe to retry.',
  inputSchema: z.object({ issueId: z.string().uuid().describe('Issue UUID from list_issues'), labelId, applied: z.boolean() }),
  handler: (input: { issueId: string; labelId: string; applied: boolean }) => request(`/labels/${input.labelId}/assignment`, 'PUT', { issueId: input.issueId, applied: input.applied }),
};
