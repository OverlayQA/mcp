#!/usr/bin/env node
// Publishes build/overlayqa-mcp-<version>.mcpb to Smithery as a stdio release.
// Why not `smithery mcp publish`: it copies manifest.tools into the release, but the MCPB
// manifest spec forbids inputSchema and Smithery rejects tools without one. So this sends
// the same payload the CLI builds, with the full tools from build/smithery-tools.json.
// Usage: npm run release:smithery   (packs, then publishes; run `npx smithery auth login` once first)
// The key comes from SMITHERY_API_KEY, else from the logged-in smithery CLI's settings file
// (`smithery auth token` will not mint an unscoped token, so the CLI session key is used).
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const name = process.env.SMITHERY_SERVER ?? 'overlayqa/mcp';
const cliSettings = join(homedir(), 'Library', 'Application Support', 'smithery', 'settings.json');
const token =
  process.env.SMITHERY_API_KEY ??
  (existsSync(cliSettings) ? JSON.parse(readFileSync(cliSettings, 'utf8')).apiKey : undefined);
if (!token) throw new Error('[publish-smithery] not logged in: run `npx smithery auth login` (or set SMITHERY_API_KEY)');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tools = JSON.parse(readFileSync(join(root, 'build', 'smithery-tools.json'), 'utf8'));
const bundle = readFileSync(join(root, 'build', `overlayqa-mcp-${pkg.version}.mcpb`));

const payload = {
  type: 'stdio',
  runtime: 'node',
  serverCard: { serverInfo: { name: 'overlayqa-mcp', version: pkg.version }, tools },
};
const form = new FormData();
form.append('payload', JSON.stringify(payload));
form.append('bundle', new Blob([bundle]), 'server.mcpb');

const res = await fetch(`https://api.smithery.ai/servers/${name}/releases`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
const body = await res.text();
console.log(`[publish-smithery] ${res.status} ${body.slice(0, 500)}`);
if (!res.ok) process.exit(1);
console.log(`[publish-smithery] track: https://smithery.ai/servers/${name}/releases`);
