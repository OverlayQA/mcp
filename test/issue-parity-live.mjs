// Actual built MCP client -> stdio -> real API -> saved records. No route mocks.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir, hostname } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const apiBase = process.env.OQ_HARNESS_API_URL || process.env.MCP_PARITY_API;
if (!apiBase || !['localhost', '127.0.0.1', 'api.overlayqa.com'].includes(new URL(apiBase).hostname)) throw new Error('Set an explicit MCP_PARITY_API target');
const production = new URL(apiBase).hostname === 'api.overlayqa.com';
const email = production ? 'testsprite@overlayqa.com' : 'harness-journey+clerk_test@overlayqa.com';
const env = production ? '' : readFileSync(process.env.MCP_SERVER_ENV, 'utf8');
const password = production ? readFileSync(join(homedir(), '.overlayqa/testsprite-password'), 'utf8').trim() : env.match(/^HARNESS_TEST_PASSWORD=(.*)$/m)?.[1].trim();
if (!password) throw new Error('Designated fixture password missing');
const out = resolve(process.env.MCP_REPORT_DIR || `verification/reports/issue-parity-${production ? 'production' : 'local'}`);
mkdirSync(out, { recursive: true });
const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(clientRoot, 'dist/index.js');
const result = { apiBase, machine: hostname(), account: email, role: 'unverified', clientCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: clientRoot }).trim(), clientEntrySha256: createHash('sha256').update(readFileSync(entry)).digest('hex'), startedAt: new Date().toISOString(), substitutions: ['Designated extension-session credential supplied to MCP; OAuth exchange and editor UI not exercised.'], steps: [], throttles: [], cleanup: [] };
const temp = mkdtempSync(join(tmpdir(), 'oq-mcp-parity-'));
const authFile = join(temp, 'auth.json');
let auth, client, labelId;
const projects = [];
async function api(path, method = 'GET', body) {
  const res = await fetch(`${apiBase}/api${path}`, { method, headers: { Authorization: `Bearer ${auth.sessionToken}`, 'Content-Type': 'application/json', 'x-overlayqa-internal': 'harness' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  assert.equal(res.ok, true, `${method} ${path}: HTTP ${res.status} ${JSON.stringify(data)}`);
  return data.data ?? data;
}
async function connect() {
  client = new Client({ name: 'OverlayQA issue parity verification', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { ...process.env, OVERLAYQA_API_BASE: `${apiBase}/api/mcp`, OVERLAYQA_AUTH_FILE: authFile }, stderr: 'pipe' });
  await client.connect(transport);
}
async function call(name, args, expectError = false) {
  let response;
  for (let attempt = 0; ; attempt++) {
    response = await client.callTool({ name, arguments: args });
    const text = response.content?.[0]?.text;
    const refusal = text ? JSON.parse(text)?.error : undefined;
    if (!response.isError || refusal?.code !== 'RATE_LIMITED' || !Number.isFinite(refusal.retryAfter) || attempt >= 2) break;
    result.throttles.push({ tool: name, retryAfter: refusal.retryAfter, observedAt: new Date().toISOString() });
    console.log(`WAIT ${name}: respecting server retryAfter=${refusal.retryAfter}s`);
    await new Promise(resolve => setTimeout(resolve, (refusal.retryAfter + 1) * 1000));
  }
  if (expectError) { assert.equal(response.isError, true, `${name} must refuse`); return response; }
  assert.notEqual(response.isError, true, `${name}: ${JSON.stringify(response.content)}`);
  return JSON.parse(response.content[0].text);
}
async function check(name, fn) {
  const step = { name, observedAt: new Date().toISOString() };
  try { step.evidence = await fn(); step.status = 'PASS'; }
  catch (error) { step.status = 'FAIL'; step.error = error.message; }
  result.steps.push(step);
  console.log(`${step.status} ${name}${step.error ? `: ${step.error}` : ''}`);
}
const dataOf = value => value.data ?? value;
try {
  const login = await fetch(`${apiBase}/api/auth/extension/email-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200, 'Designated account login');
  auth = (await login.json()).data;
  writeFileSync(authFile, JSON.stringify({ token: auth.sessionToken, teamId: auth.activeTeamId }), { mode: 0o600 });
  const members = await api(`/teams/${auth.activeTeamId}/members`);
  const self = members.find(row => row.user?.email === email);
  assert(self, 'Logged-in fixture is a workspace member');
  result.role = self.role;
  await connect();
  await check('Actual MCP discovery exposes issue and label tools', async () => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of ['get_issue', 'list_project_members', 'move_issue', 'list_comments', 'create_comment', 'update_comment', 'delete_comment', 'get_comment_attachment', 'list_labels', 'create_label', 'set_issue_label', 'rename_label', 'delete_label']) assert(names.includes(name), name);
    return { names };
  });
  const prefix = `harness-run-mcp-parity-${Date.now()}`;
  for (const suffix of ['source', 'destination']) {
    const project = await api('/projects', 'POST', { teamId: auth.activeTeamId, name: `${prefix}-${suffix}`, slug: `${prefix}-${suffix}` });
    projects.push(project.id);
  }
  const projectId = projects[0];
  const created = [];
  for (const [index, assigneeId] of [null, self.userId, null].entries()) {
    created.push(dataOf(await call('create_issue', { projectId, title: `${prefix} ${index}`, description: `Original details ${index}`, assigneeId })));
  }
  const issue = created[0];
  await check('Creation keeps explicit Unassigned and teammate selection', async () => {
    assert.equal((await api(`/issues/${issue.id}`)).assigneeId, null);
    assert.equal((await api(`/issues/${created[1].id}`)).assigneeId, self.userId);
    return { issueIds: created.map(row => row.id), assignedUserId: self.userId };
  });
  await check('Assignment, detail edits and ignore preserve status through restart', async () => {
    const body = { issueId: issue.id, title: `${prefix} edited`, description: 'Retained details', severity: 'high', type: 'improvement', assigneeId: self.userId, ignored: true };
    await call('update_issue', body);
    await client.close(); await connect();
    let saved = await api(`/issues/${issue.id}`);
    assert.equal(saved.title, body.title); assert.equal(saved.description, body.description);
    assert.equal(saved.severity, 'high'); assert.equal(saved.type, 'improvement');
    assert.equal(saved.assigneeId, self.userId); assert(saved.ignoredAt); assert.equal(saved.status, 'open');
    await call('update_issue', { issueId: issue.id, assigneeId: null, ignored: false });
    saved = await api(`/issues/${issue.id}`);
    assert.equal(saved.assigneeId, null); assert.equal(saved.ignoredAt, null); assert.equal(saved.status, 'open');
    await call('update_issue', { issueId: issue.id, assigneeId: randomUUID() }, true);
    await call('update_issue', { issueId: issue.id }, true);
    return { issueId: saved.id, status: saved.status, assigneeId: saved.assigneeId, ignoredAt: saved.ignoredAt };
  });
  await check('Full issue detail and teammate discovery use readable project context', async () => {
    const saved = dataOf(await call('get_issue', { issueId: issue.displayId }));
    assert.equal(saved.id, issue.id); assert.equal(saved.description, 'Retained details');
    for (const key of ['screenshotUrl', 'elementData', 'assigneeId', 'ignoredAt', 'labels']) assert(key in saved, key);
    const discovered = await call('list_project_members', { projectId });
    assert.equal(discovered.currentUserId, self.userId);
    assert(discovered.members.some(row => row.userId === self.userId));
    await call('get_issue', { issueId: randomUUID() }, true);
    await call('list_project_members', { projectId: randomUUID() }, true);
    return { issueId: saved.id, detailFields: Object.keys(saved), currentUserId: discovered.currentUserId };
  });
  await check('Pagination and triage filters return matching totals without losing ignored meaning', async () => {
    const first = await call('list_issues', { projectId, page: 1, pageSize: 1 });
    const second = await call('list_issues', { projectId, page: 2, pageSize: 1 });
    assert.equal(first.total, created.length); assert.equal(first.hasMore, true);
    assert.equal(first.issues.length, 1); assert.equal(second.issues.length, 1);
    assert.notEqual(first.issues[0].id, second.issues[0].id);
    const last = await call('list_issues', { projectId, page: created.length, pageSize: 1 });
    assert.equal(last.hasMore, false);
    const unassigned = await call('list_issues', { projectId, assigneeId: 'unassigned', createdById: 'me', state: 'active', status: ['open', 'in-progress'] });
    assert.equal(unassigned.total, 2);
    assert.equal((await call('list_issues', { projectId, assigneeId: 'me' })).total, 1);
    assert.equal((await call('list_issues', { projectId, type: ['improvement'], severity: ['high', 'critical'] })).total, 1);
    await call('update_issue', { issueId: issue.id, ignored: true });
    try {
      const ignored = await call('list_issues', { projectId, state: 'ignored' });
      assert.equal(ignored.total, 1); assert.equal(ignored.issues[0].status, 'open'); assert(ignored.issues[0].ignoredAt);
      assert.equal((await call('list_issues', { projectId, state: 'active' })).total, 2);
      assert.equal((await call('list_issues', { projectId, state: 'finished' })).total, 0);
    } finally { await call('update_issue', { issueId: issue.id, ignored: false }); }
    await call('update_issue', { issueId: issue.id, status: 'resolved' });
    assert.equal((await call('list_issues', { projectId, state: 'finished' })).total, 1);
    await call('update_issue', { issueId: issue.id, status: 'open' });
    return { total: first.total, pages: [first.page, second.page, last.page], lastHasMore: last.hasMore };
  });
  await check('Labels create/apply/retry/filter/rename/remove/delete retain issue content', async () => {
    const name = `${prefix}`.slice(-45);
    const label = dataOf(await call('create_label', { projectId, name })); labelId = label.id;
    assert.equal(dataOf(await call('create_label', { projectId, name })).id, label.id);
    for (let n = 0; n < 2; n++) await call('set_issue_label', { issueId: issue.id, labelId, applied: true });
    assert.deepEqual(dataOf(await call('list_labels', { projectId, issueId: issue.id })).assignedIds, [labelId]);
    const listed = await call('list_issues', { projectId, labelIds: [labelId] });
    assert.equal(listed.total, 1); assert.equal(listed.issues[0].labels[0].id, labelId);
    await call('rename_label', { projectId, labelId, name: `${name} edit` });
    assert.equal((await api(`/issues/${issue.id}`)).labels[0].name, `${name} edit`);
    await call('set_issue_label', { issueId: issue.id, labelId, applied: false });
    assert.equal((await call('list_issues', { projectId, labelIds: ['unlabeled'] })).total, created.length);
    await call('delete_label', { projectId, labelId }); labelId = null;
    assert.equal((await api(`/issues/${issue.id}`)).description, 'Retained details');
    return { issueId: issue.id, labelRemoved: true };
  });
  await check('Comments keep audience, mentions and files across retries, edit, move and reopen', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=';
    const body = { issueId: issue.id, requestId: randomUUID(), content: `Review @[${self.userId}]`, visibility: 'internal', mentionedUserIds: [self.userId], attachments: [{ filename: 'evidence.png', contentType: 'image/png', base64: png }] };
    const first = dataOf(await call('create_comment', body));
    const retry = dataOf(await call('create_comment', body)); assert.equal(retry.id, first.id);
    assert.equal(first.visibility, 'internal'); assert.equal(first.attachments.length, 1);
    const publicComment = dataOf(await call('create_comment', { issueId: issue.id, requestId: randomUUID(), content: 'Client-visible reply', visibility: 'public' }));
    assert.equal(publicComment.visibility, 'public');
    const file = dataOf(await call('get_comment_attachment', { issueId: issue.id, commentId: first.id, attachmentId: first.attachments[0].id }));
    assert.equal(file.base64, png);
    await call('get_comment_attachment', { issueId: created[1].id, commentId: first.id, attachmentId: first.attachments[0].id }, true);
    await call('update_comment', { issueId: issue.id, commentId: first.id, content: 'Edited retained reply', mentionedUserIds: [] });
    const moved = dataOf(await call('move_issue', { issueId: issue.id, targetProjectId: projects[1] }));
    assert.equal(moved.id, issue.id); assert.notEqual(moved.displayId, issue.displayId);
    await client.close(); await connect();
    const discussion = dataOf(await call('list_comments', { issueId: moved.displayId }));
    const retained = discussion.find(row => row.id === first.id);
    assert(retained); assert.equal(retained.content, 'Edited retained reply'); assert.equal(retained.visibility, 'internal'); assert.equal(retained.attachments[0].id, first.attachments[0].id);
    assert.equal(discussion.filter(row => row.id === first.id).length, 1);
    await call('delete_comment', { issueId: issue.id, commentId: first.id });
    assert(!dataOf(await call('list_comments', { issueId: issue.id })).some(row => row.id === first.id));
    assert.equal((await api(`/issues/${issue.id}`)).projectId, projects[1]);
    return { issueId: issue.id, displayId: moved.displayId, retainedPublicCommentId: publicComment.id, deletedCommentId: first.id };
  });
} catch (error) {
  result.steps.push({ name: 'Setup or fixture creation', observedAt: new Date().toISOString(), status: 'FAIL', error: error.message });
} finally {
  if (auth) {
    if (labelId) {
      try { await api(`/labels/${labelId}?projectId=${projects[0]}`, 'DELETE'); result.cleanup.push({ labelId, deleted: true }); }
      catch (error) { result.cleanup.push({ labelId, deleted: false, error: error.message }); }
    }
    for (const projectId of projects) {
      try { await api(`/projects/${projectId}`, 'DELETE'); result.cleanup.push({ projectId, deleted: true }); }
      catch (error) { result.cleanup.push({ projectId, deleted: false, error: error.message }); }
    }
  }
  if (client) await client.close();
  rmSync(temp, { recursive: true, force: true });
  result.finishedAt = new Date().toISOString();
  result.passed = result.steps.filter(s => s.status === 'PASS').length;
  result.failed = result.steps.filter(s => s.status === 'FAIL').length;
  result.status = result.failed || result.cleanup.some(s => !s.deleted) ? 'FAIL' : 'PASS';
  writeFileSync(join(out, 'results.json'), JSON.stringify(result, null, 2));
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>MCP issue parity</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto}pre{white-space:pre-wrap}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd}</style><h1>MCP issue parity: ${result.status}</h1><p>${escape(apiBase)} · ${escape(result.machine)} · ${escape(email)} (${escape(result.role)})</p><p>Actual built MCP client over stdio, real API and saved data. No browser surface is rendered by these tools.</p><table><tr><th>Journey</th><th>Verdict</th><th>Evidence</th></tr>${result.steps.map(s => `<tr><td>${escape(s.name)}<br>${escape(s.observedAt)}</td><td>${s.status}</td><td><pre>${escape(s.error ?? JSON.stringify(s.evidence, null, 2))}</pre></td></tr>`).join('')}</table><h2>Boundaries and provenance</h2><pre>${escape(JSON.stringify({ clientCommit: result.clientCommit, substitutions: result.substitutions, cleanup: result.cleanup }, null, 2))}</pre>`);
  console.log(`${result.status}: ${result.passed} passed, ${result.failed} failed. Report: ${out}`);
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}
