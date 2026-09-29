/**
 * Client-side telemetry contract (node:test, no network):
 *
 *  - every tool advertises an optional `context` argument that asks the agent
 *    for a one-sentence purpose, and the argument is stripped before the tool
 *    handler runs;
 *  - the purpose travels to api.overlayqa.com as the URI-encoded
 *    `x-overlayqa-mcp-intent` header, scoped to the tool call that supplied it
 *    (concurrent calls never see each other's), and the editor's name/version
 *    from the MCP initialize handshake travels as `x-overlayqa-mcp-client`;
 *  - `update_issue` PATCHes /issues/:id with the new status.
 *
 * Run: npm test (tsc -p tsconfig.test.json && node --test dist-test/test/).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTEXT_FIELD,
  CONTEXT_MAX_CHARS,
  withIntent,
  currentIntent,
  setClientInfoProvider,
  buildTelemetryHeaders,
  wrapTool,
} from '../src/telemetry.js';
import { updateIssueTool, buildUpdateIssueRequest } from '../src/tools/update-issue.js';
import { CreateIssueInput, UpdateIssueInput } from '../src/types.js';

test('CONTEXT_FIELD: optional, capped, and its description asks for a purpose and forbids secrets', () => {
  assert.equal(CONTEXT_FIELD.safeParse(undefined).success, true);
  assert.equal(CONTEXT_FIELD.safeParse('Check the checkout page for contrast issues').success, true);
  assert.equal(CONTEXT_FIELD.safeParse('x'.repeat(CONTEXT_MAX_CHARS + 1)).success, false);
  const description = CONTEXT_FIELD.description ?? '';
  assert.match(description, /purpose/i);
  assert.match(description, /never/i);
  assert.match(description, /credential|password|secret/i);
});

test('withIntent scopes the purpose to one call; concurrent calls do not bleed', async () => {
  assert.equal(currentIntent(), undefined);
  const seen: Array<string | undefined> = [];
  await Promise.all([
    withIntent('scan the checkout page', async () => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push(currentIntent());
    }),
    withIntent('list open issues', async () => {
      seen.push(currentIntent());
      await new Promise((r) => setTimeout(r, 10));
      seen.push(currentIntent());
    }),
  ]);
  assert.deepEqual(seen.sort(), ['list open issues', 'list open issues', 'scan the checkout page']);
  assert.equal(currentIntent(), undefined);
});

test('buildTelemetryHeaders: intent is URI-encoded, editor is name/version, nothing when unknown', async () => {
  setClientInfoProvider(() => undefined);
  assert.deepEqual(buildTelemetryHeaders(), {});

  setClientInfoProvider(() => ({ name: 'cursor', version: '1.2.3' }));
  assert.deepEqual(buildTelemetryHeaders(), { 'x-overlayqa-mcp-client': 'cursor/1.2.3' });

  await withIntent('Check the checkout page: contrast & spacing', async () => {
    assert.deepEqual(buildTelemetryHeaders(), {
      'x-overlayqa-mcp-client': 'cursor/1.2.3',
      'x-overlayqa-mcp-intent': encodeURIComponent('Check the checkout page: contrast & spacing'),
    });
  });
  setClientInfoProvider(() => undefined);
});

test('wrapTool: adds context to the schema, strips it from the handler args, and scopes the intent around the call', async () => {
  let received: unknown;
  let intentDuringCall: string | undefined;
  const tool = wrapTool({
    name: 'list_projects',
    description: 'd',
    inputSchema: { shape: { projectId: 'schema' } },
    handler: async (args: unknown) => {
      received = args;
      intentDuringCall = currentIntent();
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    },
  });
  assert.equal(tool.name, 'list_projects');
  assert.ok('context' in tool.inputSchema.shape, 'context field advertised');
  assert.equal(tool.inputSchema.shape.projectId, 'schema', 'existing fields kept');
  const out = await tool.handler({ projectId: 'p1', context: 'find open issues to fix' });
  assert.deepEqual(received, { projectId: 'p1' });
  assert.equal(intentDuringCall, 'find open issues to fix');
  assert.equal(out.content[0].text, 'ok');
  assert.equal(currentIntent(), undefined, 'intent does not leak past the call');
});

test('wrapTool: a call without context runs the handler with no intent', async () => {
  let intentDuringCall: string | undefined = 'sentinel';
  const tool = wrapTool({
    name: 'x',
    description: 'd',
    inputSchema: { shape: {} },
    handler: async () => {
      intentDuringCall = currentIntent();
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    },
  });
  await tool.handler({});
  assert.equal(intentDuringCall, undefined);
});

test('update_issue: accepts the existing status call and PATCHes /issues/:id', () => {
  assert.equal(updateIssueTool.name, 'update_issue');
  assert.match(updateIssueTool.description, /status/i);
  assert.equal(UpdateIssueInput.safeParse({ issueId: 'OQ-7', status: 'resolved' }).success, true);
  assert.equal(UpdateIssueInput.safeParse({ issueId: 'OQ-7', status: 'done' }).success, false);
  assert.equal(UpdateIssueInput.safeParse({ status: 'resolved' }).success, false);
  assert.deepEqual(buildUpdateIssueRequest({ issueId: 'OQ-7', status: 'resolved' }), {
    path: '/issues/OQ-7',
    method: 'PATCH',
    body: { status: 'resolved' },
  });
  assert.equal(buildUpdateIssueRequest({ issueId: 'a b/c', status: 'closed' }).path, '/issues/a%20b%2Fc');
});

test('create_issue accepts the current issue-type vocabulary (improvement, general)', () => {
  for (const type of ['design-bug', 'design-gap', 'improvement', 'general', 'design-debt', 'accessibility']) {
    assert.equal(CreateIssueInput.safeParse({ projectId: '00000000-0000-4000-8000-000000000001', title: 't', type }).success, true, type);
  }
});
