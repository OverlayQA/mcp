// Real built MCP -> controllable HTTP fault boundary -> actual API and persistence.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { execFileSync } from 'node:child_process';
import { startFixture, deferred, payload } from './helpers/stdio-fixture.mjs';

const apiBase = process.env.OQ_HARNESS_API_URL || process.env.MCP_PARITY_API;
assert(apiBase && ['localhost', '127.0.0.1', 'api.overlayqa.com'].includes(new URL(apiBase).hostname), 'Explicit allowed API target required');
const production = new URL(apiBase).hostname === 'api.overlayqa.com';
const email = production ? 'testsprite@overlayqa.com' : 'harness-journey+clerk_test@overlayqa.com';
const password = production ? readFileSync(join(homedir(), '.overlayqa/testsprite-password'), 'utf8').trim() : readFileSync(process.env.MCP_SERVER_ENV, 'utf8').match(/^HARNESS_TEST_PASSWORD=(.*)$/m)?.[1].trim();
assert(password, 'Fixture password available');
const entry = resolve(process.env.MCP_TEST_ENTRY || 'dist/index.js');
process.env.MCP_TEST_ENTRY = entry;
const out = resolve(process.env.MCP_REPORT_DIR || 'verification/reports/transport-edge-live');
mkdirSync(out, { recursive: true });
const result = { startedAt: new Date().toISOString(), machine: hostname(), apiBase, email, role: 'unverified', entry, entrySha256: createHash('sha256').update(readFileSync(entry)).digest('hex'), clientBase: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: resolve(dirname(fileURLToPath(import.meta.url)), '..') }).trim(), substitutions: ['Designated extension-session credential supplied in isolated MCP auth file; browser OAuth and editor UI not exercised.', 'Fault proxy delays one genuine 401, corrupts one genuine read and one saved-write response, disconnects after another saved write, and holds one genuine read until MCP cancellation. All other HTTP requests reach the named API.'], steps: [], cleanup: [] };
let auth, projectId, close;
async function api(path, method = 'GET', body) {
  const res = await fetch(`${apiBase}/api${path}`, { method, headers: { Authorization: `Bearer ${auth.sessionToken}`, 'Content-Type': 'application/json', 'x-overlayqa-internal': 'harness' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json(); assert.equal(res.ok, true, `${method} ${path}: ${res.status} ${JSON.stringify(data)}`); return data.data ?? data;
}
async function check(name, fn) {
  const step = { name, observedAt: new Date().toISOString() };
  try { step.evidence = await fn(); step.status = 'PASS'; }
  catch (error) { step.status = 'FAIL'; step.error = error.message; }
  result.steps.push(step); console.log(`${step.status} ${name}${step.error ? `: ${step.error}` : ''}`);
}
try {
  const login = await fetch(`${apiBase}/api/auth/extension/email-login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(login.status, 200); auth = (await login.json()).data;
  const members = await api(`/teams/${auth.activeTeamId}/members`);
  const self = members.find(row => row.user?.email === email); assert(self); result.role = self.role;
  const savedAuth = { token: auth.sessionToken, teamId: auth.activeTeamId };
  let mode = 'pass'; let reached, release, closed, savedWrite;
  const upstream = [];
  const f = await startFixture({ after: fn => { close = fn; } }, async (req, res) => {
    const currentMode = mode;
    const abort = new AbortController(); res.on('close', () => abort.abort());
    const response = await fetch(`${apiBase}${req.path}`, { method: req.method, headers: { ...req.headers, host: new URL(apiBase).host }, body: req.body === undefined ? undefined : JSON.stringify(req.body), signal: abort.signal });
    const body = await response.text();
    upstream.push({ path: req.path, method: req.method, status: response.status, observedAt: new Date().toISOString() });
    if (currentMode !== 'late-401' && !response.ok) {
      res.writeHead(response.status, { 'Content-Type': 'application/json' }); res.end(body); return;
    }
    if (currentMode === 'late-401') { reached.resolve(response.status); await release.promise; }
    if (currentMode === 'cancel') { res.on('close', () => closed.resolve(true)); reached.resolve(response.status); return; }
    if (currentMode === 'unreadable-write' || currentMode === 'disconnect-write') savedWrite = JSON.parse(body);
    if (currentMode === 'disconnect-write') { res.destroy(); return; }
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    res.end(currentMode.startsWith('unreadable') ? '<html>Injected lost response</html>' : body);
  }, { name: '编辑器\r\n', version: '1.0.0' });
  const call = async (name, args = {}, options) => {
    for (let attempt = 0; ; attempt++) {
      const response = await f.client.callTool({ name, arguments: args }, undefined, options);
      let refusal; try { refusal = payload(response)?.error; } catch { /* scan quota footer */ }
      if (!response.isError || refusal?.code !== 'RATE_LIMITED' || !Number.isFinite(refusal.retryAfter) || attempt >= 2) return response;
      console.log(`WAIT ${name}: respecting server retryAfter=${refusal.retryAfter}s`);
      await delay((refusal.retryAfter + 1) * 1000);
    }
  };
  await check('A genuine delayed 401 preserves a fresh valid sign-in and the next call works', async () => {
    reached = deferred(); release = deferred(); mode = 'late-401';
    const first = call('list_projects');
    assert.equal(await reached.promise, 401);
    f.setAuth(savedAuth); mode = 'pass'; release.resolve();
    assert.equal((await first).isError, true); assert.deepEqual(f.readAuth(), savedAuth);
    const next = await call('list_projects', { context: 'Check projects \ud800' });
    assert.notEqual(next.isError, true, JSON.stringify(next));
    assert.equal(f.requests.at(-1).headers['x-overlayqa-mcp-client'], undefined);
    return { rejectedStatus: 401, nextStatus: upstream.at(-1).status, freshSignInPreserved: true, invalidOptionalMetadataOmitted: true };
  });
  f.setAuth(savedAuth); mode = 'pass';
  await check('An unreadable genuine read returns an error and a later read recovers', async () => {
    mode = 'unreadable-read'; const broken = await call('list_projects'); mode = 'pass';
    assert.equal(broken.isError, true); assert.equal(payload(broken).code, 'INVALID_RESPONSE');
    assert.notEqual((await call('list_projects')).isError, true);
    return { invalidCode: payload(broken).code, recovered: true };
  });
  const prefix = `harness-run-mcp-edge-${Date.now()}`;
  const project = await api('/projects', 'POST', { teamId: auth.activeTeamId, name: prefix, slug: prefix }); projectId = project.id;
  for (const [index, fault] of ['unreadable-write', 'disconnect-write'].entries()) {
  await check(`A ${fault} after saving is flagged, never retried, and the issue can be reopened`, async () => {
    const before = upstream.length; mode = fault;
    const write = await call('create_issue', { projectId, title: prefix }); mode = 'pass';
    assert.equal(write.isError, true); assert.match(payload(write).message, /may have completed/);
    const issue = savedWrite.data ?? savedWrite;
    assert(issue.id); const writes = upstream.slice(before).filter(r => r.method === 'POST');
    assert.equal(writes.filter(r => r.status >= 200 && r.status < 300).length, 1);
    assert(writes.every(r => (r.status >= 200 && r.status < 300) || r.status === 429));
    const opened = payload(await call('get_issue', { issueId: issue.id }));
    assert.equal((opened.data ?? opened).title, prefix);
    const list = payload(await call('list_issues', { projectId })); assert.equal(list.total, index + 1);
    return { issueId: issue.id, acceptedWriteCount: 1, rateLimitRefusals: writes.filter(r => r.status === 429).length, persistedIssueCount: list.total, reopenedTitle: prefix };
  });
  }
  mode = 'pass';
  await check('Cancelling a genuine pending read closes its HTTP connection and the next call works', async () => {
    reached = deferred(); closed = deferred(); mode = 'cancel'; const controller = new AbortController();
    const pending = call('list_projects', {}, { signal: controller.signal }).catch(e => e);
    assert.equal(await reached.promise, 200); controller.abort(); await pending;
    assert.equal(await Promise.race([closed.promise, delay(2000).then(() => false)]), true);
    mode = 'pass'; assert.notEqual((await call('list_projects')).isError, true);
    return { cancelledConnectionClosed: true, recovered: true, serverRollbackClaimed: false };
  });
  mode = 'pass';
  for (const name of ['scan_accessibility', 'scan_contrast']) {
    await check(`${name} completes through the real queue and returns findings`, async () => {
      const before = upstream.length;
      const response = await call(name, { url: 'https://example.com' }, { timeout: 90000 });
      assert.notEqual(response.isError, true, JSON.stringify(response));
      // Quota copy follows the JSON object; the API's last status body is
      // independently read below, without copying any client polling logic.
      const last = upstream.slice(before).filter(r => r.path.includes('/scan/status/')).at(-1); assert(last);
      const res = await fetch(`${apiBase}${last.path}`, { headers: { Authorization: `Bearer ${auth.sessionToken}` } });
      assert.equal(res.status, 200); const state = await res.json(); assert.equal(state.status, 'complete'); assert(Array.isArray(state.violations));
      return { scanUrl: 'https://example.com', jobPath: last.path, status: state.status, violationCount: state.violations.length, httpRequests: upstream.length - before };
    });
  }
  result.upstream = upstream;
} catch (error) {
  result.steps.push({ name: 'Setup', status: 'FAIL', observedAt: new Date().toISOString(), error: error.message });
} finally {
  if (projectId) {
    try { await api(`/projects/${projectId}`, 'DELETE'); result.cleanup.push({ projectId, deleted: true }); }
    catch (error) { result.cleanup.push({ projectId, deleted: false, error: error.message }); }
  }
  if (close) await close();
  result.finishedAt = new Date().toISOString(); result.passed = result.steps.filter(s => s.status === 'PASS').length; result.failed = result.steps.filter(s => s.status === 'FAIL').length;
  result.status = result.failed || result.cleanup.some(s => !s.deleted) ? 'FAIL' : 'PASS';
  writeFileSync(join(out, 'results.json'), JSON.stringify(result, null, 2));
  console.log(`${result.status}: ${result.passed} passed, ${result.failed} failed. Report: ${out}`);
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}
