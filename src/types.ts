/**
 * Zod schemas for MCP tool inputs.
 *
 * These schemas drive both runtime validation (the `inputSchema.shape` is
 * passed to the MCP SDK's `server.tool()` in Task 17) and the descriptions
 * the LLM sees when deciding how to call a tool. Every field should have a
 * `.describe(...)` so the tool docs are self-explanatory.
 */
import { z } from 'zod';

export const ScanAccessibilityInput = z.object({
  url: z.string().url().describe('The URL to scan for accessibility issues'),
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe('Optional project ID to associate results with'),
});

export const ScanContrastInput = z.object({
  url: z.string().url().describe('The URL to scan for color contrast issues'),
});

export const CompareVisualInput = z.object({
  url: z.string().url().describe('The live URL to compare'),
  figmaFileKey: z.string().describe('Figma file key (from the Figma URL)'),
  figmaNodeId: z.string().describe('Figma node ID of the frame to compare against'),
});

export const AuditTokensInput = z.object({
  url: z.string().url().describe('The URL to audit for design token usage'),
  figmaFileKey: z
    .string()
    .optional()
    .describe('Optional Figma file key for token comparison'),
});

export const ScanAndCreateIssuesInput = z.object({
  url: z.string().url().describe('The URL to scan'),
  projectId: z.string().uuid().describe('Project to create issues in'),
  minSeverity: z
    .enum(['critical', 'high', 'medium', 'low'])
    .optional()
    .describe('Minimum severity to create issues for (default: medium)'),
});

export const CreateIssueInput = z.object({
  projectId: z.string().uuid().describe('Project to create the issue in'),
  title: z.string().min(1).max(200).describe('Issue title'),
  severity: z
    .enum(['critical', 'high', 'medium', 'low'])
    .optional()
    .describe('Issue severity (default: medium)'),
  type: z
    .enum(['design-bug', 'design-gap', 'improvement', 'general', 'design-debt', 'accessibility', 'design-token'])
    .optional()
    .describe('Issue type (default: general)'),
  description: z.string().optional().describe('Issue description'),
  assigneeId: z.string().uuid().nullable().optional().describe('Teammate userId from list_project_members; null means Unassigned; omitted assigns to you'),
});

const status = z.enum(['open', 'in-progress', 'resolved', 'verified', 'closed']);
const severity = z.enum(['critical', 'high', 'medium', 'low']);
const issueType = CreateIssueInput.shape.type.unwrap();
const oneOrMany = <T extends z.ZodTypeAny>(value: T) => z.union([value, z.array(value).min(1)]);
export const issueIdentifier = z.string().min(1).describe('Issue UUID or display id such as OQ-12');

export const ListIssuesInput = z.object({
  projectId: z.string().uuid().describe('Project to list issues from'),
  status: oneOrMany(status).optional().describe('One or more statuses; combines with state'),
  severity: oneOrMany(severity).optional().describe('One or more severities'),
  type: oneOrMany(issueType).optional().describe('One or more issue types'),
  labelIds: z.array(z.union([z.string().uuid(), z.literal('unlabeled')])).optional().describe('Match any selected label, or unlabeled'),
  assigneeId: z.union([z.string().uuid(), z.literal('unassigned'), z.literal('me')]).optional().describe('Filter by teammate userId, me, or unassigned'),
  createdById: z.union([z.string().uuid(), z.literal('me')]).optional().describe('Filter by creator userId or me'),
  state: z.enum(['all', 'active', 'finished', 'ignored']).optional().describe('Default all. Active means open/in-progress and not ignored. Finished means resolved/verified/closed and not ignored. Ignored is separate from status.'),
  createdAfter: z.string().datetime({ offset: true }).optional().describe('Only issues created after this ISO-8601 instant with a zone, such as 2026-10-05T22:00:00Z. Pass the createdAt of the newest issue already seen to ask for what is new.'),
  pageUrl: z.string().url().max(2000).optional().describe('Only issues captured on this page URL, as returned in pageUrl. The query string is ignored.'),
  page: z.number().int().min(1).optional().describe('Page number, starting at 1; use hasMore to continue'),
  pageSize: z.number().int().min(1).max(100).optional().describe('Issues per page, up to 100 (default 100)'),
});

export const ListProjectsInput = z
  .object({})
  .describe("No input — lists all projects in the user's team");

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(100).describe('Project name'),
  url: z.string().url().optional().describe('Primary URL for this project'),
});

export const UpdateIssueInput = z.object({
  issueId: issueIdentifier,
  status: status.optional().describe('New status; marking verified records a status, it does not run verification'),
  title: z.string().min(1).max(200).optional().describe('Replacement title'),
  description: z.string().optional().describe('Replacement description, or empty to clear'),
  severity: severity.optional().describe('New severity'),
  type: issueType.optional().describe('New issue type'),
  assigneeId: z.string().uuid().nullable().optional().describe('Teammate userId from list_project_members, or null to unassign'),
  ignored: z.boolean().optional().describe('Ignore (true) or restore (false), without changing status'),
});
