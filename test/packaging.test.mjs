import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, cpSync, symlinkSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Exercise npm's actual packaging lifecycle, starting with source and no build.
test('npm pack builds its executable from fresh source and replaces stale output', async t => {
  const stage = mkdtempSync(join(tmpdir(), 'overlayqa-pack-'));
  t.after(() => rmSync(stage, { recursive: true, force: true }));
  for (const name of ['package.json', 'tsconfig.json', 'README.md', 'src']) cpSync(resolve(name), join(stage, name), { recursive: true });
  symlinkSync(resolve('node_modules'), join(stage, 'node_modules'), 'dir');
  const pack = async () => {
    const { stdout } = await promisify(execFile)('npm', ['pack', '--json'], { cwd: stage });
    const [result] = JSON.parse(stdout);
    assert(result.files.some(file => file.path === 'dist/index.js'));
    const { stdout: entry } = await promisify(execFile)('tar', ['-xOf', join(stage, result.filename), 'package/dist/index.js']);
    assert.equal(entry, readFileSync(join(stage, 'dist/index.js'), 'utf8'));
    return entry;
  };
  const first = await pack();
  writeFileSync(join(stage, 'dist/index.js'), 'throw new Error("stale build");');
  assert.equal(await pack(), first);
});
