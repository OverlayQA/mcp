import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export const id = '00000000-0000-4000-8000-000000000001';
export function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
export function payload(result) { return JSON.parse(result.content[0].text); }

// Only the HTTP boundary is substituted. Registration, validation, telemetry,
// auth cache, tool handlers and JSON-RPC use the actual compiled product.
export async function startFixture(t, handler, clientInfo = { name: 'OverlayQA edge regression', version: '1.0.0' }) {
  const dir = mkdtempSync(join(tmpdir(), 'overlayqa-edge-'));
  const authFile = join(dir, 'auth.json');
  const setAuth = auth => writeFileSync(authFile, JSON.stringify(auth), { mode: 0o600 });
  setAuth({ token: 'old-test-token', teamId: id });
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      let text = '';
      for await (const chunk of req) text += chunk;
      const request = { path: req.url, method: req.method, headers: req.headers, body: text ? JSON.parse(text) : undefined };
      requests.push(request);
      await handler(request, res);
    } catch (error) { if (!res.destroyed) json(res, 500, { error: String(error) }); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/api/mcp`;
  const client = new Client(clientInfo);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [process.env.MCP_TEST_ENTRY ?? fileURLToPath(new URL('../../dist/index.js', import.meta.url))],
    env: { ...process.env, OVERLAYQA_AUTH_FILE: authFile, OVERLAYQA_API_BASE: apiBase },
    stderr: 'pipe',
  });
  const close = async () => {
    try { await client.close(); }
    finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  };
  t.after(close);
  await client.connect(transport);
  return { client, requests, apiBase, authFile, setAuth, readAuth: () => JSON.parse(readFileSync(authFile, 'utf8')) };
}
