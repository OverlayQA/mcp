#!/usr/bin/env node
// packages/mcp/src/index.ts
/**
 * OverlayQA MCP server entry point.
 *
 * Launched by AI hosts (Claude Code, Cursor) via:
 *   npx @overlayqa/mcp@latest
 *
 * Flow on first run:
 *   1. No credential at ~/.overlayqa/auth.json -> once the editor has
 *      introduced itself, launch the hosted sign-in (./auth.ts): the user
 *      allows access on the dashboard consent page and we persist a
 *      short-lived access token plus a 30-day refresh token.
 *   2. Subsequent runs reuse the cached credential; ./client.ts refreshes
 *      the access token in the background. A credential saved before 0.6.0
 *      (the 30-day token) is used as stored until it expires.
 *   3. A server 401 that a refresh cannot cure clears the rejected cached
 *      credential. Restart to launch sign-in again; credentials saved by
 *      another session are picked up on the next call without restarting.
 *
 * Each tool handler wraps its underlying call in try/catch so an
 * unexpected throw becomes a structured MCP error response instead of
 * crashing the stdio process.
 */
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getStoredAuth } from './client.js';
import { authenticate } from './auth.js';
import { withRequestSignal } from './request-context.js';
import { wrapTool, setClientInfoProvider, type RawTool } from './telemetry.js';

// Keep the advertised server version in lockstep with package.json (dist/
// sits one level below the package root, so ../package.json resolves there).
const require = createRequire(import.meta.url);
const { version: PACKAGE_VERSION } = require('../package.json') as { version: string };

import { workflowActionTools } from './tools/workflow-actions.js';
import { scanAccessibilityTool } from './tools/scan-accessibility.js';
import { scanContrastTool } from './tools/scan-contrast.js';
import { scanAndCreateIssuesTool } from './tools/scan-and-create-issues.js';
import { runAutoReviewTool, getReviewResultTool } from './tools/review-workflows.js';
import { compareVisualTool } from './tools/compare-visual.js';
import { auditTokensTool } from './tools/audit-tokens.js';
import { createIssueTool } from './tools/create-issue.js';
import { listIssuesTool } from './tools/list-issues.js';
import { listProjectsTool } from './tools/list-projects.js';
import { createProjectTool } from './tools/create-project.js';
import { listLabelsTool, createLabelTool, renameLabelTool, deleteLabelTool, setIssueLabelTool } from './tools/labels.js';
import { updateIssueTool } from './tools/update-issue.js';
import { verifyIssueTool, getIssueVerificationsTool } from './tools/verification.js';
import { getIssueTool, listProjectMembersTool, moveIssueTool } from './tools/issue-context.js';
import { listCommentsTool, createCommentTool, updateCommentTool, deleteCommentTool, getCommentAttachmentTool } from './tools/comments.js';
import { listClientReviewsTool, createClientReviewTool, updateClientReviewTool, setClientReviewRecipientsTool } from './tools/client-reviews.js';

/**
 * Each tool file declares its own concrete input schema and handler
 * signature; here we only shuttle values through to server.registerTool(...) after
 * wrapTool adds the `context` argument (see ./telemetry.ts). The type safety
 * lives inside the tool files themselves.
 */
const ALL_TOOLS = (
  [
    ...workflowActionTools,
    scanAccessibilityTool,
    scanContrastTool,
    scanAndCreateIssuesTool,
    compareVisualTool, runAutoReviewTool, getReviewResultTool,
    auditTokensTool,
    createIssueTool,
    listIssuesTool,
    updateIssueTool,
    getIssueTool, listProjectMembersTool, moveIssueTool,
    verifyIssueTool, getIssueVerificationsTool,
    listCommentsTool, createCommentTool, updateCommentTool, deleteCommentTool, getCommentAttachmentTool,
    listLabelsTool, createLabelTool, renameLabelTool, deleteLabelTool, setIssueLabelTool,
    listProjectsTool,
    createProjectTool,
    listClientReviewsTool, createClientReviewTool, updateClientReviewTool, setClientReviewRecipientsTool,
  ] as unknown as RawTool[]
).map(wrapTool);

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'overlayqa',
    version: PACKAGE_VERSION,
  }, { instructions: 'run_auto_review and compare_visual start persistent reviews. Use get_review_result with the returned jobId until complete or failed, waiting between running results. After a lost start response, retry the same inputs and requestId. Do not start another review to retrieve a result. Public captures have no browser login session. These calls return findings without creating issues. Use create_review_issues with explicit finding indexes to file selected results. Scheduled run requests use run_scheduled_review then get_scheduled_review_result; retain the same requestId for retries. Export only to the explicitly chosen tracker destination and inspect partial results.' });

  // Which editor is on the other end (Claude Code, Cursor, Windsurf, ...) is
  // known only after the initialize handshake, so the HTTP client reads it
  // lazily per request rather than at startup.
  setClientInfoProvider(() => {
    const info = server.server.getClientVersion();
    return info ? { name: info.name, version: info.version } : undefined;
  });

  // Connect stdio FIRST, sign in in the background. Blocking startup on the
  // browser flow meant headless environments (registry sandboxes, CI,
  // directory installability checks) could never even answer tools/list.
  // Whether to sign in is decided once, at startup, as before; the flow
  // itself starts once the editor has introduced itself, so the consent
  // screen and Connected AI apps carry its name. Tool calls made before it
  // completes return a structured AUTH_REQUIRED error, and mcpFetch re-reads
  // ~/.overlayqa/auth.json on every call so it picks up the credential the
  // moment the browser flow finishes. (stderr only — stdout is the stdio protocol.)
  if (!getStoredAuth()) server.server.oninitialized = () => {
    const editor = server.server.getClientVersion()?.name;
    console.error('No OverlayQA credentials found. Starting sign-in...');
    void authenticate({ clientName: editor ? `${editor} via @overlayqa/mcp` : '@overlayqa/mcp' })
      .then(() => console.error('Connected to OverlayQA.'))
      .catch((err) =>
        console.error(
          'Sign-in failed (tools will return AUTH_REQUIRED):',
          err instanceof Error ? err.message : err,
        ),
      );
  };

  for (const tool of ALL_TOOLS) {
    // Named configuration avoids server.tool's positional overload: SDK
    // 1.32.1 treats empty annotations as a schema and then calls {} as the
    // handler. Keep annotations optional and the callback unambiguous.
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema.shape,
        annotations: tool.annotations,
      },
      // The SDK passes the parsed object as the first arg. We forward it
      // straight to the tool's handler. We also wrap in try/catch so any
      // unexpected error becomes a structured response instead of crashing
      // the stdio transport.
      async (args: Record<string, unknown>, extra) => {
        try {
          // Re-check auth on each call. If the HTTP client wiped the
          // credential after a server 401 that no refresh could cure, the
          // next mcpFetch() inside the tool will return { status: 401,
          // code: 'AUTH_REQUIRED' } and the user will need to restart. We
          // don't re-launch the browser mid-session (would be jarring); we
          // surface the auth error.
          return await withRequestSignal(extra.signal, () => tool.handler(args));
        } catch (err) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: true,
                  code: 'SERVER_ERROR',
                  message: err instanceof Error ? err.message : 'Unknown error',
                }),
              },
            ],
            isError: true,
          };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
