import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Ask the shipped entry point, so grouped exports and registration changes
// cannot silently disappear from the downloadable bundle's tool catalog.
export async function readToolCatalog(root) {
  const dir = mkdtempSync(join(tmpdir(), 'overlayqa-bundle-catalog-'));
  const authFile = join(dir, 'auth.json');
  const client = new Client({ name: 'OverlayQA bundle builder', version: '1' });
  try {
    // Suppress interactive sign-in. Discovery calls no tool handlers and the
    // isolated credential cannot authorize a request to the product.
    writeFileSync(authFile, JSON.stringify({ token: 'bundle-catalog-only', teamId: '00000000-0000-4000-8000-000000000000' }), { mode: 0o600 });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [join(root, 'dist/index.js')],
      env: { ...process.env, OVERLAYQA_AUTH_FILE: authFile, OVERLAYQA_API_BASE: 'http://127.0.0.1:1/api/mcp' },
      stderr: 'pipe',
    }));
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : {});
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    if (!tools.length) throw new Error('[pack-mcpb] server advertised no tools');
    return tools;
  } finally {
    try { await client.close(); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  }
}
