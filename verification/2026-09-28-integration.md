# Connection page integration — 2026-09-28

The editor callback now uses one state-specific icon: a check on success and an alert on failure. The success animation respects reduced motion.

Candidate `bde7ae5` combines the connection-page branch with MCP main `e7fbf22`. Fresh browser runs on Emilys-Mac-mini.local used the real authorize route, callback, token exchange, credential writer, credential reuse and projects API. Local harness owner and production testsprite owner each passed 13 checks. The same driver against main `e7fbf22` recorded six control checks per target, including the original clock icon and extra success icon. Screenshots were inspected. Build and seven unit tests passed locally and on the mini in this session.

- [Candidate with local services](reports/integration-local/index.html)
- [Candidate with production services](reports/integration-production/index.html)
- [Main control with local services](reports/integration-control-local/index.html)
- [Main control with production services](reports/integration-control-production/index.html)

Substitutions: OS browser launch delivered to Playwright; credentials saved into a temporary home; local token exchange origin redirected to the development API. No npm publication or installed-editor upgrade was performed. Other account roles and native editor launch remain unverified.
