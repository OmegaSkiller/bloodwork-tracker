# Validation record

This record concerns the public candidate and synthetic data. It does not describe a live deployment or a medical validation study.

## Passed locally — 2026-09-22

Environment: macOS arm64, Node **22.23.2**, npm, and Chromium. A clean allowlisted source export was created outside the working repository, without Git history, configuration, dependencies, or a database. `npm ci`, `cp .env.example .env`, and `npm run demo` succeeded there. All observations and test accounts were synthetic.

| Check | Evidence |
| --- | --- |
| `npm run check` in the clean export | **22 tests passed**, production build passed, server/shared syntax checks passed. |
| `npm run test:browser` in the clean export | **3 workflow tests passed**; the opt-in screenshot test was intentionally skipped. Real API/database; provider calls absent. |
| Development quick start | Login, add a result, and reload through Vite preserved `1.23450`; no browser errors. Used `PORT=18789 VITE_PORT=15173` because unrelated local services occupied the default ports. |
| Development-origin regression | Real Vite proxy and API accept same-origin login/writes and reject a foreign origin with HTTP 403. |
| Import CLI and packaged skill adapter | Preview added no database bytes or backups. Apply added two observations; its backup passed SQLite integrity/foreign-key checks and matched every original schema object and row. Reimport reported zero additions and two identical results. The browser fixture imports through the skill wrapper. |
| Data preservation | Demo refused an existing database. Personal setup created one administrator and refused to replace credentials on a second run. Synthetic legacy migrations preserved observations and unrelated tables. |
| Dates | Result/import tests also passed with `TZ=America/Los_Angeles` and `TZ=Asia/Kolkata`. |
| Authorization and AI boundaries | Cross-account profile-ID substitution, mismatched child IDs, catalog cloning, saved chats and job polling are denied. Stubbed provider tests verify server-selected context, consent, failure preservation, and session handling. |
| UI and accessibility | Keyboard entry/calendars, Escape/focus return, exact chart/table values, marker/date selection, duplicate errors, reload persistence, empty states and missing-key disclosure passed. At 390px, no page overflow and the first result/unit are visible and editable. |
| Dependencies | `npm audit` reported **0 vulnerabilities**, including development dependencies, at the validation date. License metadata and bundled assets were reviewed; notices are included. |
| Publication hygiene | `git diff --check`, relative documentation links, source allowlist review, and synthetic image metadata checks passed. The installed import skill's five files still match their preexisting archive. |

Screenshots are generated separately from a freshly seeded database using the README command and visually reviewed. They contain the invented demo plus its example import, with no patient-derived content.

## Resolved failures and remaining warnings

- The first development smoke failed the origin check: Vite's string proxy shorthand changed `Host`. An explicit proxy preserves the browser host; the API check remains enabled and now has an integration regression.
- Initial mobile checks exposed off-page screen-reader text and a cramped table. A positioned scroll region and narrower mobile columns resolved both; units remain visible beside values.
- An existing SQLite native module targeted another Node version. The documented Node 22 clean install worked; mixing native-module builds between Node versions remains unsupported.
- An early backup smoke used byte-for-byte equality, which SQLite's backup API does not promise. Verification now checks integrity, schema and all rows; read-only preview still checks unchanged database bytes.
- Build succeeds with Vite's non-fatal chunk-size warning: approximately **550 kB minified / 168 kB gzip** for the main JavaScript chunk. A future targeted split can improve initial loading. npm also reports an upstream `prebuild-install` deprecation warning.

## Passed on GitHub Actions — 2026-09-23 (Europe/Sofia)

The [initial public commit run](https://github.com/OmegaSkiller/bloodwork-tracker/actions/runs/35786978764) passed on `ubuntu-latest` with Node 22: clean installation, **22 regression tests**, production build and syntax checks, **3 Chromium workflow tests**, dependency audit, and whitespace checks. The screenshot-generation test was intentionally skipped. The production-dependency audit reported zero known vulnerabilities at run time.

The [workflow maintenance run](https://github.com/OmegaSkiller/bloodwork-tracker/actions/runs/35788369303) also passed after upgrading `actions/checkout` and `actions/setup-node` to v7. These actions use the supported Node 24 action runtime; the application remains tested on Node 22. See [workflow runs](https://github.com/OmegaSkiller/bloodwork-tracker/actions/workflows/ci.yml) for subsequent commits. CI success does not verify a deployment or clinical accuracy.

## Not run or not claimed

- No public/private service was deployed, restarted, or verified. The real database and operator's installed import skill were left unchanged.
- No live AI provider was called. API provider tests are simulated; the browser checks the missing-key path.
- Chromium covers the recorded desktop/mobile workflow. Safari, Firefox, a screen-reader session, hostile workbook fuzzing, and load testing are not claimed.
- Optional Docker packaging requires separate verification on its target runtime.
