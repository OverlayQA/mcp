import { z } from 'zod';
import { CompareVisualInput } from '../types.js';
import { request } from './request.js';

export const compareVisualTool = {
  name: 'compare_visual',
  description: 'Start AI visual comparison of a public page against a Figma frame, saved design or uploaded image. Supply reference, or both figmaFileKey and figmaNodeId. Captures at the design’s authored width. Optional measureSpacing adds supported element measurements and tolerances. Uses your scan allowance and returns a persistent job ID; results include individual differences and screenshot evidence. Does not create issues or provide a deterministic pixel-difference build gate.',
  inputSchema: CompareVisualInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  handler: (input: z.infer<typeof CompareVisualInput>) => request('/compare/visual', 'POST', input),
};
