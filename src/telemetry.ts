// RED-stage scaffold: exports exist so test/telemetry.test.ts can run and
// fail on its assertions rather than on an import error. Replaced in GREEN.
import { z } from 'zod';

export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}
export interface RawTool {
  name: string;
  description: string;
  inputSchema: { shape: Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any) => Promise<ToolResponse>;
}
export interface WrappedTool {
  name: string;
  description: string;
  inputSchema: { shape: Record<string, unknown> };
  handler: (args: Record<string, unknown>) => Promise<ToolResponse>;
}

export const CONTEXT_MAX_CHARS = 280;
export const CONTEXT_FIELD = z.string().optional();

export async function withIntent<T>(_intent: string | undefined, fn: () => Promise<T>): Promise<T> {
  return fn();
}
export function currentIntent(): string | undefined {
  return undefined;
}
export function setClientInfoProvider(_provider: () => { name: string; version: string } | undefined): void {}
export function buildTelemetryHeaders(): Record<string, string> {
  return {};
}
export function wrapTool(tool: RawTool): WrappedTool {
  return tool as WrappedTool;
}
