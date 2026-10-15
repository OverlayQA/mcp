/**
 * MCP HTTP client. Wraps fetch with Bearer auth, rejected-token cleanup,
 * and token cache I/O at ~/.overlayqa/auth.json.
 *
 * This module does NOT initiate OAuth. It only reads stored credentials and
 * makes API calls. The entry point starts ./auth.ts's browser sign-in when
 * launched without credentials. Each request reads the latest saved login.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
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

export interface AuthConfig {
  token: string;
  teamId: string;
}

/**
 * Read the stored auth config from ~/.overlayqa/auth.json. Returns null if
 * the file doesn't exist, is malformed, or doesn't contain both `token` and
 * `teamId`.
 */
export function getStoredAuth(): AuthConfig | null {
  try {
    if (!existsSync(AUTH_FILE)) return null;
    const data = JSON.parse(readFileSync(AUTH_FILE, 'utf-8'));
    return data && typeof data.token === 'string' && /^[\x21-\x7e]+$/.test(data.token)
      && typeof data.teamId === 'string' && data.teamId.trim()
      ? { token: data.token, teamId: data.teamId }
      : null;
  } catch {
    return null;
  }
}

/**
 * Persist the auth config to ~/.overlayqa/auth.json. Creates the directory
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

export interface McpFetchResult {
  status: number;
  data: unknown;
}

/**
 * Make an authenticated HTTPS call to /api/mcp/{path}.
 * - Reads the Bearer token from ~/.overlayqa/auth.json
 * - Returns { status: 401, data: { error, code: 'AUTH_REQUIRED' } } if no token
 * - Clears the rejected token on a server 401, preserving a newer sign-in
 */
export async function mcpFetch(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<McpFetchResult> {
  const auth = getStoredAuth();
  if (!auth) {
    return {
      status: 401,
      data: {
        error: true,
        code: 'AUTH_REQUIRED',
        message:
          'Not authenticated with OverlayQA. A sign-in tab should have opened in your browser when this server started — complete it and retry. If not, restart the MCP server to relaunch sign-in.',
      },
    };
  }

  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.token}`,
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

  if (res.status === 401) {
    clearAuth(auth.token);
  }

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
