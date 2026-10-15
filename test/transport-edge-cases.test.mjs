import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { id, deferred, json, payload, startFixture } from './helpers/stdio-fixture.mjs';

test('a delayed 401 cannot erase credentials saved after the request started', async t => {
  const reached = deferred(); const release = deferred();
  const f = await startFixture(t, async (req, res) => {
    if (req.headers.authorization === 'Bearer old-test-token') {
      reached.resolve(); await release.promise;
      json(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Expired token' } });
    } else json(res, 200, { projects: [] });
  });
  const first = f.client.callTool({ name: 'list_projects', arguments: {} });
  await reached.promise;
  const renewed = { token: 'renewed-test-token', teamId: id };
  f.setAuth(renewed); release.resolve();
  assert.equal((await first).isError, true);
  assert.deepEqual(f.readAuth(), renewed);
  assert.notEqual((await f.client.callTool({ name: 'list_projects', arguments: {} })).isError, true);
  assert.equal(f.requests.at(-1).headers.authorization, 'Bearer renewed-test-token');
});

test('an expired current token is cleared; a later sign-in works without restarting MCP', async t => {
  const f = await startFixture(t, (req, res) => json(res, req.headers.authorization === 'Bearer old-test-token' ? 401 : 200, { projects: [] }));
  assert.equal((await f.client.callTool({ name: 'list_projects', arguments: {} })).isError, true);
  assert.deepEqual(f.readAuth(), {});
  assert.equal(payload(await f.client.callTool({ name: 'list_projects', arguments: {} })).code, 'AUTH_REQUIRED');
  f.setAuth({ token: 'renewed-test-token', teamId: id });
  assert.notEqual((await f.client.callTool({ name: 'list_projects', arguments: {} })).isError, true);
});

test('malformed saved credentials are refused locally instead of being sent as bearer tokens', async t => {
  const f = await startFixture(t, (_req, res) => json(res, 200, { projects: [] }));
  for (const auth of [{ token: {}, teamId: id }, { token: true, teamId: id }, { token: 'token', teamId: [] }, { token: ' \n ', teamId: id }]) {
    f.setAuth(auth);
    const response = await f.client.callTool({ name: 'list_projects', arguments: {} });
    assert.equal(response.isError, true);
    assert.equal(payload(response).code, 'AUTH_REQUIRED');
  }
  assert.equal(f.requests.length, 0);
});

test('unreadable successful replies are errors, writes are not retried, and the next read recovers', async t => {
  let body = '<html>Unexpected gateway response</html>';
  const f = await startFixture(t, (req, res) => {
    res.writeHead(req.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' }); res.end(body);
  });
  for (const raw of [body, '', 'null', '"unexpected string"']) {
    body = raw;
    const response = await f.client.callTool({ name: 'list_projects', arguments: {} });
    assert.equal(response.isError, true, raw);
    assert.equal(payload(response).code, 'INVALID_RESPONSE');
  }
  body = '<html>Lost create response</html>';
  const written = await f.client.callTool({ name: 'create_issue', arguments: { projectId: id, title: 'Uncertain write' } });
  assert.equal(written.isError, true);
  assert.match(payload(written).message, /may have completed/i);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
  body = '{"projects":[]}';
  assert.notEqual((await f.client.callTool({ name: 'list_projects', arguments: {} })).isError, true);
});

test('HTTP refusals retain their status; empty 204 deletion replies remain successful', async t => {
  let mode = 'limited';
  const f = await startFixture(t, (_req, res) => {
    if (mode === 'limited') json(res, 429, { error: { code: 'RATE_LIMITED', retryAfter: 3 } });
    else if (mode === 'gateway') { res.writeHead(503); res.end('upstream unavailable'); }
    else { res.writeHead(204); res.end(); }
  });
  const limited = await f.client.callTool({ name: 'list_projects', arguments: {} });
  assert.equal(limited.isError, true); assert.equal(payload(limited).error.retryAfter, 3);
  mode = 'gateway';
  const gateway = await f.client.callTool({ name: 'list_projects', arguments: {} });
  assert.equal(gateway.isError, true); assert.equal(payload(gateway).httpStatus, 503);
  mode = 'empty';
  assert.notEqual((await f.client.callTool({ name: 'delete_label', arguments: { projectId: id, labelId: id } })).isError, true);
  assert.equal(f.requests.length, 3);
});

test('optional editor metadata and malformed Unicode context cannot break the tool', async t => {
  const f = await startFixture(t, (_req, res) => json(res, 200, { projects: [] }), { name: '编辑器\r\n', version: '1.0.0' });
  const response = await f.client.callTool({ name: 'list_projects', arguments: { context: 'Check issues \ud800' } });
  assert.notEqual(response.isError, true, JSON.stringify(response));
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].headers['x-overlayqa-mcp-client'], undefined);
});

test('concurrent calls keep their own metadata and strip context from write payloads', async t => {
  const firstReached = deferred(); const releaseFirst = deferred();
  const f = await startFixture(t, async (req, res) => {
    if (req.method === 'GET') { firstReached.resolve(); await releaseFirst.promise; }
    json(res, req.method === 'POST' ? 201 : 200, { ok: true });
  });
  const first = f.client.callTool({ name: 'list_projects', arguments: { context: 'Read 日本語' } });
  await firstReached.promise;
  const second = await f.client.callTool({ name: 'create_issue', arguments: { projectId: id, title: 'Write', context: 'Write separately' } });
  releaseFirst.resolve();
  assert.notEqual((await first).isError, true); assert.notEqual(second.isError, true);
  assert.equal(decodeURIComponent(f.requests[0].headers['x-overlayqa-mcp-intent']), 'Read 日本語');
  assert.equal(decodeURIComponent(f.requests[1].headers['x-overlayqa-mcp-intent']), 'Write separately');
  assert.equal(f.requests[1].body.context, undefined);
});

test('MCP cancellation aborts the pending HTTP read and leaves other tools usable', async t => {
  const reached = deferred(); const closed = deferred();
  const f = await startFixture(t, (req, res) => {
    if (req.path.endsWith('/projects')) {
      res.on('close', () => closed.resolve(true)); reached.resolve();
    } else json(res, 200, { issue: id });
  });
  const controller = new AbortController();
  const call = f.client.callTool({ name: 'list_projects', arguments: {} }, undefined, { signal: controller.signal }).catch(e => e);
  await reached.promise; controller.abort(); await call;
  const outcome = await Promise.race([closed.promise, delay(1000).then(() => false)]);
  assert.equal(outcome, true, 'The cancelled MCP call left its HTTP request open');
  assert.notEqual((await f.client.callTool({ name: 'get_issue', arguments: { issueId: id } })).isError, true);
});

test('failed scan jobs remain errors and missing job IDs never produce a status request', async t => {
  let mode = 'failed';
  const f = await startFixture(t, (req, res) => {
    if (req.method === 'POST') json(res, 200, mode === 'missing' ? {} : { jobId: 'scan-job' });
    else json(res, 200, { status: 'failed', error: 'Page unavailable' });
  });
  for (const name of ['scan_accessibility', 'scan_contrast']) {
    assert.equal((await f.client.callTool({ name, arguments: { url: 'https://api.overlayqa.com/sandbox/' } })).isError, true);
    mode = 'missing'; const before = f.requests.length;
    const missing = await f.client.callTool({ name, arguments: { url: 'https://api.overlayqa.com/sandbox/' } });
    assert.equal(missing.isError, true); assert.equal(payload(missing).code, 'INVALID_RESPONSE');
    assert.equal(f.requests.length, before + 1, 'No poll of an undefined job');
    mode = 'failed';
  }
});


test('scan polling enforces its deadline even when the HTTP response never arrives', async t => {
  const f = await startFixture(t, (req, res) => {
    if (req.path.endsWith('/projects')) json(res, 200, { projects: [] });
    // Leave the scan status request open to exercise the real HTTP deadline.
  });
  const entry = process.env.MCP_TEST_ENTRY ?? resolve('dist/index.js');
  const module = pathToFileURL(resolve(dirname(entry), 'client.js')).href;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e',
    // The release check on 2026-10-15 timed out before its first request at
    // 100ms. Warm up fetch in this same process before testing a stalled poll;
    // still require a status request so timing out before dispatch cannot pass.
    `const { mcpFetch, pollScanJob } = await import(${JSON.stringify(module)}); await mcpFetch('/projects'); console.log(JSON.stringify(await pollScanJob('slow-job', 1000, 2000)));`
  ], { env: { ...process.env, OVERLAYQA_AUTH_FILE: f.authFile, OVERLAYQA_API_BASE: f.apiBase }, timeout: 5000 });
  const response = JSON.parse(stdout);
  assert.equal(response.status, 504); assert.equal(response.data.code, 'SCAN_TIMEOUT');
  assert.match(response.data.message, /1 seconds/);
  assert.equal(f.requests.filter(req => req.path.includes('/scan/status/')).length, 1);
});

test('cancelling a scan during the polling pause stops further polls and isolates concurrent calls', async t => {
  const polled = deferred(); const active = deferred(); const release = deferred();
  const f = await startFixture(t, async (req, res) => {
    if (req.path.endsWith('/projects')) { active.resolve(); await release.promise; return json(res, 200, { projects: [] }); }
    if (req.method === 'POST') return json(res, 200, { jobId: 'queued-job' });
    json(res, 200, { status: 'queued' }); polled.resolve();
  });
  const other = f.client.callTool({ name: 'list_projects', arguments: {} });
  await active.promise;
  const controller = new AbortController();
  const scan = f.client.callTool({ name: 'scan_contrast', arguments: { url: 'https://example.com' } }, undefined, { signal: controller.signal }).catch(e => e);
  await polled.promise; await delay(100); controller.abort(); await scan;
  release.resolve(); assert.notEqual((await other).isError, true);
  // The production poll interval is 2 seconds. Observe beyond the next poll.
  await delay(2200);
  assert.equal(f.requests.filter(r => r.path.includes('/scan/status/')).length, 1);
});

test('unrecognized scan states fail promptly and job IDs stay in one URL segment', async t => {
  const f = await startFixture(t, (req, res) => json(res, 200, req.method === 'POST' ? { jobId: 'job/id?query' } : { status: 'unknown' }));
  const response = await f.client.callTool({ name: 'scan_contrast', arguments: { url: 'https://example.com' } }, undefined, { timeout: 1000 });
  assert.equal(response.isError, true); assert.equal(payload(response).code, 'INVALID_RESPONSE');
  assert.equal(f.requests.at(-1).path, '/api/mcp/scan/status/job%2Fid%3Fquery');
});

test('cancellation after response headers aborts body reading instead of reporting null success', async t => {
  const reached = deferred(); const closed = deferred();
  const f = await startFixture(t, (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{');
    res.on('close', () => closed.resolve(true)); reached.resolve();
  });
  const controller = new AbortController();
  const call = f.client.callTool({ name: 'list_projects', arguments: {} }, undefined, { signal: controller.signal }).catch(e => e);
  await reached.promise; controller.abort(); await call;
  assert.equal(await Promise.race([closed.promise, delay(1000).then(() => false)]), true);
});

test('a disconnected write reports an uncertain outcome without repeating the request', async t => {
  const f = await startFixture(t, (req, res) => {
    if (req.method === 'POST') res.destroy();
    else json(res, 200, { projects: [] });
  });
  const response = await f.client.callTool({ name: 'create_issue', arguments: { projectId: id, title: 'Disconnected response' } });
  assert.equal(response.isError, true);
  assert.match(payload(response).message, /may have completed/i);
  assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
  assert.notEqual((await f.client.callTool({ name: 'list_projects', arguments: {} })).isError, true);
});
