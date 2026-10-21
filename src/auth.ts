/**
 * Hosted sign-in: OAuth 2.1 with PKCE against api.overlayqa.com/mcp/oauth,
 * the same sign-in Claude and ChatGPT use for the hosted connection.
 *
 * Called from the entry point (./index.ts) once the editor has introduced
 * itself and no credential is stored. The editor is registered as an OAuth
 * client, the browser opens the dashboard consent page, and the redirect
 * lands on a loopback callback started here. The code is exchanged for a
 * short-lived access token plus a refresh token and persisted via ./client.ts.
 *
 * Flow:
 *   1. Start a temporary HTTP server on 127.0.0.1 (port 0 = OS-assigned)
 *   2. POST /mcp/oauth/register with that callback as the redirect URI
 *   3. Open /mcp/oauth/authorize (PKCE S256, state, resource) in the browser
 *   4. Wait for GET http://127.0.0.1:<port>/callback?code=<value>&state=<state>
 *   5. POST /mcp/oauth/token with the code and PKCE verifier
 *   6. Persist the credential, show a success page, close the temp server
 *
 * Whole flow times out after 5 minutes.
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { getStoredAuth, storeAuth, requestHostedTokens, OAUTH_ISSUER, MCP_RESOURCE, type AuthConfig } from './client.js';
import { renderConnectionPage } from './connection-page.js';

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const HTML = { 'Content-Type': 'text/html' };

export interface SignInOptions {
  /** Shown on the consent screen and in Connected AI apps. Defaults to the package name. */
  clientName?: string;
  /** Receives the consent URL. Verification harnesses drive the browser themselves. */
  onAuthorizeUrl?: (url: string) => void;
}

/**
 * Run the hosted sign-in and return the resulting credential. If a credential
 * already exists in storage (hosted or legacy), returns it without launching
 * the browser.
 */
export async function authenticate(options: SignInOptions = {}): Promise<AuthConfig> {
  const existing = getStoredAuth();
  if (existing) {
    return existing;
  }

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');

  return new Promise<AuthConfig>((resolve, reject) => {
    let resolved = false;
    let clientId = '';
    let redirectUri = '';

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // Only the consent this process started may land here.
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('This sign-in link does not belong to the editor that is waiting. Restart the MCP server and connect again.');
        return;
      }

      const code = url.searchParams.get('code');
      const denied = url.searchParams.get('error');
      if (denied || !code) {
        res.writeHead(400, HTML);
        res.end(renderConnectionPage(false));
        finishWithError(new Error(url.searchParams.get('error_description') ?? denied ?? 'No authorization code received'));
        return;
      }

      try {
        const auth = await requestHostedTokens({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          code_verifier: verifier,
          client_id: clientId,
        });
        storeAuth(auth);

        res.writeHead(200, HTML);
        res.end(renderConnectionPage(true));

        finishWithSuccess(auth);
      } catch (err) {
        res.writeHead(500, HTML);
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
      redirectUri = `http://127.0.0.1:${address.port}/callback`;

      try {
        clientId = await registerClient(options.clientName ?? '@overlayqa/mcp', redirectUri);
      } catch (err) {
        finishWithError(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const authorizeUrl = new URL(`${OAUTH_ISSUER}/authorize`);
      authorizeUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        resource: MCP_RESOURCE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
      }).toString();
      options.onAuthorizeUrl?.(authorizeUrl.toString());
      // Always printed: a browser that opened behind the editor, or none at
      // all (CI, dev container), still leaves the user a link to follow.
      // stderr only — stdout is the stdio protocol.
      console.error(`Connect your OverlayQA account in the browser: ${authorizeUrl}`);
      // OVERLAYQA_SIGNIN_NO_BROWSER is for OverlayQA's own verification, which
      // drives the consent page itself; a published build always opens the browser.
      if (process.env.OVERLAYQA_SIGNIN_NO_BROWSER === '1') return;
      try {
        const open = (await import('open')).default;
        await open(authorizeUrl.toString());
      } catch {
        // open() can fail in headless environments; the printed URL is the fallback.
      }
    });
  });
}

/** Register this editor's loopback callback as an OAuth client; returns its client_id. */
async function registerClient(clientName: string, redirectUri: string): Promise<string> {
  const res = await fetch(`${OAUTH_ISSUER}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName.slice(0, 100),
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  const data = (await res.json().catch(() => null)) as { client_id?: unknown; error?: string; error_description?: string } | null;
  if (!res.ok || typeof data?.client_id !== 'string') {
    throw new Error(data?.error_description ?? data?.error ?? `Could not register this editor with OverlayQA (HTTP ${res.status}).`);
  }
  return data.client_id;
}
