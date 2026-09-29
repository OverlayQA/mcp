import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateIssueInput, ListIssuesInput, UpdateIssueInput } from '../src/types.js';
import { buildUpdateIssueRequest } from '../src/tools/update-issue.js';

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
