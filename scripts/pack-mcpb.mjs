#!/usr/bin/env node
// Builds overlayqa-mcp-<version>.mcpb for Smithery and other MCPB hosts.
// The manifest's version is stamped from package.json here so the two can never drift.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const run = (cmd, cwd = root) => {
  console.log(`[pack-mcpb] $ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const stage = join(root, 'build', 'mcpb');
const out = join(root, 'build', `overlayqa-mcp-${pkg.version}.mcpb`);

run('npm run build');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const f of ['dist', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'icon.png']) {
  cpSync(join(root, f), join(stage, f), { recursive: true });
}
// Tools are read straight from the built tool modules so the list cannot drift.
// The MCPB manifest only allows {name, description}; Smithery also needs inputSchema,
// so the full list goes to build/smithery-tools.json for scripts/publish-smithery.mjs.
// Schemas go through the same wrapTool the server uses, so they match tools/list exactly.
const { wrapTool } = await import(pathToFileURL(join(root, 'dist', 'telemetry.js')).href);
const { z } = await import('zod');
const { zodToJsonSchema } = await import('zod-to-json-schema');
const tools = [];
for (const f of readdirSync(join(root, 'dist', 'tools')).filter((f) => f.endsWith('.js'))) {
  const mod = await import(pathToFileURL(join(root, 'dist', 'tools', f)).href);
  for (const v of Object.values(mod)) {
    if (v && typeof v.name === 'string' && typeof v.description === 'string' && v.inputSchema) {
      const w = wrapTool(v);
      const inputSchema = zodToJsonSchema(z.object(w.inputSchema.shape), { $refStrategy: 'none' });
      delete inputSchema.$schema;
      tools.push({ name: w.name, description: w.description, inputSchema });
    }
  }
}
if (tools.length === 0) throw new Error('[pack-mcpb] found no tools in dist/tools');
console.log(`[pack-mcpb] ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`);
writeFileSync(join(root, 'build', 'smithery-tools.json'), JSON.stringify(tools, null, 2));
const manifestTools = tools.map(({ name, description }) => ({ name, description }));
writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ ...manifest, version: pkg.version, tools: manifestTools }, null, 2));
run('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', stage);
run(`npx -y @anthropic-ai/mcpb validate manifest.json`, stage);
run(`npx -y @anthropic-ai/mcpb pack . ${JSON.stringify(out)}`, stage);
console.log(`[pack-mcpb] wrote ${out}`);
