# OverlayQA MCP

[![Install in Cursor](https://img.shields.io/badge/Install_in-Cursor-3468F8)](https://cursor.com/en/install-mcp?name=overlayqa&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBvdmVybGF5cWEvbWNwQGxhdGVzdCJdfQ==)
[![Install in VS Code](https://img.shields.io/badge/Install_in-VS_Code-3468F8)](https://vscode.dev/redirect/mcp/install?name=overlayqa&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40overlayqa%2Fmcp%40latest%22%5D%7D)
[![npm](https://img.shields.io/npm/v/@overlayqa/mcp?color=3468F8&label=npm)](https://www.npmjs.com/package/@overlayqa/mcp)
[![license](https://img.shields.io/npm/l/@overlayqa/mcp?color=3468F8)](https://www.npmjs.com/package/@overlayqa/mcp)
[![MCP](https://img.shields.io/badge/MCP-compatible-3468F8)](https://modelcontextprotocol.io)

**OverlayQA MCP is a Model Context Protocol server that gives your AI coding agent accessibility and design-QA superpowers.** Ask Claude Code, Cursor, or Windsurf to audit any URL for WCAG and color-contrast issues, then read, assign, discuss, label and resolve issues in your OverlayQA projects without leaving your editor.

```
You:   Scan staging.acme.com for accessibility issues, then open issues for the criticals.
Agent: scan_accessibility → 7 violations (2 critical, 3 high), score 71/100.
       scan_and_create_issues → created 2 issues in "Acme Web":
       - Buttons missing accessible names (WCAG 4.1.2) — critical
       - Insufficient text contrast on .cta (WCAG 1.4.3) — high
You:   List the open criticals.
Agent: list_issues(status=open, severity=critical) → 2 issues.
```

## Install

One click:

- [Install in Cursor](https://cursor.com/en/install-mcp?name=overlayqa&config=eyJ0eXBlIjoic3RkaW8iLCJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBvdmVybGF5cWEvbWNwQGxhdGVzdCJdfQ==)
- [Install in VS Code](https://vscode.dev/redirect/mcp/install?name=overlayqa&config=%7B%22type%22%3A%22stdio%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40overlayqa%2Fmcp%40latest%22%5D%7D)

Or add it to your editor's MCP config manually:

**Claude Code** (`.mcp.json` in your project root) / **Cursor** (`~/.cursor/mcp.json`) / **Windsurf** (`~/.codeium/windsurf/mcp_config.json`):
```json
{
  "mcpServers": {
    "overlayqa": { "command": "npx", "args": ["@overlayqa/mcp@latest"] }
  }
}
```

Any MCP-compatible client works the same way. On first run a browser tab opens to connect your OverlayQA account (free, no card). The token caches at `~/.overlayqa/auth.json` for 30 days.

## Tools

Tools your agent can call. Each is written so the model picks the right one from natural language.

**Audit**
| Tool | What it does |
|------|-------------|
| `scan_accessibility` | Run a WCAG audit (axe-core) on any URL. Returns violations with severity, WCAG success criteria, and an overall score. |
| `scan_contrast` | Check color-contrast ratios across a page. Returns the failing foreground/background element pairs. |
| `audit_tokens` | Audit a live URL's design-system tokens. Returns a 0-100 token-health score and findings (inconsistent font sizes, text colors, spacing, font families, border radii) with severity. Audits the live page only. |

**File and manage issues**
| Tool | What it does |
|------|-------------|
| `scan_and_create_issues` | Scan a URL and auto-create an issue for every violation above a severity threshold. |
| `create_issue` | File a QA issue with title, severity, type, description and optional assignee. |
| `list_issues` | Page through issues filtered by status, severity, type, labels, assignee, creator, or active/finished/ignored state. |
| `update_issue` | Edit supplied issue fields, assignment, ignored state or status. Takes a UUID or display id such as OQ-12. |
| `create_project` | Create a project for a site URL. |
| `list_projects` | List all projects on your team. |
| `list_labels` | Read the workspace label library, assigned labels, and your permissions. |
| `create_label` | Create a reusable workspace label. |
| `set_issue_label` | Apply or remove one label without changing issue text or other labels. |
| `rename_label` | Rename a workspace label (owner/admin). |
| `delete_label` | Delete a workspace label and its assignments; keep the issues (owner/admin). |

**Coming soon**
| Tool | What it does |
|------|-------------|
| `compare_visual` | Compare a live page against a Figma frame. |

## What the server records

Every tool also accepts an optional `context` argument: one sentence on why the agent is calling it. OverlayQA records that sentence, the tool name, your account, project and issue ids, counts and scores, the URL a scan runs on, and your editor's name and version (from the MCP handshake) as product analytics. The sentence is capped and stripped of email addresses and credential-like strings before it is stored. Nothing else travels: not your conversation, not your code, not the tool's replies. Full detail: [overlayqa.com/privacy](https://overlayqa.com/privacy/).

## Example prompts

- "Scan example.com for accessibility issues."
- "Check the contrast on our pricing page and tell me what's failing."
- "Scan staging.acme.com and create issues for anything critical or high."
- "Create a high-severity accessibility issue: the login button has no focus ring."
- "List the open critical issues in the Acme Web project."
- "Create a project for shop.acme.com, then scan it."

## Pricing

| | Scans | Create issues & projects |
|---|---|---|
| **Free** | 3 / day, forever | — |
| **14-day trial** | 30 / day | yes |
| **Paid** | 10-30 / day by plan, unlimited on Pro | yes, with export to Linear / Jira / Asana / Notion |

See [overlayqa.com/pricing](https://overlayqa.com/pricing).

## FAQ

**Which editors does it work with?** Claude Code, Cursor, Windsurf, and any MCP-compatible client (it speaks standard stdio MCP).

**Is it free?** Yes to start: 3 accessibility/contrast scans per day with no card. A 14-day trial raises that to 30 scans per day and unlocks issue and project creation. After that, creating issues and projects needs a paid plan (Pro has unlimited scans).

**What does it actually scan?** Any public URL. Accessibility uses axe-core mapped to WCAG success criteria; contrast checks foreground/background ratios and returns the failing element pairs.

**Do I need an account?** Yes, a free OverlayQA account. On first run a browser tab opens to connect it; the token caches locally for 30 days.

**Does it work with the OverlayQA Chrome extension?** Yes. The MCP server and the extension share the same projects and issues, so anything you file from your editor shows up in the extension and the dashboard, and vice versa.

## Prefer clicking to typing? Meet the extension

The MCP server is one way into OverlayQA. The **[Chrome extension](https://chromewebstore.google.com/detail/overlayqa/pbnjikbncbjaaimelhlkfihgdkocmmei)** is the other: click any element on a live page and it captures a screenshot plus the CSS, DOM, and metadata into a dev-ready issue in seconds, and runs AI accessibility and design-system audits right on the page. Same projects, same issues, shared with this server.

## Links

- Website: [overlayqa.com](https://overlayqa.com)
- Chrome extension: [Chrome Web Store](https://chromewebstore.google.com/detail/overlayqa/pbnjikbncbjaaimelhlkfihgdkocmmei)
- Free accessibility checker (no account): [overlayqa.com/accessibility-checker](https://overlayqa.com/accessibility-checker/)
- Free color-contrast checker (no account): [overlayqa.com/color-contrast-checker](https://overlayqa.com/color-contrast-checker/)
- Pricing: [overlayqa.com/pricing](https://overlayqa.com/pricing)
- Model Context Protocol: [modelcontextprotocol.io](https://modelcontextprotocol.io)

## License

MIT

### Custom issue labels

Use `list_labels` with a project UUID to see that workspace's labels and your permissions. `create_label` creates a reusable label; `set_issue_label` applies or removes it from one issue without changing its other labels or text. Workspace owners and admins can use `rename_label` and `delete_label`; deletion removes the label's assignments, not its issues. `list_issues` accepts `labelIds` (match any), including `unlabeled`. Shared reports preserve the names present when shared.

Local verification can set `OVERLAYQA_API_BASE` and an isolated `OVERLAYQA_AUTH_FILE`; neither changes the default production endpoint or normal saved login.


## Issue management in 0.3.0

Requires the matching issue-parity API deployment. Existing scans and status updates remain compatible with 0.2.0.

| Tool | What it does |
| --- | --- |
| `get_issue` | Read description, ownership, labels, ignored state, screenshots, captured element/CSS, and viewport evidence. |
| `list_issues` | Filter by one or more statuses, severities or types; labels; assignee (`me`, `unassigned`, or user ID); creator; and active/finished/ignored state. Follow `hasMore` with the next `page`. |
| `list_project_members` | Find teammate user IDs for assignment and mentions in a readable project's workspace. |
| `create_issue` | Choose an assignee, use `null` for Unassigned, or omit to assign to yourself. Default type is General. |
| `update_issue` | Change any supplied title, description, severity, type, status, assignee or ignored flag. Omitted fields remain unchanged. Ignoring never resolves an issue. Setting verified records a status; it does not run a scan. |
| `move_issue` | Move by stable issue UUID into another writable project in the same workspace; retain comments and evidence. Read the returned display ID afterward. |
| `list_comments` | Read the discussion, audience, mentions and attachment metadata. |
| `create_comment` | Post with explicit `internal` (Team only) or `public` (Team and clients) audience, mentions, and optional PNG/JPG/PDF files. |
| `update_comment` / `delete_comment` | Edit or delete your own native comments. Edits preserve audience and files. |
| `get_comment_attachment` | Read a native comment file as filename and base64 bytes under the issue's access rules. |

For mentions, use `@[userId]` in the text and include the same ID in `mentionedUserIds`. Comment creation requires a UUID `requestId`: reuse it when retrying that same submission after a lost response, so a retry does not post twice. Attachments are base64 bytes with filename and MIME type, up to ten PNG/JPG/PDF files and 10 MiB total per comment.

`list_issues` defaults to all states for compatibility. Use `state: "active"` for open/in-progress issues that are not ignored. `finished` includes resolved/verified/closed issues that are not ignored; `ignored` selects the independent ignore flag. All supplied filters intersect. Pages start at 1 and contain up to 100 issues; an empty filtered page is not a complete-project result unless `hasMore` is false.

The label tools listed above are included in this release. Saved designs, client links, scheduled reviews and Figma visual comparison remain outside this issue-management release.

### Verify before release

Run `npm test` and `npm run build`. The live journey drives the built client over the real stdio protocol against a local API or production using designated fixture accounts; it creates and removes its own projects and produces JSON and HTML evidence.

```
MCP_PARITY_API=http://127.0.0.1:3241 MCP_SERVER_ENV=/path/to/server/.env npm run test:issues-live
MCP_PARITY_API=https://api.overlayqa.com npm run test:issues-live
```

Release order: deploy and verify the server endpoints, then publish npm 0.3.0 and update the MCP registry. A local build or version bump is not a publication.
