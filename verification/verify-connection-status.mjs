/** Browser verification using OverlayQA's designated sign-in fixtures. */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const monorepo = process.env.OQ_MONOREPO_ROOT;
const require = createRequire(`${monorepo}/packages/dashboard/package.json`);
const { chromium, expect } = require('@playwright/test');
const { completeAuthForm } = await import(pathToFileURL(`${monorepo}/packages/dashboard/e2e/journeys/_team.ts`));
const { loadCreds } = await import(pathToFileURL(`${monorepo}/packages/dashboard/e2e/journeys/_shared.ts`));
const api = process.env.OQ_API_ORIGIN;
const dashboard = process.env.OQ_DASHBOARD_ORIGIN;
const production = api === 'https://api.overlayqa.com';
const control = process.argv.includes('--control');
const clientRoot = process.env.OQ_CLIENT_ROOT || root;
const report = path.join(root, 'verification', 'reports', process.env.OQ_REPORT_PHASE || (control ? 'control' : production ? 'production' : 'local'));
mkdirSync(report, { recursive: true });
const creds = production ? { email: 'testsprite@overlayqa.com', password: readFileSync(path.join(os.homedir(), '.overlayqa/testsprite-password'), 'utf8').trim() } : loadCreds();
if (!creds) throw new Error('Designated credentials unavailable');
const evidence = { machine: os.hostname(), api, dashboard, account: creds.email, control, clientRoot, sourceHash: execFileSync('shasum', ['-a', '256', `${clientRoot}/src/auth.ts`, ...(control ? [] : [`${clientRoot}/src/connection-page.ts`])], { encoding: 'utf8' }).trim(), substitutions: ['OS browser-launch call delivered to Playwright; actual authorize route and callback', 'Credential home isolated in a temporary directory; actual storeAuth writer', ...(production ? [] : ['Token-exchange origin pointed to the local API'])], checks: [] };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: path.join(report, 'video') } });
// Observe the actual CSS animation from the callback's first rendered frame.
// No stylesheet, animation duration or playback position is substituted.
await context.addInitScript(() => {
  window.__oqStatusFrames = [];
  let capturedCelebration = false;
  function observe() {
    const icon = document.querySelector('.status svg');
    if (icon) {
      const style = getComputedStyle(icon);
      const status = icon.closest('.status');
      const transform = new DOMMatrix(getComputedStyle(status).transform);
      const scale = Math.hypot(transform.a, transform.b);
      const draw = parseFloat(getComputedStyle(icon.querySelector('path')).strokeDashoffset);
      const sparkOpacity = Math.max(0, ...Array.from(status.querySelectorAll('.status__spark'), s => Number(getComputedStyle(s).opacity)));
      const animations = status.getAnimations({ subtree: true });
      window.__oqStatusFrames.push({ time: performance.now(), opacity: Number(style.opacity), transform: style.transform, scale, draw, sparkOpacity, active: animations.some(a => a.playState === 'running') });
      if (!capturedCelebration && sparkOpacity > .5 && scale > 1) {
        capturedCelebration = true;
        void window.oqCaptureCelebration();
      }
      if (window.__oqStatusFrames.length > 1 && !animations.some(a => a.playState === 'running')) return;
    }
    requestAnimationFrame(observe);
  }
  requestAnimationFrame(observe);
});
const page = await context.newPage();
let celebrationCapture;
await page.exposeFunction('oqCaptureCelebration', () => {
  celebrationCapture = page.screenshot({ path: path.join(report, 'connected-celebrating.png') });
  return celebrationCapture;
});
const children = [];
const authDirectories = [];
async function waitForFile(file) {
  await expect.poll(() => existsSync(file), { timeout: 45000 }).toBe(true);
  return readFileSync(file, 'utf8');
}
async function screenshot(name) {
  await page.screenshot({ path: path.join(report, `${name}.png`) });
  const detail = await page.evaluate(() => {
    const main = document.querySelector('main') || document.body.firstElementChild;
    return { heading: document.querySelector('h1,h2')?.textContent, iconCount: main.querySelectorAll('svg').length, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, text: main.textContent.trim() };
  });
  if (!control) { expect(detail.iconCount).toBe(1); expect(detail.scrollWidth).toBe(detail.viewport); }
  evidence.checks.push({ name, observedAt: new Date().toISOString(), status: 'pass', detail });
  console.log(`PASS ${name}`);
}
try {
  await page.goto(`${dashboard}/sign-in`);
  const login = await completeAuthForm(page, creds.email, creds.password);
  if (!login.ok) throw new Error(login.why);
  await expect.poll(() => page.evaluate(() => Boolean(window.Clerk?.session))).toBe(true);
  const identity = await page.evaluate(async ({origin, email}) => {
    const token = await window.Clerk.session.getToken();
    const get = async route => (await (await fetch(`${origin}/api${route}`, { headers: { Authorization: `Bearer ${token}` } })).json()).data;
    const teams = await get('/teams');
    const members = await get(`/teams/${teams[0].id}/members`);
    return { role: members.find(m => m.user?.email === email)?.role, teamId: teams[0].id };
  }, {origin: api, email: creds.email});
  expect(identity.role).toBeTruthy();
  evidence.identity = identity;
  const scenarios = control ? [{ success: true }, { success: false }] : [{ success: true }, { success: true, reduced: true }, { success: false }];
  for (const { success, reduced = false } of scenarios) {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const temp = mkdtempSync(path.join(os.tmpdir(), 'oq-connection-'));
    authDirectories.push(temp);
    const urlFile = path.join(temp, 'authorize-url');
    const resultFile = path.join(temp, 'result.json');
    const child = spawn(process.execPath, [path.join(here, 'auth-runner.mjs')], { env: { ...process.env, OQ_CLIENT_ROOT: clientRoot, OQ_API_ORIGIN: api, OQ_AUTH_DIRECTORY: temp, OQ_AUTHORIZE_URL_FILE: urlFile, OQ_AUTH_RESULT_FILE: resultFile }, stdio: 'ignore' });
    children.push(child);
    const authorize = new URL(await waitForFile(urlFile));
    if (success) {
      await page.goto(`${dashboard}${authorize.pathname}${authorize.search}`);
      await expect(page.getByRole('heading', { name: 'Connected', exact: true })).toBeVisible({ timeout: 45000 });
      await expect.poll(() => new URL(page.url()).hostname).toBe('localhost');
    } else {
      // A genuinely rejected exchange exercises the product failure branch.
      await page.goto(`http://localhost:${authorize.searchParams.get('port')}/callback?code=oq-invalid-status-fixture`);
      await expect(page.getByRole('heading', { name: 'Connection failed', exact: true })).toBeVisible();
    }
    const outcome = JSON.parse(await waitForFile(resultFile));
    expect(outcome.connected).toBe(success);
    if (success) { expect(outcome.restored).toBe(true); expect(outcome.projectsStatus).toBe(200); }
    const state = success ? reduced ? 'connected-reduced-motion' : 'connected' : 'failed';
    evidence.checks.push({ name: `${state}-callback-and-storage`, observedAt: new Date().toISOString(), status: 'pass', detail: outcome });
    if (!control) {
      await expect.poll(() => page.evaluate(() => {
        const frames = window.__oqStatusFrames;
        return frames.length > 1 && !frames.at(-1).active;
      })).toBe(true);
      const visual = await page.evaluate(() => {
        const style = getComputedStyle(document.querySelector('.status'));
        return { border: style.borderTopColor, borderWidth: style.borderTopWidth, fill: style.backgroundColor, frames: window.__oqStatusFrames };
      });
      expect(visual.borderWidth).toBe('1px');
      expect(visual.border).toBe(success ? 'rgb(187, 247, 208)' : 'rgb(254, 202, 202)');
      expect(visual.fill).toBe(success ? 'rgb(240, 253, 244)' : 'rgb(254, 242, 242)');
      if (success && !reduced) {
        expect(visual.frames.some(f => f.active && f.opacity < 1)).toBe(true);
        expect(visual.frames.some(f => f.scale > 1)).toBe(true);
        expect(visual.frames.some(f => f.draw > 0)).toBe(true);
        expect(visual.frames.some(f => f.sparkOpacity > 0)).toBe(true);
        expect(visual.frames.at(-1).opacity).toBe(1);
        expect(visual.frames.at(-1).draw).toBe(0);
        expect(visual.frames.at(-1).sparkOpacity).toBe(0);
        expect(celebrationCapture).toBeTruthy();
        await celebrationCapture;
        evidence.checks.push({ name: 'connected-celebrating', observedAt: new Date().toISOString(), status: 'pass', detail: 'Screenshot during real, unmodified load animation; no playback seeking.' });
      } else {
        expect(visual.frames.every(f => f.opacity === 1 && !f.active && f.scale === 1 && f.draw === 0 && f.sparkOpacity === 0)).toBe(true);
      }
      evidence.checks.push({ name: `${state}-stroke-and-motion`, observedAt: new Date().toISOString(), status: 'pass', detail: visual });
    }
    await screenshot(`${state}-desktop`);
    await page.setViewportSize({ width: 320, height: 640 });
    await screenshot(`${state}-narrow`);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
} catch (error) {
  evidence.error = String(error); process.exitCode = 1; console.error(error);
  await page.screenshot({ path: path.join(report, 'failure.png') }).catch(() => {});
} finally {
  for (const child of children) if (child.exitCode === null) child.kill();
  await context.close(); await browser.close();
  for (const directory of authDirectories) rmSync(directory, { recursive: true, force: true });
  writeFileSync(path.join(report, 'results.json'), JSON.stringify(evidence, null, 2));
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  writeFileSync(path.join(report, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Editor connection status</title><style>body{font:16px/1.5 system-ui;max-width:1200px;margin:32px auto}img{max-width:100%}pre{white-space:pre-wrap}</style><h1>Editor connection status</h1><pre>${escape(JSON.stringify(evidence, null, 2))}</pre>${evidence.checks.filter(c => /desktop|narrow|celebrating/.test(c.name)).map(c => `<h2>${c.name}</h2><img src="${c.name}.png">`).join('')}${evidence.error ? '<h2>Failure evidence</h2><img src="failure.png">' : ''}`);
}
