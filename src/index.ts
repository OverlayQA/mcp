#!/usr/bin/env node
// packages/mcp/src/index.ts
/**
 * OverlayQA MCP server entry point.
 *
 * Launched by AI hosts (Claude Code, Cursor) via:
 *   npx @overlayqa/mcp@latest
 *
 * Flow on first run:
 *   1. No token at ~/.overlayqa/auth.json -> launch OAuth browser flow
 *      (./auth.ts). User logs into the dashboard, dashboard issues a
 *      one-time code, we exchange it for a 30-day JWT, persist it.
 *   2. Subsequent runs reuse the cached JWT.
 *   3. On a server 401 mid-session, the HTTP client clears the cached
 *      token; the next tool call will trigger a re-auth via the per-tool
 *      handler below.
 *
 * Each tool handler wraps its underlying call in try/catch so an
 * unexpected throw becomes a structured MCP error response instead of
 * crashing the stdio process.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getStoredAuth } from './client.js';
import { authenticate } from './auth.js';

import { scanAccessibilityTool } from './tools/scan-accessibility.js';
import { scanContrastTool } from './tools/scan-contrast.js';
import { scanAndCreateIssuesTool } from './tools/scan-and-create-issues.js';
import { compareVisualTool } from './tools/compare-visual.js';
import { auditTokensTool } from './tools/audit-tokens.js';
import { createIssueTool } from './tools/create-issue.js';
import { listIssuesTool } from './tools/list-issues.js';
import { listProjectsTool } from './tools/list-projects.js';
import { createProjectTool } from './tools/create-project.js';

/**
 * Permissive shape for the heterogeneous tool registry. Each tool file
 * declares its own concrete input schema and handler signature; here we
 * only need to shuttle values through to server.tool(...). The type
 * safety lives inside the tool files themselves.
 */
interface AnyTool {
  name: string;
  description: string;
  inputSchema: { shape: Record<string, unknown> };
  handler: (args: unknown) => Promise<{
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
  }>;
}

const ALL_TOOLS: AnyTool[] = [
  scanAccessibilityTool,
  scanContrastTool,
  scanAndCreateIssuesTool,
  compareVisualTool,
  auditTokensTool,
  createIssueTool,
  listIssuesTool,
  listProjectsTool,
  createProjectTool,
] as unknown as AnyTool[];

async function main(): Promise<void> {
  // Ensure we have credentials before opening stdio.
  if (!getStoredAuth()) {
    // OAuth via the browser. authenticate() throws on timeout or fetch error.
    // We deliberately log to stderr (stdout is reserved for the stdio protocol).
    console.error('No OverlayQA credentials found. Starting authentication...');
    try {
      await authenticate();
      console.error('Authentication successful!');
    } catch (err) {
      console.error(
        'Authentication failed:',
        err instanceof Error ? err.message : err,
      );
      process.exit(1);
    }
  }

  const server = new McpServer({
    name: 'overlayqa',
    version: '0.1.0',
  });

  for (const tool of ALL_TOOLS) {
    // SDK 1.x signature: server.tool(name, description, inputSchema.shape, handler)
    // - inputSchema.shape exposes the ZodObject's per-field schemas
    // - handler receives the parsed args object as its first argument
    // - handler MUST return { content: [{ type, text }], isError? }
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape,
      // The SDK passes the parsed object as the first arg. We forward it
      // straight to the tool's handler. We also wrap in try/catch so any
      // unexpected error becomes a structured response instead of crashing
      // the stdio transport.
      async (args: Record<string, unknown>) => {
        try {
          // Re-check auth on each call. If the HTTP client wiped the
          // token via a server 401, the next mcpFetch() inside the tool
          // will return { status: 401, code: 'AUTH_REQUIRED' } and the
          // user will need to restart. We don't re-launch the browser
          // mid-session (would be jarring); we surface the auth error.
          return await tool.handler(args);
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
