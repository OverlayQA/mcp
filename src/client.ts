/**
 * MCP HTTP client. Wraps fetch with Bearer auth, hosted-token refresh,
 * rejected-token cleanup, and credential I/O at ~/.overlayqa/auth.json.
 *
 * This module does NOT start a sign-in. It only reads stored credentials,
 * refreshes a hosted access token that is about to expire, and makes API
 * calls. The entry point starts ./auth.ts's browser sign-in when launched
 * without credentials. Each request reads the latest saved login.
 *
 * Two credential shapes live in auth.json:
 *   - hosted (0.6.0+): { token, refreshToken, expiresAt, clientId }, issued
 *     by the hosted sign-in at api.overlayqa.com/mcp/oauth; access lasts an
 *     hour and refreshes here, the connection lasts 30 days and can be
 *     disconnected from the dashboard (Connected AI apps).
 *   - legacy (before 0.6.0): { token, teamId }, a 30-day token with no
 *     refresh. It is used exactly as stored until it expires, so an editor
 *     that signed in before 0.6.0 keeps working without interruption.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { buildTelemetryHeaders } from './telemetry.js';
import { currentRequestSignal, withRequestSignal } from './request-context.js';
import { setTimeout as delay } from 'node:timers/promises';

// Isolated credential files allow verification without replacing a user's saved login.
const AUTH_FILE = process.env.OVERLAYQA_AUTH_FILE ?? join(homedir(), '.overlayqa', 'auth.json');
const CONFIG_DIR = dirname(AUTH_FILE);
// OVERLAYQA_API_BASE is for OverlayQA's own end-to-end verification against a
// local server; every published build talks to production.
const API_BASE = process.env.OVERLAYQA_API_BASE ?? 'https://api.overlayqa.com/api/mcp';
const API_ORIGIN = new URL(API_BASE).origin;
/** The hosted sign-in (OAuth 2.1 issuer) and the resource its tokens are for. */
export const OAUTH_ISSUER = `${API_ORIGIN}/mcp/oauth`;
export const MCP_RESOURCE = `${API_ORIGIN}/mcp`;
// Refresh this far ahead of expiry so a call never starts on a token the
// server is about to refuse; the server's access TTL is one hour.
const REFRESH_AHEAD_MS = 5 * 60 * 1000;
// Serialises refreshes across editor processes sharing auth.json: a rotated
// refresh token presented twice is treated by the server as a replay and
// revokes the whole connection, so only one process may rotate at a time.
const LOCK_DIR = `${AUTH_FILE}.lock`;
const LOCK_STALE_MS = 15_000;
const LOCK_WAIT_MS = 10_000;

export interface AuthConfig {
  token: string;
  /** Legacy credential only; hosted credentials carry the workspace server-side. */
  teamId?: string;
  refreshToken?: string;
  /** Epoch milliseconds; absent on a legacy credential. */
  expiresAt?: number;
  clientId?: string;
}

const printable = (value: unknown): value is string => typeof value === 'string' && /^[\x21-\x7e]+$/.test(value);

/**
 * Read the stored credential from ~/.overlayqa/auth.json. Returns null if
 * the file doesn't exist, is malformed, or holds neither a legacy nor a
 * hosted credential.
 */
export function getStoredAuth(): AuthConfig | null {
  try {
    if (!existsSync(AUTH_FILE)) return null;
    const data = JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
    if (!data || !printable(data.token)) return null;
    if (printable(data.refreshToken) && typeof data.expiresAt === 'number' && printable(data.clientId)) {
      return { token: data.token, refreshToken: data.refreshToken, expiresAt: data.expiresAt, clientId: data.clientId };
    }
    return typeof data.teamId === 'string' && data.teamId.trim() ? { token: data.token, teamId: data.teamId } : null;
  } catch {
    return null;
  }
}

/**
 * Persist the credential to ~/.overlayqa/auth.json. Creates the directory
 * with mode 0700 (owner-only) and the file with mode 0600 (owner read/write).
 */
export function storeAuth(auth: AuthConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
}

/**
 * Best-effort clear of the auth file. Used after a 401 — leaves an empty
 * JSON object so the next call to getStoredAuth() returns null. Swallows
 * I/O errors because there's nothing useful to do on a clear failure.
 */
export function clearAuth(rejectedToken?: string): void {
  try {
    // A late response for an old token must not erase a newer sign-in.
    if (rejectedToken !== undefined && getStoredAuth()?.token !== rejectedToken) return;
    if (existsSync(AUTH_FILE)) {
      writeFileSync(AUTH_FILE, '{}', { mode: 0o600 });
    }
  } catch {
    // ignore
  }
}

interface TokenResponse { access_token: string; refresh_token: string; expires_in: number }

/** The server refused the grant; distinct from a network failure, which keeps the credential. */
export class OAuthRefusedError extends Error {}

/**
 * POST the hosted token endpoint (authorization code or refresh) and map the
 * reply to a stored credential. Throws OAuthRefusedError on an OAuth error
 * reply and a plain Error when the reply is unreadable.
 */
export async function requestHostedTokens(form: Record<string, string>): Promise<AuthConfig> {
  const res = await fetch(`${OAUTH_ISSUER}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...form, resource: MCP_RESOURCE }).toString(),
  });
  const data = (await res.json().catch(() => null)) as (Partial<TokenResponse> & { error?: string; error_description?: string }) | null;
  if (!res.ok) throw new OAuthRefusedError(data?.error_description ?? data?.error ?? `Sign-in failed (HTTP ${res.status})`);
  if (!data || !printable(data.access_token) || !printable(data.refresh_token) || typeof data.expires_in !== 'number') {
    throw new Error('OverlayQA returned an unreadable sign-in reply.');
  }
  return { token: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000, clientId: form.client_id };
}

const expiring = (auth: AuthConfig) => auth.refreshToken !== undefined && auth.expiresAt !== undefined && auth.expiresAt - Date.now() < REFRESH_AHEAD_MS;

async function withAuthLock<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;
  while (!held && Date.now() < deadline) {
    try { mkdirSync(LOCK_DIR); held = true; }
    catch {
      try { if (Date.now() - statSync(LOCK_DIR).mtimeMs > LOCK_STALE_MS) rmSync(LOCK_DIR, { recursive: true, force: true }); } catch { /* raced */ }
      if (!held) await delay(50);
    }
  }
  try { return await fn(); }
  finally { if (held) rmSync(LOCK_DIR, { recursive: true, force: true }); }
}

let refreshing: Promise<AuthConfig | null> | null = null;

/**
 * Rotate the hosted credential whose refresh token is `current`. Returns the
 * credential to use next: the rotated pair, a newer pair another process
 * already stored, the unchanged pair when the server is unreachable, or null
 * once the server refuses the refresh (the connection was disconnected).
 */
function refreshHosted(current: AuthConfig): Promise<AuthConfig | null> {
  refreshing ??= withAuthLock(async () => {
    const latest = getStoredAuth();
    if (!latest?.refreshToken) return null;
    // Another process (a second editor sharing auth.json) already rotated.
    if (latest.refreshToken !== current.refreshToken) return latest;
    try {
      const rotated = await requestHostedTokens({ grant_type: 'refresh_token', refresh_token: latest.refreshToken, client_id: latest.clientId! });
      storeAuth(rotated);
      return rotated;
    } catch (error) {
      if (error instanceof OAuthRefusedError) { clearAuth(latest.token); return null; }
      return latest;
    }
  }).finally(() => { refreshing = null; });
  return refreshing;
}

export interface McpFetchResult {
  status: number;
  data: unknown;
}

const authRequired = (): McpFetchResult => ({
  status: 401,
  data: {
    error: true,
    code: 'AUTH_REQUIRED',
    message:
      'Not connected to OverlayQA. A sign-in tab should have opened in your browser when this server started: complete it and retry. If it did not open, or the connection was disconnected in the OverlayQA dashboard, restart the MCP server to sign in again.',
  },
});

/**
 * Make an authenticated HTTPS call to /api/mcp/{path}.
 * - Reads the Bearer token from ~/.overlayqa/auth.json, refreshing a hosted
 *   token that is about to expire
 * - Returns { status: 401, data: { error, code: 'AUTH_REQUIRED' } } if no token
 * - On a server 401, refreshes a hosted credential once and retries once;
 *   otherwise clears the rejected token, preserving a newer sign-in
 */
export async function mcpFetch(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<McpFetchResult> {
  let auth = getStoredAuth();
  if (auth && expiring(auth)) auth = await refreshHosted(auth);
  if (!auth) return authRequired();

  let result = await send(path, options, auth.token);
  if (result.status !== 401) return result;
  if (!auth.refreshToken) {
    clearAuth(auth.token);
    return result;
  }
  // A hosted credential the server refused: rotate once and retry once. A
  // refused rotation means the connection was disconnected (dashboard,
  // Connected AI apps) or has expired; the credential is already cleared.
  const renewed = await refreshHosted({ ...auth, expiresAt: 0 });
  if (!renewed) return authRequired();
  if (renewed.token === auth.token) return result; // refresh unreachable: keep the credential, report the refusal
  result = await send(path, options, renewed.token);
  if (result.status !== 401) return result;
  clearAuth(renewed.token);
  return authRequired();
}

async function send(path: string, options: { method?: string; body?: unknown; idempotencyKey?: string }, token: string): Promise<McpFetchResult> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    // The agent's stated purpose for this call and the editor's name/version;
    // empty when unknown. See ./telemetry.ts for what is and is not sent.
    ...buildTelemetryHeaders(),
  };

  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: currentRequestSignal(),
    });
  } catch (error) {
    if (currentRequestSignal()?.aborted) throw error;
    return {
      status: 502,
      data: { error: true, code: 'REQUEST_FAILED', message: 'Could not receive a response from OverlayQA.' + retryAdvice(options.method) },
    };
  }

  if (res.status === 401) return { status: 401, data: await res.json().catch(() => null) };

  // No-content replies are valid for mutations such as DELETE. Other tools
  // require JSON data; an HTML gateway page or null is not a successful result.
  if (res.status === 204 || res.status === 205) return { status: res.status, data: null };
  let data: unknown;
  try {
    data = await res.json();
  } catch (error) {
    if (currentRequestSignal()?.aborted) throw error;
    return invalidResponse(res.status, options.method);
  }
  if (data === null || typeof data !== 'object') return invalidResponse(res.status, options.method);
  return { status: res.status, data };
}

function retryAdvice(method = 'GET'): string {
  return method === 'GET'
    ? ' Retry the read when the service is available.'
    : ' The action may have completed. Check the saved state before retrying.';
}

function invalidResponse(httpStatus: number, method = 'GET'): McpFetchResult {
  return {
    status: httpStatus >= 200 && httpStatus < 300 ? 502 : httpStatus,
    data: {
      error: true, code: 'INVALID_RESPONSE', httpStatus,
      message: `OverlayQA returned an unreadable response (HTTP ${httpStatus}).` + retryAdvice(method),
    },
  };
}

/**
 * Poll /scan/status/:jobId every `intervalMs` until the server reports
 * `status: 'complete'` or `status: 'failed'`, or until `timeoutMs` elapses.
 * Returns the most recent fetch result (with the final scan body, or a 504
 * SCAN_TIMEOUT envelope if the timeout fires).
 */
export async function pollScanJob(
  jobId: string,
  timeoutMs = 60_000,
  intervalMs = 2_000,
): Promise<McpFetchResult> {
  if (typeof jobId !== 'string' || !jobId.trim()) {
    return { status: 502, data: { error: true, code: 'INVALID_RESPONSE', message: 'OverlayQA accepted the scan but did not return a job ID. The scan may still be running; no second scan was started.' } };
  }
  const parent = currentRequestSignal();
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await withRequestSignal(controller.signal, async () => {
      while (true) {
        controller.signal.throwIfAborted();
        const result = await mcpFetch(`/scan/status/${encodeURIComponent(jobId)}`);
        if (result.status !== 200) return result;
        const data = result.data as { status?: string };
        if (data.status === 'complete' || data.status === 'failed') return result;
        // The scan queues expose queued/running while work is pending
        // (server/services/freeCheckerQueue.ts and contrastScanQueue.ts).
        if (data.status !== 'queued' && data.status !== 'running') {
          return { status: 502, data: { error: true, code: 'INVALID_RESPONSE', message: 'OverlayQA returned an unrecognized scan status. The scan may still be running.' } };
        }
        await delay(intervalMs, undefined, { signal: controller.signal });
      }
    });
  } catch (error) {
    if (parent?.aborted || !controller.signal.aborted) throw error;
    return { status: 504, data: { error: true, code: 'SCAN_TIMEOUT', message: `Scan did not complete within ${timeoutMs / 1000} seconds. It may still be running on the server.` } };
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  }
}
