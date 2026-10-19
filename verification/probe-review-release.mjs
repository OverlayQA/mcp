// Read-only release preflight through the actual packaged stdio client.
// Reserved nil IDs cannot reference a saved project/job; no review is started.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entry = resolve(process.env.MCP_TEST_ENTRY || 'dist/index.js');
const reportPath = resolve(process.env.MCP_RELEASE_REPORT || 'verification/reports/2026-10-19-mcp-publication/production-preflight.json');
const origin = 'https://api.overlayqa.com';
const email = 'testsprite@overlayqa.com';
const nil = '00000000-0000-4000-8000-000000000000';
const report = {
  startedAt: new Date().toISOString(), machine: hostname(), origin, email,
  entry, entrySha256: createHash('sha256').update(readFileSync(entry)).digest('hex'),
  packageVersion: JSON.parse(readFileSync(join(dirname(entry), '../package.json'))).version,
  substitutions: ['Designated owner session supplied in an isolated credential file; browser sign-in and editor UI not exercised.'],
  scope: 'Read projects and invoke reviews with nonexistent project/job IDs. No scan, AI provider or Figma call is requested.',
  checks: [], notVerified: ['Successful deployed Auto Review and visual comparison jobs.', 'Fresh Figma rendering, published npm distribution and editor UI.'],
};
const temp = mkdtempSync(join(tmpdir(), 'oq-mcp-release-probe-'));
const client = new Client({ name: 'OverlayQA release preflight', version: '1' });
try {
  const login = await fetch(`${origin}/api/auth/extension/email-login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: readFileSync(join(homedir(), '.overlayqa/testsprite-password'), 'utf8').trim() }),
  });
  assert.equal(login.status, 200, 'Designated test account signs in');
  const auth = (await login.json()).data;
  const membersResponse = await fetch(`${origin}/api/teams/${auth.activeTeamId}/members`, {
    headers: { Authorization: `Bearer ${auth.sessionToken}`, 'x-overlayqa-internal': 'harness' },
  });
  assert.equal(membersResponse.status, 200);
  const membersBody = await membersResponse.json();
  const self = (membersBody.data ?? membersBody).find(row => row.user?.email === email);
  assert.equal(self?.role, 'owner'); report.role = self.role;
  const authFile = join(temp, 'auth.json');
  writeFileSync(authFile, JSON.stringify({ token: auth.sessionToken, teamId: auth.activeTeamId }), { mode: 0o600 });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [entry],
    env: { ...process.env, OVERLAYQA_AUTH_FILE: authFile, OVERLAYQA_API_BASE: `${origin}/api/mcp` }, stderr: 'pipe',
  }));
  const tools = await client.listTools(); report.advertisedTools = tools.tools.map(tool => tool.name);
  const input = { projectId: nil, requestId: nil, url: `${origin}/sandbox/` };
  for (const [name, args, expectedMessage] of [
    ['list_projects', {}, null],
    ['run_auto_review', input, 'Project not found'],
    ['compare_visual', { ...input, figmaFileKey: 'release-preflight', figmaNodeId: '1:2' }, 'Project not found'],
    ['get_review_result', { jobId: nil }, 'Review not found or expired'],
  ]) {
    const result = await client.callTool({ name, arguments: args });
    const body = JSON.parse(result.content[0].text);
    const pass = expectedMessage === null ? result.isError !== true : result.isError === true && body.error?.message === expectedMessage;
    report.checks.push({ tool: name, checkedAt: new Date().toISOString(), status: pass ? 'PASS' : 'FAIL',
      expected: expectedMessage ?? 'Successful authenticated read',
      observed: name === 'list_projects' ? { isError: result.isError ?? false } : body });
  }
  report.status = report.checks.every(check => check.status === 'PASS') ? 'READY_FOR_JOB_VERIFICATION' : 'BLOCKED';
  if (report.status === 'BLOCKED') process.exitCode = 1;
} catch (error) {
  report.status = 'ERROR'; report.error = error.message; process.exitCode = 1;
} finally {
  await client.close(); rmSync(temp, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: report.checks, reportPath }, null, 2));
}
