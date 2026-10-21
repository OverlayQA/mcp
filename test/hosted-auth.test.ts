/**
 * Hosted sign-in contract (node:test, loopback fake of api.overlayqa.com):
 *
 *  - a stored legacy token `{ token, teamId }` is honoured untouched, so an
 *    editor that signed in before 0.6.0 keeps working until that token expires;
 *  - a first run registers an OAuth client, sends the editor to the hosted
 *    consent page with PKCE S256 + state, verifies state on the loopback
 *    callback, exchanges the code and stores short-lived hosted credentials;
 *  - an access token about to expire is refreshed before the request, one
 *    refresh at a time, and the rotated pair replaces the stored one;
 *  - a refresh the server refuses (disconnected in the dashboard) clears the
 *    stored credentials and the call reports AUTH_REQUIRED;
 *  - a 401 on a hosted credential triggers one refresh and one retry.
 *
 * Run: npm test (tsc -p tsconfig.test.json && node --test dist-test/test/).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Recorded = { method: string; path: string; headers: IncomingMessage['headers']; body: string };
const requests: Recorded[] = [];
let tokenResponder: (form: URLSearchParams, res: ServerResponse) => void = () => {};
let bearerExpected = 'at-1';
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};
const fake = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const path = req.url ?? '/';
  requests.push({ method: req.method ?? '', path, headers: req.headers, body });
  if (req.method === 'POST' && path === '/mcp/oauth/register') {
    const input = JSON.parse(body);
    return json(res, 201, { client_id: 'client-1', client_name: input.client_name, redirect_uris: input.redirect_uris });
  }
  if (req.method === 'POST' && path === '/mcp/oauth/token') {
    assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded');
    return tokenResponder(new URLSearchParams(body), res);
  }
  if (req.method === 'GET' && path === '/api/mcp/projects') {
    if (req.headers.authorization !== `Bearer ${bearerExpected}`) return json(res, 401, { error: { code: 'UNAUTHORIZED', message: 'nope' } });
    return json(res, 200, { data: [] });
  }
  json(res, 404, { error: 'unexpected ' + path });
});
await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
const address = fake.address();
const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
const dir = mkdtempSync(join(tmpdir(), 'overlayqa-hosted-auth-'));
process.env.OVERLAYQA_API_BASE = `${origin}/api/mcp`;
process.env.OVERLAYQA_AUTH_FILE = join(dir, 'auth.json');
process.env.OVERLAYQA_SIGNIN_NO_BROWSER = '1';
const { mcpFetch, getStoredAuth, storeAuth, clearAuth } = await import('../src/client.js');
const { authenticate } = await import('../src/auth.js');
const stored = () => JSON.parse(readFileSync(process.env.OVERLAYQA_AUTH_FILE!, 'utf8'));
const tokenCalls = () => requests.filter(r => r.path === '/mcp/oauth/token');
const grant = (suffix: string) => ({ access_token: `at-${suffix}`, token_type: 'bearer', expires_in: 3600, refresh_token: `rt-${suffix}`, scope: 'overlayqa:read overlayqa:write overlayqa:scan' });

test.after(() => { fake.close(); rmSync(dir, { recursive: true, force: true }); });
test.beforeEach(() => { requests.length = 0; clearAuth(); });

test('a legacy token is honoured as stored and never refreshed', async () => {
  storeAuth({ token: 'legacy-jwt', teamId: '00000000-0000-4000-8000-000000000001' });
  assert.deepEqual(getStoredAuth(), { token: 'legacy-jwt', teamId: '00000000-0000-4000-8000-000000000001' });
  bearerExpected = 'legacy-jwt';
  const result = await mcpFetch('/projects');
  assert.equal(result.status, 200);
  assert.equal(tokenCalls().length, 0);
  assert.deepEqual(stored(), { token: 'legacy-jwt', teamId: '00000000-0000-4000-8000-000000000001' });
});

test('hosted credentials round-trip through storage; malformed files read as signed out', () => {
  storeAuth({ token: 'at-1', refreshToken: 'rt-1', expiresAt: 1_900_000_000_000, clientId: 'client-1' });
  assert.deepEqual(getStoredAuth(), { token: 'at-1', refreshToken: 'rt-1', expiresAt: 1_900_000_000_000, clientId: 'client-1' });
  storeAuth({ token: 'with spaces is not a token', refreshToken: 'rt-1', expiresAt: 1, clientId: 'c' });
  assert.equal(getStoredAuth(), null);
});

test('first run: register, consent redirect with PKCE and state, callback exchange, hosted credentials stored', async () => {
  let authorizeUrl = '';
  tokenResponder = (form, res) => {
    const authorize = new URL(authorizeUrl);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('code'), 'code-123');
    assert.equal(form.get('client_id'), 'client-1');
    assert.equal(form.get('resource'), `${origin}/mcp`);
    assert.equal(form.get('redirect_uri'), authorize.searchParams.get('redirect_uri'));
    const challenge = createHash('sha256').update(form.get('code_verifier')!).digest('base64url');
    assert.equal(challenge, authorize.searchParams.get('code_challenge'));
    json(res, 200, grant('1'));
  };
  const signedIn = authenticate({ clientName: 'claude-code via @overlayqa/mcp', onAuthorizeUrl: url => { authorizeUrl = url; } });
  await new Promise(resolve => setTimeout(resolve, 150));
  const register = requests.find(r => r.path === '/mcp/oauth/register');
  assert.ok(register, 'client registered');
  const registration = JSON.parse(register.body);
  assert.equal(registration.client_name, 'claude-code via @overlayqa/mcp');
  assert.equal(registration.token_endpoint_auth_method, 'none');
  assert.match(registration.redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const authorize = new URL(authorizeUrl);
  assert.equal(authorize.origin + authorize.pathname, `${origin}/mcp/oauth/authorize`);
  assert.equal(authorize.searchParams.get('response_type'), 'code');
  assert.equal(authorize.searchParams.get('client_id'), 'client-1');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorize.searchParams.get('resource'), `${origin}/mcp`);
  assert.match(authorize.searchParams.get('code_challenge') ?? '', /^[A-Za-z0-9_-]{43}$/);
  const state = authorize.searchParams.get('state');
  assert.ok(state && state.length >= 16, 'state present');
  const callback = new URL(authorize.searchParams.get('redirect_uri')!);
  // A callback carrying someone else's state is refused before any exchange.
  const forged = await fetch(`${callback}?code=code-123&state=forged`);
  assert.equal(forged.status, 400);
  assert.equal(tokenCalls().length, 0);
  const landed = await fetch(`${callback}?code=code-123&state=${encodeURIComponent(state)}`);
  assert.equal(landed.status, 200);
  assert.match(await landed.text(), /Connected/);
  const auth = await signedIn;
  assert.equal(auth.token, 'at-1');
  assert.equal(auth.refreshToken, 'rt-1');
  assert.equal(auth.clientId, 'client-1');
  assert.ok(auth.expiresAt! > Date.now() + 3_000_000 && auth.expiresAt! <= Date.now() + 3_600_000);
  assert.deepEqual(stored(), auth);
});

test('an access token about to expire is refreshed once before the request, even for concurrent calls', async () => {
  storeAuth({ token: 'at-old', refreshToken: 'rt-old', expiresAt: Date.now() + 30_000, clientId: 'client-1' });
  tokenResponder = (form, res) => {
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'rt-old');
    assert.equal(form.get('client_id'), 'client-1');
    assert.equal(form.get('resource'), `${origin}/mcp`);
    json(res, 200, grant('new'));
  };
  bearerExpected = 'at-new';
  const [a, b] = await Promise.all([mcpFetch('/projects'), mcpFetch('/projects')]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(tokenCalls().length, 1, 'one refresh for two concurrent calls');
  assert.equal(stored().token, 'at-new');
  assert.equal(stored().refreshToken, 'rt-new');
});

test('a refresh the server refuses clears the credentials and reports AUTH_REQUIRED', async () => {
  storeAuth({ token: 'at-old', refreshToken: 'rt-revoked', expiresAt: Date.now() - 1, clientId: 'client-1' });
  tokenResponder = (_form, res) => json(res, 400, { error: 'invalid_grant', error_description: 'The connection was disconnected.' });
  const result = await mcpFetch('/projects');
  assert.equal(result.status, 401);
  assert.equal((result.data as { code: string }).code, 'AUTH_REQUIRED');
  assert.equal(getStoredAuth(), null);
});

test('a 401 whose refresh the server refuses (disconnected in the dashboard) reports AUTH_REQUIRED and clears', async () => {
  storeAuth({ token: 'at-revoked', refreshToken: 'rt-revoked', expiresAt: Date.now() + 3_000_000, clientId: 'client-1' });
  tokenResponder = (_form, res) => json(res, 400, { error: 'invalid_grant', error_description: 'The connection was disconnected.' });
  bearerExpected = 'at-someone-else';
  const result = await mcpFetch('/projects');
  assert.equal(result.status, 401);
  assert.equal((result.data as { code: string }).code, 'AUTH_REQUIRED');
  assert.doesNotMatch((result.data as { message: string }).message, /\u2014/);
  assert.equal(getStoredAuth(), null);
  assert.equal(tokenCalls().length, 1);
});

test('a refresh that cannot reach the server keeps the stored credentials', async () => {
  storeAuth({ token: 'at-old', refreshToken: 'rt-old', expiresAt: Date.now() - 1, clientId: 'client-1' });
  tokenResponder = (_form, res) => res.destroy();
  bearerExpected = 'at-old';
  await mcpFetch('/projects');
  assert.equal(getStoredAuth()?.refreshToken, 'rt-old');
});

test('a 401 on a fresh-looking hosted credential refreshes once and retries once', async () => {
  storeAuth({ token: 'at-stale', refreshToken: 'rt-stale', expiresAt: Date.now() + 3_000_000, clientId: 'client-1' });
  tokenResponder = (_form, res) => json(res, 200, grant('retry'));
  bearerExpected = 'at-retry';
  const result = await mcpFetch('/projects');
  assert.equal(result.status, 200);
  assert.equal(tokenCalls().length, 1);
  assert.equal(requests.filter(r => r.path === '/api/mcp/projects').length, 2);
  assert.equal(stored().token, 'at-retry');
});
