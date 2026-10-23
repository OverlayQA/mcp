import { workflowActionDefinitions } from './workflow-action-definitions.js';
import { request } from './request.js';

export const workflowActionTools = workflowActionDefinitions.map(def => ({
  name: def.name, description: def.description, inputSchema: def.schema,
  annotations: {
    readOnlyHint: def.kind === 'read',
    destructiveHint: ['delete', 'send'].includes(def.kind) || def.name === 'update_scheduled_review',
    idempotentHint: def.kind === 'read' || def.kind === 'delete' || def.kind === 'verify',
    openWorldHint: ['send', 'verify', 'scan-write'].includes(def.kind) || def.name === 'list_export_destinations',
  },
  handler: (args: Record<string, unknown>) => {
    const target = def.request(args) as { path: string; method?: string; body?: unknown };
    return request(target.path, target.method, target.body);
  },
}));
