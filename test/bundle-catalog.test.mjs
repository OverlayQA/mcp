import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readToolCatalog } from '../scripts/read-tool-catalog.mjs';

test('bundle discovery includes grouped workflow tools and their registered schemas', async () => {
  const tools = await readToolCatalog(fileURLToPath(new URL('..', import.meta.url)));
  assert.equal(tools.length, 42);
  assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
  for (const name of [
    'create_review_issues', 'list_scheduled_reviews', 'create_scheduled_review',
    'update_scheduled_review', 'delete_scheduled_review', 'run_scheduled_review',
    'get_scheduled_review_result', 'list_export_connections', 'list_export_destinations',
    'export_issues', 'get_issue_export_status',
  ]) {
    const tool = tools.find(item => item.name === name);
    assert(tool, `${name} must be advertised in the bundle`);
    assert(tool.description);
    assert(tool.inputSchema.properties.context, `${name} retains the runtime context argument`);
  }
  const run = tools.find(tool => tool.name === 'run_scheduled_review');
  assert.deepEqual(run.inputSchema.required, ['scheduleId', 'requestId']);
  assert.equal(run.annotations.idempotentHint, true);
});
