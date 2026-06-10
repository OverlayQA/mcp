// packages/mcp/src/quota.ts
//
// Scan-quota footer appended to scan tool results. The MCP "user" is an AI
// agent that relays result text to a human, so the quota runway has to live
// in the text itself or the human never sees it before hitting the limit.

/**
 * Render a human-readable quota line from the server's scan response.
 * Returns '' when quota fields are absent (older servers) or the plan is
 * unlimited (limit === -1 sentinel), so callers can append unconditionally.
 */
export function quotaFooter(remaining?: number, limit?: number): string {
  if (typeof remaining !== 'number' || typeof limit !== 'number') return '';
  if (limit === -1) return '';
  return `\n\n${remaining} of ${limit} daily scans remaining on your plan. Pro includes unlimited scans (overlayqa.com/pricing).`;
}
