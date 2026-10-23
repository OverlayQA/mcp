// Keep in sync with the server MCP workflowActionDefinitions.ts.
import { z } from 'zod';

const id = z.string().uuid();
const identifier = z.string().min(1).max(200);
export const exportProvider = z.enum(['jira', 'linear', 'asana', 'trello', 'notion', 'clickup', 'github', 'basecamp']);
export const fileReviewInput = z.object({
  jobId: id.describe('Completed MCP Auto Review or visual comparison job ID'),
  findingIndexes: z.array(z.number().int().min(0)).min(1).max(50).describe('Zero-based indexes in result.findings (Auto Review) or result.diffs (comparison). Only explicitly selected findings are filed.'),
});
export const createScheduleInput = z.object({
  projectId: id, url: z.string().url().max(2048),
  scanType: z.enum(['accessibility', 'contrast', 'tokens', 'auto_review']),
  cadence: z.enum(['daily', 'weekly', 'monthly']),
  confirmLoginPage: z.boolean().optional().describe('True only when the user explicitly wants to review the sign-in page itself'),
});
export const updateScheduleInput = z.object({
  scheduleId: id, cadence: z.enum(['daily', 'weekly', 'monthly']).optional(), action: z.enum(['pause', 'resume']).optional(),
});
export const scheduleResultInput = z.object({ scheduleId: id, requestId: id.optional().describe('Optional run request ID to read that run without starting another scan') });
export const runScheduleInput = z.object({ scheduleId: id, requestId: id.describe('New UUID for a run; reuse after a lost response. Use this same ID when polling the saved run.') });
export const exportDestinationsInput = z.object({
  provider: exportProvider,
  collection: identifier.optional().describe('Omit to discover allowed collections and required parameters; use the returned collection name to list choices'),
  parentId: identifier.optional(), cloudId: identifier.optional(), accountId: identifier.optional(), issueTypeId: identifier.optional(),
});
export const exportIssuesInput = z.object({
  provider: exportProvider, issueIds: z.array(id).min(1).max(50),
  destination: z.record(z.string().max(100), z.union([z.string().max(2000), z.array(z.string().max(200)).max(100)])).describe('Explicit destination fields from the destination discovery results; no first/default destination is selected'),
  metadata: z.record(z.string().max(100), z.unknown()).optional().describe('Optional destination fields from the provider schema, such as status or assignee'),
});
const query = (args: Record<string, unknown>) => new URLSearchParams(Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
export const workflowActionDefinitions = [
  { name: 'create_review_issues', kind: 'create', schema: fileReviewInput,
    description: 'File selected findings from your completed MCP Auto Review or visual comparison in its original project. Preserves saved images, page, captured context and fix guidance without scanning again. Repeating the same job and indexes recovers existing issues; inspect every finding outcome for partial completion. Old jobs without retained page provenance cannot be filed.',
    request: (args: Record<string, unknown>) => ({ path: '/review-issues', method: 'POST', body: args }) },
  { name: 'list_scheduled_reviews', kind: 'read', schema: z.object({}),
    description: 'List readable scheduled reviews in this workspace, including cadence, pause state, next run and latest saved result summary. Does not scan or send email.',
    request: () => ({ path: '/schedules' }) },
  { name: 'create_scheduled_review', kind: 'scan-write', schema: createScheduleInput,
    description: 'Create a recurring public-page review with the same plan limits and cadence as the dashboard. Enables future scans and review emails. A lost response can be recovered by listing schedules; the same project, page and scan type cannot have duplicate schedules.',
    request: (args: Record<string, unknown>) => ({ path: '/schedules', method: 'POST', body: args }) },
  { name: 'update_scheduled_review', kind: 'scan-write', schema: updateScheduleInput,
    description: 'Pause, resume, or change a scheduled review cadence. Supply exactly one of action or cadence. Resuming enables future scans and review emails; plan and project permissions still apply. Pausing keeps previous results.',
    request: ({ scheduleId, ...body }: Record<string, unknown>) => ({ path: `/schedules/${scheduleId}`, method: 'PATCH', body }) },
  { name: 'delete_scheduled_review', kind: 'delete', schema: z.object({ scheduleId: id }),
    description: 'Delete a scheduled review and stop its future scans and emails. Does not delete filed project issues.',
    request: ({ scheduleId }: Record<string, unknown>) => ({ path: `/schedules/${scheduleId}`, method: 'DELETE' }) },
  { name: 'run_scheduled_review', kind: 'verify', schema: runScheduleInput,
    description: 'Run an active scheduled review now using its existing settings and the dashboard run-now path. Uses scan resources; Run now does not send email. Request IDs and run results are retained for 24 hours. Reuse requestId after a lost response; poll the saved run with the same scheduleId and requestId. Does not resume paused schedules.',
    request: ({ scheduleId, ...body }: Record<string, unknown>) => ({ path: `/schedules/${scheduleId}/run`, method: 'POST', body }) },
  { name: 'get_scheduled_review_result', kind: 'read', schema: scheduleResultInput,
    description: 'Read the latest retained scheduled-review findings and evidence without rescanning, or poll a specific run by requestId. An empty result before the first successful run is not a clean scan. No longer detected, ignored and already filed are not proof that an issue was fixed.',
    request: ({ scheduleId, ...args }: Record<string, unknown>) => ({ path: `/schedules/${scheduleId}/result?${query(args)}` }) },
  { name: 'list_export_connections', kind: 'read', schema: z.object({}),
    description: 'List your connected issue trackers and reconnect requirements without exposing credentials. A connection does not prove export delivery or working two-way sync. Connect or reconnect in OverlayQA first.',
    request: () => ({ path: '/exports/connections' }) },
  { name: 'list_export_destinations', kind: 'read', schema: exportDestinationsInput,
    description: 'Discover and read destination choices for a connected tracker. Omit collection to learn its available collections and required parameters. Read choices before exporting; use schema collections for required destination fields. Does not create tasks or connect accounts.',
    request: (args: Record<string, unknown>) => ({ path: `/exports/destinations?${query(args)}` }) },
  { name: 'export_issues', kind: 'send', schema: exportIssuesInput,
    description: 'Export existing issues with their captured evidence and discussion to an explicitly chosen connected tracker destination. Uses the same product export and retry handlers. Inspect every result: pending or partial attachment delivery is not success. Read the saved export status after uncertain outcomes before retrying.',
    request: (args: Record<string, unknown>) => ({ path: '/exports', method: 'POST', body: args }) },
  { name: 'get_issue_export_status', kind: 'read', schema: z.object({ issueId: identifier.describe('Issue UUID or display ID') }),
    description: 'Read persisted export destinations, attachment delivery and the latest recorded sync success/error for an issue. Does not contact trackers or force a sync. Missing or stale sync evidence is not proof of a current round trip; unsupported fields are reported.',
    request: ({ issueId }: Record<string, unknown>) => ({ path: `/exports/issues/${encodeURIComponent(String(issueId))}` }) },
] as const;
