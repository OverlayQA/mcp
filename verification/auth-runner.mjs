// Run the actual callback and credential writer in an isolated test directory.
// Only browser launch, home-directory lookup, and the local-service URL differ.
import os from 'node:os';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
os.homedir = () => process.env.OQ_AUTH_DIRECTORY;
syncBuiltinESMExports();
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'open') {
      const code = `import {writeFileSync} from 'node:fs'; export default async url => writeFileSync(process.env.OQ_AUTHORIZE_URL_FILE, url);`;
      return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const originalFetch = globalThis.fetch;
globalThis.fetch = (url, init) => originalFetch(
  String(url).replace('https://api.overlayqa.com', process.env.OQ_API_ORIGIN), init,
);
try {
  const { authenticate } = await import(pathToFileURL(`${process.env.OQ_CLIENT_ROOT}/dist/auth.js`));
  const auth = await authenticate();
  const restored = await authenticate();
  const response = await fetch(`${process.env.OQ_API_ORIGIN}/api/mcp/projects`, { headers: { Authorization: `Bearer ${restored.token}` } });
  writeFileSync(process.env.OQ_AUTH_RESULT_FILE, JSON.stringify({ connected: true, restored: auth.token === restored.token && auth.teamId === restored.teamId, projectsStatus: response.status, teamId: auth.teamId }));
} catch (error) {
  writeFileSync(process.env.OQ_AUTH_RESULT_FILE, JSON.stringify({ connected: false, error: String(error) }));
}
