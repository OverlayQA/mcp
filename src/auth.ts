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
import { renderConnectionPage } from './connection-page.js';

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
        res.end(renderConnectionPage(true));

        finishWithSuccess({ token: payload.token, teamId: payload.teamId });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(renderConnectionPage(false));
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
