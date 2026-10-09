import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyIssueTool, getIssueVerificationsTool } from '../src/tools/verification.js';
import { ListIssuesInput } from '../src/types.js';
import { listIssuesResult } from '../src/tools/list-issues.js';

const projectId = '00000000-0000-4000-8000-000000000001';
const requestId = '00000000-0000-4000-8000-000000000002';
test('a verification needs a stable request identity and never accepts caller-provided evidence', () => {
  assert.equal(verifyIssueTool.inputSchema.safeParse({ issueId: 'OQ-12' }).success, false);
  assert.equal(verifyIssueTool.inputSchema.safeParse({ issueId: 'OQ-12', requestId: 'retry' }).success, false);
  assert.deepEqual(verifyIssueTool.inputSchema.parse({ issueId: 'OQ-12', requestId, status: 'passed', afterScreenshotUrl: 'https://example.test/fake.png' }), { issueId: 'OQ-12', requestId });
  assert.match(verifyIssueTool.description, /Does not change issue status/);
  assert.match(getIssueVerificationsTool.description, /does not run a new check/);
});
test('both true and false detection filters survive parsing and require a server acknowledgement', () => {
  for (const notDetected of [true, false]) {
    const input = { projectId, notDetected };
    assert.deepEqual(ListIssuesInput.parse(input), input);
    assert.equal(listIssuesResult(input, { status: 200, data: { issues: [] } }).isError, true);
    assert.equal(listIssuesResult(input, { status: 200, data: { issues: [], filters: { notDetected } } }).isError, undefined);
  }
  assert.equal(ListIssuesInput.safeParse({ projectId, notDetected: 'false' }).success, false);
});
