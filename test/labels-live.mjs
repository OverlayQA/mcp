// Real stdio tools -> real HTTP routes -> run-owned records. No provider mocks.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const apiBase = process.env.OQ_HARNESS_API_URL || process.env.LABELS_API;
if (!apiBase || !['localhost', '127.0.0.1', 'api.overlayqa.com'].includes(new URL(apiBase).hostname)) throw new Error('Set LABELS_API to an explicit local or production target');
const production = new URL(apiBase).hostname === 'api.overlayqa.com';
const email = production ? 'testsprite@overlayqa.com' : 'harness-journey+clerk_test@overlayqa.com';
const env = production ? '' : readFileSync(process.env.LABELS_SERVER_ENV, 'utf8');
const password = production ? readFileSync(join(homedir(), '.overlayqa/testsprite-password'), 'utf8').trim() : env.match(/^HARNESS_TEST_PASSWORD=(.*)$/m)?.[1].trim();
if (!password) throw new Error('Designated fixture password missing');
const login = await fetch(`${apiBase}/api/auth/extension/email-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
assert.equal(login.status, 200, 'Designated account authentication');
const auth = (await login.json()).data;
const temporary = mkdtempSync(join(tmpdir(), 'labels-mcp-'));
const authFile = join(temporary, 'auth.json');
writeFileSync(authFile, JSON.stringify({ token: auth.sessionToken, teamId: auth.activeTeamId }), { mode: 0o600 });
const client = new Client({ name: 'OverlayQA labels verification', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/index.js')], env: { ...process.env, OVERLAYQA_API_BASE: `${apiBase}/api/mcp`, OVERLAYQA_AUTH_FILE: authFile }, stderr: 'pipe' });
let projectId, labelId;
const steps = [];
async function api(path, method = 'GET', body) {
  const response = await fetch(`${apiBase}/api${path}`, { method, headers: { Authorization: `Bearer ${auth.sessionToken}`, 'Content-Type': 'application/json', 'x-overlayqa-internal': 'harness' }, body: body ? JSON.stringify(body) : undefined });
  assert.equal(response.ok, true, `${method} ${path}: HTTP ${response.status}`);
  return (await response.json()).data;
}
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result.content)}`);
  const data = JSON.parse(result.content[0].text);
  steps.push({ tool: name, observedAt: new Date().toISOString() });
  return data;
}
try {
  await client.connect(transport);
  const names = (await client.listTools()).tools.map(tool => tool.name);
  for (const name of ['list_labels', 'create_label', 'rename_label', 'delete_label', 'set_issue_label']) assert(names.includes(name), name);
  const runName = `harness-run-labels-mcp-${Date.now()}`;
  projectId = (await api('/projects', 'POST', { teamId: auth.activeTeamId, name: runName, slug: runName })).id;
  const issue = await api('/issues', 'POST', { projectId, title: 'MCP label fixture', description: 'Preserve this text', severity: 'medium', type: 'general', screenshotUrl: '', pageUrl: 'https://api.overlayqa.com/sandbox/' });
  const label = (await call('create_label', { projectId, name: runName.slice(-45) })).data;
  labelId = label.id;
  const retry = (await call('create_label', { projectId, name: label.name })).data;
  assert.equal(retry.id, labelId);
  await call('set_issue_label', { issueId: issue.id, labelId, applied: true });
  await call('set_issue_label', { issueId: issue.id, labelId, applied: true });
  const catalog = (await call('list_labels', { projectId, issueId: issue.id })).data;
  assert.deepEqual(catalog.assignedIds, [labelId]);
  const listed = await call('list_issues', { projectId, labelIds: [labelId] });
  assert.equal(listed.total, 1); assert.deepEqual(listed.issues[0].labels, [label]);
  assert.equal((await call('list_issues', { projectId, labelIds: ['unlabeled'] })).total, 0);
  await call('rename_label', { projectId, labelId, name: `${label.name} edit`.slice(0, 50) });
  const saved = await api(`/issues/${issue.id}`);
  assert.equal(saved.labels[0].name, `${label.name} edit`.slice(0, 50));
  assert.equal(saved.description, 'Preserve this text');
  await call('set_issue_label', { issueId: issue.id, labelId, applied: false });
  assert.equal((await call('list_issues', { projectId, labelIds: ['unlabeled'] })).total, 1);
  await call('set_issue_label', { issueId: issue.id, labelId, applied: true });
  await call('delete_label', { projectId, labelId });
  assert.deepEqual((await api(`/issues/${issue.id}`)).labels, []);
  labelId = null;
  console.log(JSON.stringify({ status: 'pass', apiBase, machine: hostname(), email, projectId, steps }, null, 2));
  const out = process.env.LABELS_REPORT_DIR || 'test-results';
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `labels-${production ? 'production' : 'local'}.json`), JSON.stringify({ status: 'pass', apiBase, machine: hostname(), email, projectId, steps, substitutions: ['designated extension-session credential supplied to MCP; OAuth login flow not exercised'] }, null, 2));
} finally {
  try {
    if (labelId) await api(`/labels/${labelId}?projectId=${projectId}`, 'DELETE');
    if (projectId) await api(`/projects/${projectId}`, 'DELETE');
  } finally { await client.close(); rmSync(temporary, { recursive: true, force: true }); }
}
