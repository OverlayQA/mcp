/**
 * Zod schemas for all 10 MCP tool inputs.
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
    .describe('Issue type (default: design-bug)'),
  description: z.string().optional().describe('Issue description'),
});

export const ListIssuesInput = z.object({
  projectId: z.string().uuid().describe('Project to list issues from'),
  status: z
    .enum(['open', 'in-progress', 'resolved', 'verified', 'closed'])
    .optional()
    .describe('Filter by status'),
  severity: z
    .enum(['critical', 'high', 'medium', 'low'])
    .optional()
    .describe('Filter by severity'),
});

export const ListProjectsInput = z
  .object({})
  .describe("No input — lists all projects in the user's team");

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(100).describe('Project name'),
  url: z.string().url().optional().describe('Primary URL for this project'),
});

export const UpdateIssueInput = z.object({
  issueId: z.string().min(1).describe('Issue id, or its display id such as OQ-12'),
  status: z
    .enum(['open', 'in-progress', 'resolved', 'verified', 'closed'])
    .describe('The new status'),
});
