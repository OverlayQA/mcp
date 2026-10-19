import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const id = '00000000-0000-4000-8000-000000000001';
const pageUrl = 'https://api.overlayqa.com/sandbox/';
// Exercise the shipped entry point, not direct handler calls: the 0.4.0
// regression lived in registration and bypassed the existing handler tests.
const calls = {
  scan_accessibility: { url: pageUrl },
  scan_contrast: { url: pageUrl },
  scan_and_create_issues: { url: pageUrl, projectId: id },
  run_auto_review: { url: pageUrl, projectId: id, requestId: id },
  get_review_result: { jobId: id },
  compare_visual: { url: pageUrl, projectId: id, requestId: id, figmaFileKey: 'registration-test', figmaNodeId: '1:2' },
  audit_tokens: { url: pageUrl },
  create_issue: { projectId: id, title: 'Registration test' },
  list_issues: { projectId: id },
  update_issue: { issueId: id, status: 'resolved' },
  get_issue: { issueId: id },
  list_project_members: { projectId: id },
  move_issue: { issueId: id, targetProjectId: id },
  verify_issue: { issueId: id, requestId: id },
  get_issue_verifications: { issueId: id },
  list_comments: { issueId: id },
  create_comment: { issueId: id, content: 'Registration test', visibility: 'internal', requestId: id },
  update_comment: { issueId: id, commentId: id, content: 'Edited comment', mentionedUserIds: [] },
  delete_comment: { issueId: id, commentId: id },
  get_comment_attachment: { issueId: id, commentId: id, attachmentId: id },
  list_labels: { projectId: id },
  create_label: { projectId: id, name: 'Registration test' },
  rename_label: { projectId: id, labelId: id, name: 'Renamed label' },
  delete_label: { projectId: id, labelId: id },
  set_issue_label: { issueId: id, labelId: id, applied: true },
  list_projects: {},
  create_project: { name: 'Registration test' },
  list_client_reviews: { projectId: id },
  create_client_review: { projectId: id, pageUrl, mode: 'live' },
  update_client_review: { reviewId: id, revoke: true },
  set_client_review_recipients: { reviewId: id, emails: [] },
};

test('every advertised tool dispatches through the actual stdio entry point', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'overlayqa-registration-'));
  const authFile = join(dir, 'auth.json');
  // A startup credential prevents interactive OAuth. Remove it after the
  // handshake so real handlers stop at AUTH_REQUIRED without HTTP or writes.
  writeFileSync(authFile, JSON.stringify({ token: 'registration-test', teamId: id }), { mode: 0o600 });
  const client = new Client({ name: 'OverlayQA registration regression', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [process.env.MCP_TEST_ENTRY ?? fileURLToPath(new URL('../dist/index.js', import.meta.url))],
    env: { ...process.env, OVERLAYQA_AUTH_FILE: authFile, OVERLAYQA_API_BASE: 'http://127.0.0.1:1/api/mcp' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), Object.keys(calls).sort(), 'Every advertised tool needs a dispatch case');
    const review = tools.find(tool => tool.name === 'list_client_reviews');
    assert.deepEqual(review.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.equal(tools.find(tool => tool.name === 'list_projects').annotations, undefined);
    for (const tool of tools) assert(tool.inputSchema.properties.context, `${tool.name} retains telemetry context`);
    writeFileSync(authFile, '{}');

    for (const [name, args] of Object.entries(calls)) {
      await t.test(name, async () => {
        const response = await client.callTool({ name, arguments: args });
        assert.equal(response.isError, true);
        const text = response.content[0].text;
        assert.doesNotMatch(text, /typedHandler/);
        assert.equal(JSON.parse(text).code, 'AUTH_REQUIRED', text);
      });
    }

    await t.test('invalid input is refused before the handler and the next call still works', async () => {
      const invalid = await client.callTool({ name: 'list_issues', arguments: { projectId: 'not-a-uuid' } });
      assert.equal(invalid.isError, true);
      assert.match(invalid.content[0].text, /[Ii]nvalid.*(input|UUID|uuid)/);
      const next = await client.callTool({ name: 'list_projects', arguments: {} });
      assert.equal(JSON.parse(next.content[0].text).code, 'AUTH_REQUIRED');
    });
  } finally {
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
