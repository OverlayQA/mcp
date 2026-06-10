/**
 * MCP OAuth browser flow.
 *
 * Called by the MCP server entry point (./index.ts) on first run, or after a
 * 401 cleared the stored token. Opens a browser to the dashboard authorize
 * page; the dashboard generates a one-time code and redirects back to a
 * localhost callback we start here. We exchange the code for an MCP session
 * JWT and persist it via ./client.ts.
 *
 * Flow:
 *   1. Start a temporary HTTP server on a random port (0 = OS-assigned)
 *   2. Open https://app.overlayqa.com/mcp/authorize?port=<chosen> in the browser
 *   3. Wait for GET http://localhost:<port>/callback?code=<value>
 *   4. POST https://api.overlayqa.com/api/mcp/token with { code }
 *   5. Persist { token, teamId } to ~/.overlayqa/auth.json
 *   6. Show a success page, close the temp server, return the credentials
 *
 * Whole flow times out after 5 minutes.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getStoredAuth, storeAuth, type AuthConfig } from './client.js';

const DASHBOARD_URL = 'https://app.overlayqa.com';
const TOKEN_EXCHANGE_URL = 'https://api.overlayqa.com/api/mcp/token';
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

interface TokenExchangeResponse {
  token: string;
  teamId: string;
}

/**
 * Run the OAuth browser flow and return the resulting MCP credentials.
 * If a valid token already exists in storage, returns it without launching
 * the browser.
 */
export async function authenticate(): Promise<AuthConfig> {
  const existing = getStoredAuth();
  if (existing) {
    return existing;
  }

  return new Promise<AuthConfig>((resolve, reject) => {
    let resolved = false;

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing authorization code');
        finishWithError(new Error('No authorization code received'));
        return;
      }

      try {
        const tokenRes = await fetch(TOKEN_EXCHANGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });

        if (!tokenRes.ok) {
          const errPayload = await tokenRes.json().catch(() => null);
          const message =
            (errPayload as { error?: { message?: string } } | null)?.error?.message ??
            `Token exchange failed (HTTP ${tokenRes.status})`;
          throw new Error(message);
        }

        const payload = (await tokenRes.json()) as TokenExchangeResponse;
        if (!payload?.token || !payload?.teamId) {
          throw new Error('Token exchange response missing token or teamId');
        }

        storeAuth({ token: payload.token, teamId: payload.teamId });

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OverlayQA — Connected</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a8a 0%,#3468F8 100%);font-family:system-ui,-apple-system,sans-serif;">
<div style="background:#fff;border-radius:1rem;padding:2.5rem;max-width:380px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.12);">
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style="margin-bottom:1.5rem;" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#3468F8"/><path d="M12 20a8 8 0 1116 0 8 8 0 01-16 0z" stroke="#fff" stroke-width="2.5" fill="none"/><path d="M20 15v5l3 3" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <h2 style="margin:0 0 .25rem;font-size:1.25rem;font-weight:700;color:#09090b;">Connected</h2>
  <p style="margin:0 0 1.5rem;font-size:.875rem;color:#6b7280;">Your editor is now connected to OverlayQA.</p>
  <div style="display:flex;align-items:center;justify-content:center;width:3rem;height:3rem;border-radius:50%;background:#f0fdf4;margin:0 auto 1rem;">
    <svg width="24" height="24" viewBox="0 0 20 20" fill="#22c55e" aria-hidden="true"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
  </div>
  <p style="margin:0;font-size:.75rem;color:#9ca3af;">You can close this tab and return to your editor.</p>
</div>
</body></html>`);

        finishWithSuccess({ token: payload.token, teamId: payload.teamId });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OverlayQA — Connection Failed</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a8a 0%,#3468F8 100%);font-family:system-ui,-apple-system,sans-serif;">
<div style="background:#fff;border-radius:1rem;padding:2.5rem;max-width:380px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.12);">
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style="margin-bottom:1.5rem;" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#3468F8"/><path d="M12 20a8 8 0 1116 0 8 8 0 01-16 0z" stroke="#fff" stroke-width="2.5" fill="none"/><path d="M20 15v5l3 3" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <h2 style="margin:0 0 .25rem;font-size:1.25rem;font-weight:700;color:#09090b;">Connection failed</h2>
  <p style="margin:0 0 1rem;font-size:.875rem;color:#6b7280;">Something went wrong while connecting your editor.</p>
  <p style="margin:0;font-size:.875rem;color:#6b7280;">Restart the MCP server in your editor to try again.</p>
</div>
</body></html>`);
        finishWithError(err instanceof Error ? err : new Error(String(err)));
      }
    });

    function finishWithSuccess(auth: AuthConfig): void {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      server.close(() => resolve(auth));
    }

    function finishWithError(err: Error): void {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutHandle);
      server.close(() => reject(err));
    }

    // 5-minute hard timeout for the whole flow.
    const timeoutHandle = setTimeout(() => {
      finishWithError(new Error('Authentication timed out (5 minutes)'));
    }, AUTH_TIMEOUT_MS);

    server.on('error', (err) => {
      finishWithError(err);
    });

    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        finishWithError(new Error('Failed to get local server address'));
        return;
      }
      const port = address.port;
      // source=mcp lets the dashboard attribute signups that originate from the
      // MCP funnel (vs web/extension) in analytics. All directory installs run
      // the same `npx`, so this distinguishes the MCP channel as a whole, not
      // individual directories.
      const authorizeUrl = `${DASHBOARD_URL}/mcp/authorize?port=${port}&source=mcp`;

      try {
        const open = (await import('open')).default;
        await open(authorizeUrl);
      } catch {
        // open() can fail in headless environments (CI, dev container, etc.).
        // Print the URL so the user can paste it into a browser manually.
        console.error(`Open this URL in your browser: ${authorizeUrl}`);
      }
    });
  });
}
