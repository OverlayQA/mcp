import { test } from 'node:test';
import assert from 'node:assert/strict';
import { id, json, payload, startFixture } from './helpers/stdio-fixture.mjs';

test('real stdio advertises and dispatches both review starts and retrieves their complete evidence', async t => {
  const findings = { diffs: [{ description: 'Button width differs', screenshotUrl: 'https://evidence.test/button.png', expected: '120px', actual: '140px' }], capturedWidth: 1440 };
  let state = 'running';
  const f = await startFixture(t, (req, res) => req.method === 'POST'
    ? json(res, 202, { jobId: id, status: 'running' })
    : json(res, 200, { jobId: id, status: state, ...(state === 'complete' ? { result: findings } : {}) }));
  const input = { projectId: id, requestId: id, url: 'https://example.com' };
  const auto = await f.client.callTool({ name: 'run_auto_review', arguments: input });
  assert.notEqual(auto.isError, true); assert.equal(payload(auto).jobId, id);
  assert.equal(f.requests.at(-1).path, '/api/mcp/scan/auto-review');
  assert.deepEqual(f.requests.at(-1).body.viewport, { width: 1280, height: 800 });
  const compare = await f.client.callTool({ name: 'compare_visual', arguments: { ...input, figmaFileKey: 'file', figmaNodeId: '1:2', measureSpacing: true } });
  assert.notEqual(compare.isError, true); assert.equal(f.requests.at(-1).body.measureSpacing, true);
  assert.equal(payload(await f.client.callTool({ name: 'get_review_result', arguments: { jobId: id } })).status, 'running');
  state = 'complete';
  assert.deepEqual(payload(await f.client.callTool({ name: 'get_review_result', arguments: { jobId: id } })).result, findings);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 2, 'Reading a result never restarts a review');
});

test('failed review results are errors and HTTP refusals retain the cause', async t => {
  const f = await startFixture(t, (req, res) => req.method === 'POST'
    ? json(res, 429, { error: { code: 'RATE_LIMITED', message: 'Scan allowance used' } })
    : json(res, 200, { jobId: id, status: 'failed', error: 'Page could not be captured' }));
  assert.equal((await f.client.callTool({ name: 'run_auto_review', arguments: { projectId: id, requestId: id, url: 'https://example.com' } })).isError, true);
  const failed = await f.client.callTool({ name: 'get_review_result', arguments: { jobId: id } });
  assert.equal(failed.isError, true); assert.equal(payload(failed).error, 'Page could not be captured');
});
