# Editor callback status verification

The local callback used a hardcoded clock in both outcomes and a second icon for success. The candidate uses one check for Connected, an alert for failure, consistent spacing, stronger next-step text contrast, and narrow-window margins. Authentication, exchange and credential storage behavior are unchanged.

Actual browser evidence: [local](reports/local/index.html), [production services](reports/production/index.html), [base 2aee238 control](reports/control/index.html). Control pass means the old page reproduced successfully; its clock is visible in both outcome frames. Candidate source SHA-256 hashes and per-step timestamps are recorded in results.json. The candidate was built on the laptop and Mac mini; npm build and the existing 7-test suite passed on the laptop.

Runs used Emilys-Mac-mini.local under OverlayQA rig leases. Local account harness-journey+clerk_test@overlayqa.com and production account testsprite@overlayqa.com were both verified owners through the actual members API. Success followed the real dashboard authorization page through token exchange, actual callback HTML, credential persistence and a second authenticate call, then an authenticated projects request returning 200. Failure used a genuinely invalid authorization code against each API. Both outcomes were inspected at 1440px and 320px viewport widths.

The driver depends on the OverlayQA monorepo's Playwright and tsx plus designated credential helpers. After `npm run build`, run from that monorepo under a rig lease:

```sh
OQ_MONOREPO_ROOT=/path/to/OverlayQA \
OQ_API_ORIGIN=https://api.overlayqa.com \
OQ_DASHBOARD_ORIGIN=https://app.overlayqa.com \
pnpm --filter @overlayqa/dashboard exec tsx /path/to/mcp/verification/verify-connection-status.mjs
```

For local verification point the two origins to running local services. For the original control, set OQ_CLIENT_ROOT to a separately built checkout of 2aee238 and add --control.

Substitutions: OS browser launch delivered to Playwright instead of opening a personal browser; home-directory lookup redirected to a temporary directory while retaining the real credential writer; local token-exchange URL pointed to the local API. No page markup, auth response or API result is mocked. Test credentials are excluded from evidence. No npm publishing or installed-editor launch was verified. This branch needs a separate authorized npm release; no dashboard/server release is required for the clock fix itself.

## Stroke and load-animation refinement — 2026-09-24

The status circle now has a 1px outline using the existing success/error border colors (`#bbf7d0` / `#fecaca`), two palette steps darker than the respective 50-shade fills. The success check gently fades and scales from 60% to full size on load over 360ms. Reduced-motion settings show the complete mark immediately; failure icons remain static.

New actual-callback evidence: [local](reports/stroke-motion-local/index.html), [production](reports/stroke-motion-production/index.html). Browser frame samples observe the real CSS animation from opacity 0 / scale .6 to opacity 1 / scale 1, and verify no animation in reduced-motion mode. Desktop and narrow-window frames were inspected. Accounts and host are recorded per run; auth persistence and the subsequent projects request remain verified. `npm run build` passed. The before-change build 94b496b deliberately fails the new 1px-border assertion with `0px`: [regression control](reports/stroke-motion-control/index.html).

This refinement is not published. Installed-editor launch and npm distribution remain outside the substituted browser-launch check described above.
