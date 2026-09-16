// RED-stage scaffold: replaced in GREEN.
import { UpdateIssueInput } from '../types.js';

export function buildUpdateIssueRequest(_input: { issueId: string; status: string }): {
  path: string;
  method: 'PATCH';
  body: { status: string };
} {
  throw new Error('not implemented');
}

export const updateIssueTool = {
  name: 'update_issue',
  description: '',
  inputSchema: UpdateIssueInput,
  async handler(_input: { issueId: string; status: string }) {
    return { content: [{ type: 'text' as const, text: '' }] };
  },
};
