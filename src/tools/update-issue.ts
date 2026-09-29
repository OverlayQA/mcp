import { z } from 'zod';
import { UpdateIssueInput } from '../types.js';
import { request, toolError } from './request.js';

export type UpdateIssueArgs = z.infer<typeof UpdateIssueInput>;
export function buildUpdateIssueRequest(input: UpdateIssueArgs) {
  const { issueId, ...body } = input;
  return { path: `/issues/${encodeURIComponent(issueId)}`, method: 'PATCH' as const, body };
}

export const updateIssueTool = {
  name: 'update_issue',
  description: 'Update issue status, title, description, severity, type, assignee, or ignored state. Only supplied fields change. Use null to unassign and ignored=false to restore. Accepts UUID or display id. Status verified does not run a verification scan.',
  inputSchema: UpdateIssueInput,
  async handler(input: UpdateIssueArgs) {
    const { path, method, body } = buildUpdateIssueRequest(input);
    if (!Object.values(body).some(value => value !== undefined)) return toolError('Provide at least one field to update.');
    return request(path, method, body);
  },
};
