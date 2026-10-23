import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startFixture, json, payload, id } from './helpers/stdio-fixture.mjs';

test('workflow tools preserve selected evidence identity, explicit destinations, and partial delivery over stdio', async t => {
  const fixture = await startFixture(t, (req, res) => {
    if (req.path === '/api/mcp/review-issues') return json(res, 200, { jobId: id, status: 'partial', findings: [{ findingIndex: 2, status: 'created', issueId: id }, { findingIndex: 7, status: 'failed' }] });
    if (req.path === '/api/mcp/exports') return json(res, 200, { status: 'partial', data: { results: [{ success: true, partial: true, assetsAttached: false, externalId: 'real-task' }] } });
    return json(res, 200, { status: 'running', requestId: id });
  });
  const { client, requests } = fixture;
  const filed = await client.callTool({ name: 'create_review_issues', arguments: { jobId: id, findingIndexes: [2, 7] } });
  assert.equal(filed.isError, true);
  assert.equal(payload(filed).findings[0].issueId, id);
  assert.deepEqual(requests.at(-1).body, { jobId: id, findingIndexes: [2, 7] });
  const exported = await client.callTool({ name: 'export_issues', arguments: { provider: 'trello', issueIds: [id], destination: { boardId: 'chosen-board', listId: 'chosen-list' }, metadata: { priority: 'high' } } });
  assert.equal(exported.isError, true);
  assert.equal(payload(exported).data.results[0].externalId, 'real-task');
  assert.deepEqual(requests.at(-1).body.destination, { boardId: 'chosen-board', listId: 'chosen-list' });
  const before = requests.length;
  const invalid = await client.callTool({ name: 'export_issues', arguments: { provider: 'trello', issueIds: [id] } });
  assert.equal(invalid.isError, true);
  assert.equal(requests.length, before, 'No destination never reaches HTTP');
});

test('scheduled runs and polls keep the same request ID without an implicit restart', async t => {
  const { client, requests } = await startFixture(t, (_req, res) => json(res, 200, { status: 'running', requestId: id }));
  const args = { scheduleId: id, requestId: id };
  await client.callTool({ name: 'run_scheduled_review', arguments: args });
  await client.callTool({ name: 'run_scheduled_review', arguments: args });
  await client.callTool({ name: 'get_scheduled_review_result', arguments: args });
  assert.deepEqual(requests.map(r => r.method), ['POST', 'POST', 'GET']);
  assert.deepEqual(requests.slice(0, 2).map(r => r.body), [{ requestId: id }, { requestId: id }]);
  assert.equal(requests[2].path, `/api/mcp/schedules/${id}/result?requestId=${id}`);
});
