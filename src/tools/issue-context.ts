import { z } from 'zod';
import { issueIdentifier } from '../types.js';
import { request } from './request.js';

export const getIssueTool = {
  name: 'get_issue',
  description: 'Read a complete issue by UUID or display id: description, labels, assignee, ignored state, screenshot URLs, captured element/CSS and viewport evidence. Use list_comments for the discussion.',
  inputSchema: z.object({ issueId: issueIdentifier }),
  handler: ({ issueId }: { issueId: string }) => request(`/issues/${encodeURIComponent(issueId)}`),
};

export const listProjectMembersTool = {
  name: 'list_project_members',
  description: 'List workspace teammates for a readable project. Use their userId for assignment and comment mentions. Returns the signed-in userId too.',
  inputSchema: z.object({ projectId: z.string().uuid().describe('Project UUID from list_projects') }),
  handler: ({ projectId }: { projectId: string }) => request(`/projects/${projectId}/members`),
};

export const moveIssueTool = {
  name: 'move_issue',
  description: 'Move an issue into another project in the same workspace, preserving its identity, comments and evidence. Requires write access to both projects. Returns its new display id; use that id afterward.',
  inputSchema: z.object({ issueId: z.string().uuid().describe('Stable issue UUID from get_issue or list_issues'), targetProjectId: z.string().uuid().describe('Destination project UUID') }),
  handler: ({ issueId, targetProjectId }: { issueId: string; targetProjectId: string }) => request(`/issues/${issueId}/move`, 'POST', { targetProjectId }),
};
