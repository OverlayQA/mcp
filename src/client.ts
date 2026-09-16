/**
 * MCP HTTP client. Wraps fetch with Bearer auth, 401-triggered re-auth,
 * and token cache I/O at ~/.overlayqa/auth.json.
 *
 * This module does NOT initiate OAuth. It only reads stored credentials and
 * makes API calls. The OAuth browser flow lives in ./auth.ts (Task 15) and
 * the MCP server entry point in ./index.ts (Task 17) orchestrates re-auth on
 * 401.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildTelemetryHeaders } from './telemetry.js';

const CONFIG_DIR = join(homedir(), '.overlayqa');
const AUTH_FILE = join(CONFIG_DIR, 'auth.json');
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
    return data.token && data.teamId
      ? { token: data.token as string, teamId: data.teamId as string }
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
export function clearAuth(): void {
  try {
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
 * - Clears the stored auth on a server 401 (so callers can re-trigger OAuth)
 */
export async function mcpFetch(
  path: string,
  options: { method?: string; body?: unknown } = {},
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

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => null);

  if (res.status === 401) {
    // Server rejected our token — wipe it so the next tool call re-triggers OAuth.
    clearAuth();
  }

  return { status: res.status, data };
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
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await mcpFetch(`/scan/status/${jobId}`);
    if (result.status !== 200) return result;

    const data = result.data as { status?: string } | null;
    if (data?.status === 'complete' || data?.status === 'failed') {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    status: 504,
    data: {
      error: true,
      code: 'SCAN_TIMEOUT',
      message: 'Scan did not complete within 60 seconds',
    },
  };
}
