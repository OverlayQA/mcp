// list_issues "what is new / what is unanswered" and get_issue's comments:
// real stdio tools -> real HTTP routes -> run-owned records. No provider mocks.
//
//   LIST_CONTEXT_API=https://api.overlayqa.com node test/list-context-live.mjs
//   LIST_CONTEXT_API=http://127.0.0.1:3213 LIST_CONTEXT_SERVER_ENV=<server .env> node test/list-context-live.mjs
//
// LIST_CONTEXT_EXPECT says which server this client is talking to, and is never
// inferred: `new` (default) asserts the filters and reply state; `old` asserts
// what a server that PREDATES them must get from this client, which is a named
// refusal, never a list of every issue read as "new". A probe that picked its
// own expectation could not fail.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const apiBase = process.env.OQ_HARNESS_API_URL || process.env.LIST_CONTEXT_API;
if (!apiBase || !['localhost', '127.0.0.1', 'api.overlayqa.com'].includes(new URL(apiBase).hostname)) throw new Error('Set LIST_CONTEXT_API to an explicit local or production target');
const expect = process.env.LIST_CONTEXT_EXPECT ?? 'new';
if (!['new', 'old'].includes(expect)) throw new Error('LIST_CONTEXT_EXPECT must be new or old');
const production = new URL(apiBase).hostname === 'api.overlayqa.com';
const email = production ? 'testsprite@overlayqa.com' : 'harness-journey+clerk_test@overlayqa.com';
const env = production ? '' : readFileSync(process.env.LIST_CONTEXT_SERVER_ENV, 'utf8');
const password = production ? readFileSync(join(homedir(), '.overlayqa/testsprite-password'), 'utf8').trim() : env.match(/^HARNESS_TEST_PASSWORD=(.*)$/m)?.[1].trim();
if (!password) throw new Error('Designated fixture password missing');
const login = await fetch(`${apiBase}/api/auth/extension/email-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
assert.equal(login.status, 200, 'Designated account authentication');
const auth = (await login.json()).data;
const temporary = mkdtempSync(join(tmpdir(), 'list-context-mcp-'));
const authFile = join(temporary, 'auth.json');
writeFileSync(authFile, JSON.stringify({ token: auth.sessionToken, teamId: auth.activeTeamId }), { mode: 0o600 });
const client = new Client({ name: 'OverlayQA list-context verification', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/index.js')], env: { ...process.env, OVERLAYQA_API_BASE: `${apiBase}/api/mcp`, OVERLAYQA_AUTH_FILE: authFile } });
let projectId;
const steps = [];
const pass = (name, detail) => { steps.push({ name, detail, observedAt: new Date().toISOString() }); console.log(`PASS  ${name}  ${detail}`); };
async function api(path, method = 'GET', body) {
  const response = await fetch(`${apiBase}/api${path}`, { method, headers: { Authorization: `Bearer ${auth.sessionToken}`, 'Content-Type': 'application/json', 'x-overlayqa-internal': 'harness' }, body: body ? JSON.stringify(body) : undefined });
  assert.equal(response.ok, true, `${method} ${path}: HTTP ${response.status}`);
  return (await response.json()).data;
}
/** A tool call as the agent sees it: the parsed body and whether the client flagged it an error. */
async function tool(name, args) {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, data: JSON.parse(result.content[0].text) };
}
async function ok(name, args) {
  const result = await tool(name, args);
  assert.equal(result.isError, false, `${name}: ${JSON.stringify(result.data).slice(0, 300)}`);
  return result.data;
}
const issue = (title, pageUrl) => api('/issues', 'POST', { projectId, title, description: 'Run-owned; deleted with its project.', severity: 'medium', type: 'general', screenshotUrl: '', pageUrl });

try {
  await client.connect(transport);
  const runName = `harness-run-list-context-mcp-${Date.now()}`;
  projectId = (await api('/projects', 'POST', { teamId: auth.activeTeamId, name: runName, slug: runName })).id;
  const page = 'https://api.overlayqa.com/sandbox/';
  const first = await issue('List context: first', `${page}?run=${runName}`);
  const before = await ok('list_issues', { projectId });
  const cut = before.issues.find((row) => row.id === first.id)?.createdAt;
  assert.ok(cut, 'the first issue is listed with a createdAt');
  const newer = await issue('List context: newer', 'https://api.overlayqa.com/sandbox/layers');

  const since = await tool('list_issues', { projectId, createdAfter: cut });
  const onPage = await tool('list_issues', { projectId, pageUrl: page });
  const both = await ok('list_issues', { projectId });
  assert.deepEqual(both.issues.map((row) => row.id).sort(), [first.id, newer.id].sort());
  pass('CONTROL: with no filter both issues come back', `${both.total} issue(s)`);

  if (expect === 'old') {
    // This client against a server that predates the filters.
    for (const [label, result] of [['createdAfter', since], ['pageUrl', onPage]]) {
      assert.equal(result.isError, true, `${label}: the client returned a list from a server that ignored the filter`);
      assert.equal(result.data.code, 'FILTER_NOT_SUPPORTED');
      assert.match(result.data.message, new RegExp(label));
      pass(`${label} on an older server is refused by name`, result.data.message);
    }
    assert.equal('commentCount' in both.issues[0], false, 'an older server was expected, but it already returns reply state');
    pass('the older server returns no reply state, and the plain list still works', Object.keys(both.issues[0]).join(', '));
    const got = (await ok('get_issue', { issueId: first.id })).data;
    assert.equal('comments' in got, false, 'an older server was expected, but get_issue already carries comments');
    assert.equal(got.id, first.id);
    pass('get_issue still reads the issue (no comments yet on this server)', got.displayId);
  } else {
    assert.equal(since.isError, false, JSON.stringify(since.data).slice(0, 300));
    assert.deepEqual(since.data.issues.map((row) => row.id), [newer.id], "createdAfter = the first issue's own createdAt must return only the newer issue");
    assert.deepEqual(since.data.filters, { createdAfter: new Date(cut).toISOString(), pageUrl: null });
    pass("createdAfter = the first issue's own createdAt returns only the newer issue", `cut ${cut}, filters ${JSON.stringify(since.data.filters)}`);

    assert.equal(onPage.isError, false, JSON.stringify(onPage.data).slice(0, 300));
    assert.deepEqual(onPage.data.issues.map((row) => row.id), [first.id], 'pageUrl must ignore the stored query string and exclude the other page');
    pass('pageUrl returns only the issue on that page, ignoring its query string', JSON.stringify(onPage.data.filters));

    const untouched = both.issues.find((row) => row.id === first.id);
    assert.deepEqual([untouched.commentCount, untouched.lastCommentAt, untouched.lastCommentBy], [0, null, null]);
    assert.equal(typeof untouched.source, 'string');
    pass('an issue with no comments reads 0 / null / null and names its source', `source ${untouched.source}`);

    await ok('create_comment', { issueId: first.id, content: 'List context: fixed on staging, please check', visibility: 'public', requestId: randomUUID() });
    const replied = (await ok('list_issues', { projectId })).issues;
    const answered = replied.find((row) => row.id === first.id);
    assert.deepEqual([answered.commentCount, answered.lastCommentBy], [1, 'team']);
    assert.equal(Number.isNaN(Date.parse(answered.lastCommentAt)), false);
    assert.equal(replied.find((row) => row.id === newer.id).commentCount, 0);
    pass('after a team reply the issue reads 1 / team, and the other issue is unchanged', `lastCommentAt ${answered.lastCommentAt}`);

    const got = (await ok('get_issue', { issueId: first.id })).data;
    const listed = (await ok('list_comments', { issueId: first.id })).data;
    assert.equal(got.comments.length, 1);
    assert.deepEqual(got.comments.map((row) => row.id), listed.map((row) => row.id));
    assert.equal(got.comments[0].content, 'List context: fixed on staging, please check');
    pass('get_issue carries the discussion, identical to list_comments', `${got.comments.length} comment(s)`);
  }

  const report = { status: 'pass', expect, apiBase, machine: hostname(), email, projectId, steps,
    substitutions: ['designated extension-session credential supplied to MCP; OAuth login flow not exercised', 'issues are filed through the REST API, not a capture', 'no reviewer reply is written here: a guest share page is not driven by this script'] };
  const out = process.env.LIST_CONTEXT_REPORT_DIR || 'test-results';
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `list-context-${production ? 'production' : 'local'}-expect-${expect}.json`), JSON.stringify(report, null, 2));
  console.log(`${steps.length} PASS / 0 FAIL  (${production ? 'production' : 'local'}, server expected: ${expect})`);
} finally {
  try {
    if (projectId) await api(`/projects/${projectId}`, 'DELETE');
  } finally { await client.close(); rmSync(temporary, { recursive: true, force: true }); }
}
