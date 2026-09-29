# MCP 0.3.0 release preparation

Candidate implementation `a93b17d`, harness correction `108e210`. The package preview in `pack.json` was produced by `npm pack --dry-run --json` after the build; it includes the new issue context, comment, move and existing label tools. No package was published.

On Emilys-Mac-mini.local, the actual built stdio client passed all seven grouped journeys against the local candidate API (`http://localhost:3241`, server `86b98d4b`, designated owner account). Client tests passed 10/10. Against `https://api.overlayqa.com` with testsprite@overlayqa.com owner, four groups passed and three failed at the undeployed server boundary on 2026-09-29T22:20:48Z–22:20:52Z: `get_issue` and `create_comment` returned Route not found; list lacked `hasMore`. Both production test projects were deleted.

Full timestamped JSON and HTML evidence is committed in the OverlayQA server repository at `docs/test-reports/2026-09-29-mcp-issue-parity/`. This is a source-local integration result, not a published-client certification. OAuth/editor UI, other live roles and the new deployed server endpoints remain unverified.

Deploy the server additions before publishing npm 0.3.0 and its matching MCP registry manifest. Then rerun `test/issue-parity-live.mjs` against production to verify the new server paths. Help-corpus claims should change when the client release is available.
