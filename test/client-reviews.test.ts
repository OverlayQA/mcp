import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createClientReviewInput, updateClientReviewTool, setClientReviewRecipientsInput,
  clientReviewResult, listClientReviewsTool, createClientReviewTool, setClientReviewRecipientsTool,
} from '../src/tools/client-reviews.js';
import { wrapTool, type RawTool } from '../src/telemetry.js';

const reviewId = '00000000-0000-4000-8000-000000000001';
test('review creation requires a web URL and retains explicit false settings', () => {
  const body = { projectId: reviewId, pageUrl: 'https://example.test/', mode: 'live', allowResponsiveViews: false };
  assert.equal(createClientReviewInput.parse(body).allowResponsiveViews, false);
  for (const pageUrl of ['javascript:alert(1)', 'file:///tmp/private', 'data:text/html,hello']) {
    assert.equal(createClientReviewInput.safeParse({ ...body, pageUrl }).success, false);
  }
});
test('recipient replacement can remove everyone and needs a review UUID', () => {
  assert.deepEqual(setClientReviewRecipientsInput.parse({ reviewId, emails: [] }), { reviewId, emails: [] });
  assert.equal(setClientReviewRecipientsInput.safeParse({ reviewId: 'public-link-token', emails: [] }).success, false);
});
test('an empty update is refused before a request and no tool writes reviewer completion', async () => {
  assert.equal((await updateClientReviewTool.handler({ reviewId })).isError, true);
  assert.deepEqual(updateClientReviewTool.inputSchema.parse({ reviewId, revoke: false, done: true }), { reviewId, revoke: false });
});
test('old servers and permission failures remain errors, never empty successful lists', () => {
  assert.equal(clientReviewResult({ status: 404, data: null }).isError, true);
  const error = { error: { code: 'FORBIDDEN', message: 'No access' } };
  assert.equal(JSON.parse(clientReviewResult({ status: 403, data: error }).content[0].text).error.code, 'FORBIDDEN');
});
test('read, share and invitation annotations survive the telemetry wrapper', () => {
  for (const tool of [listClientReviewsTool, createClientReviewTool, updateClientReviewTool, setClientReviewRecipientsTool]) {
    assert.deepEqual(wrapTool(tool as unknown as RawTool).annotations, tool.annotations);
  }
  assert.equal(listClientReviewsTool.annotations.readOnlyHint, true);
  assert.equal(createClientReviewTool.annotations.openWorldHint, true);
  assert.equal(setClientReviewRecipientsTool.annotations.destructiveHint, true);
});
