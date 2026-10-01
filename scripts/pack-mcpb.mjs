#!/usr/bin/env node
// Builds overlayqa-mcp-<version>.mcpb for Smithery and other MCPB hosts.
// The manifest's version is stamped from package.json here so the two can never drift.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
writeFileSync(join(stage, 'manifest.json'), JSON.stringify({ ...manifest, version: pkg.version }, null, 2));
run('npm ci --omit=dev --ignore-scripts --no-audit --no-fund', stage);
run(`npx -y @anthropic-ai/mcpb validate manifest.json`, stage);
run(`npx -y @anthropic-ai/mcpb pack . ${JSON.stringify(out)}`, stage);
console.log(`[pack-mcpb] wrote ${out}`);
