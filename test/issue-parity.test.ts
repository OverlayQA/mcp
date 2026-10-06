import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateIssueInput, ListIssuesInput, UpdateIssueInput } from '../src/types.js';
import { buildUpdateIssueRequest } from '../src/tools/update-issue.js';
import { listIssuesTool, listIssuesResult } from '../src/tools/list-issues.js';
import { getIssueTool } from '../src/tools/issue-context.js';

const projectId = '00000000-0000-4000-8000-000000000001';
const teammate = '00000000-0000-4000-8000-000000000002';

test('issue edits do not need a status change and retain explicit unassignment and un-ignore', () => {
  const fields = { issueId: 'OQ-12', title: 'Updated title', description: 'Details', severity: 'high', type: 'general', assigneeId: null, ignored: false };
  const parsed = UpdateIssueInput.safeParse(fields);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.data, fields);
  const { issueId, ...body } = fields;
  assert.deepEqual(buildUpdateIssueRequest(parsed.data), { path: '/issues/OQ-12', method: 'PATCH', body });
});

test('creation retains an explicit assignee or Unassigned', () => {
  for (const assigneeId of [teammate, null]) {
    const parsed = CreateIssueInput.parse({ projectId, title: 'Capture', assigneeId });
    assert.equal((parsed as Record<string, unknown>).assigneeId, assigneeId);
  }
});

test('list schema retains filters and pagination instead of silently dropping them', () => {
  const input = { projectId, status: ['open', 'in-progress'], severity: ['high', 'critical'], type: ['general'], assigneeId: 'unassigned', createdById: teammate, state: 'active', page: 2, pageSize: 10 };
  assert.deepEqual(ListIssuesInput.parse(input), input);
  assert.equal(ListIssuesInput.safeParse({ projectId, page: 0 }).success, false);
  assert.equal(ListIssuesInput.safeParse({ projectId, pageSize: 101 }).success, false);
});

// 2026-10-06: an agent polling for client feedback opened every issue to learn
// whether it was new or still unanswered. The list now takes a creation cut-off
// and a page, and reports reply state per issue.
const page = 'https://example.test/what-we-offer/';
const body = (result: { content: { text: string }[] }) => JSON.parse(result.content[0].text);

test('list schema keeps the created-after and page filters and refuses a time with no zone', () => {
  const input = { projectId, createdAfter: '2026-10-05T22:00:00.000Z', pageUrl: page };
  assert.deepEqual(ListIssuesInput.parse(input), input);
  assert.equal(ListIssuesInput.safeParse({ projectId, createdAfter: '2026-10-05T18:00:00-04:00' }).success, true);
  for (const createdAfter of ['yesterday', '2026-10-05', '2026-10-05T22:00:00']) {
    assert.equal(ListIssuesInput.safeParse({ projectId, createdAfter }).success, false, `accepted ${createdAfter}`);
  }
  assert.equal(ListIssuesInput.safeParse({ projectId, pageUrl: 'what-we-offer' }).success, false);
});

test('a server that applied the filters is passed through unchanged', () => {
  const data = { issues: [{ id: 'i1' }], total: 1, filters: { createdAfter: '2026-10-05T22:00:00.000Z', pageUrl: page } };
  const result = listIssuesResult({ projectId, createdAfter: '2026-10-05T22:00:00.000Z', pageUrl: page }, { status: 200, data });
  assert.equal('isError' in result, false);
  assert.deepEqual(body(result), data);
});

test('a server that ignored a filter is refused, never returned as if every issue were new', () => {
  // What a server older than these filters answers: it strips the unknown
  // query keys, returns the whole project, and echoes nothing.
  const olderServer = { status: 200, data: { issues: [{ id: 'old-1' }, { id: 'old-2' }], total: 2 } };
  const result = listIssuesResult({ projectId, createdAfter: '2026-10-05T22:00:00.000Z' }, olderServer);
  assert.equal(result.isError, true);
  assert.equal(body(result).code, 'FILTER_NOT_SUPPORTED');
  assert.match(body(result).message, /createdAfter/);
  assert.equal(JSON.stringify(body(result)).includes('old-1'), false);

  const onlyPageIgnored = { status: 200, data: { issues: [], total: 0, filters: { createdAfter: '2026-10-05T22:00:00.000Z', pageUrl: null } } };
  const pageResult = listIssuesResult({ projectId, createdAfter: '2026-10-05T22:00:00.000Z', pageUrl: page }, onlyPageIgnored);
  assert.match(body(pageResult).message, /pageUrl/);
  assert.doesNotMatch(body(pageResult).message, /createdAfter/);
});

test('CONTROL: without the new filters an older server still answers normally', () => {
  const data = { issues: [{ id: 'old-1' }], total: 1 };
  const result = listIssuesResult({ projectId, state: 'active' }, { status: 200, data });
  assert.equal('isError' in result, false);
  assert.deepEqual(body(result), data);
});

test('a refusal from the server is reported as itself, not as a missing filter', () => {
  const refusal = { status: 404, data: { error: true, code: 'NOT_FOUND', message: 'Project not found or no access' } };
  const result = listIssuesResult({ projectId, createdAfter: '2026-10-05T22:00:00.000Z' }, refusal);
  assert.equal(result.isError, true);
  assert.equal(body(result).code, 'NOT_FOUND');
});

test('descriptions tell an agent how to find unanswered issues and where the comments are', () => {
  assert.match(listIssuesTool.description, /createdAfter/);
  assert.match(listIssuesTool.description, /lastCommentBy/);
  assert.match(getIssueTool.description, /comments/i);
  assert.doesNotMatch(getIssueTool.description, /Use list_comments for the discussion/);
});
