# Validation record

This record separates synthetic test evidence from the later private Docker deployment. It is not a medical validation study.

## Reviewed PDF import release — 2026-10-08

**Local checks passed:** an allowlisted source export with no Git history or runtime data completed `npm ci`, `npm run demo`, all **24 Node regression tests**, and a production build on Node 22. The working checkout's Chromium suite passed **4 workflow tests** (plus one intentionally skipped screenshot test). The new API tests use a wholly synthetic PDF and a stubbed OpenAI response. They cover consent, profile isolation, oversized/invalid documents, provider failures, missing dates, exact-preview matching, conflict rollback, backup creation, preserved numeric spelling, and duplicate reimport. The mobile browser test covers disclosure and the missing-key path. `npm audit` and `npm audit --omit=dev` reported zero known advisories after a compatible lockfile update.

**Live deployment verified:** on the Docker server, an online SQLite backup passed integrity and foreign-key checks. The new image migrated a copy twice without changing user, profile, or result counts; legacy profiles remained unowned. A final offline backup was taken before cutover. The deployed container became healthy, and post-cutover counts still matched with `quick_check=ok` and zero foreign-key errors. Public HTTPS returned 200 for health, 401 for unauthenticated data/PDF-job routes, and the expected HSTS, no-index, and no-store headers. The production Compose file trusts only the observed Docker gateway and no longer passes self-hosted AI settings. Private database counts and contents are not published.

**Live provider smoke:** after cutover, an operator key became available in the protected key file. The deployed extractor sent one wholly synthetic, in-memory PDF to OpenAI and returned the two invented markers with their exact values, units, laboratory, and collection date rather than the later issue date. The first identical probe returned a generic provider error; a repeat succeeded without a code change. Neither probe wrote to the live database.

**Not yet verified:** an authenticated production PDF review/import was not performed. OCR accuracy on varied real-world reports is unmeasured. The automated tests prove the review/write boundary with synthetic data, not the clinical correctness of model transcriptions. The new GitHub Actions run and any social announcement are tracked separately from this local and deployment proof.

**Resolved during this release:** the first local API run used Node 26 against a Node 22 SQLite binary; a clean Node 22 install passed. Browser checks exposed a PDF dialog that stayed visible when its whole component was unmounted and a manual-result dialog whose default date could initialize after user input. Keeping the PDF component mounted while toggling the native dialog and initializing the result form before paint fixed these cases. The prior lockfile's `proxy-addr` had a critical IP-spoofing advisory relevant to trusted-proxy configuration; the final image includes version 2.0.8. The main bundle still emits Vite's non-fatal size warning.

## Passed locally — 2026-09-22

Environment: macOS arm64, Node **22.23.2**, npm, and Chromium. A clean allowlisted source export was created outside the working repository, without Git history, configuration, dependencies, or a database. `npm ci`, `cp .env.example .env`, and `npm run demo` succeeded there. All observations and test accounts were synthetic.

| Check | Evidence |
| --- | --- |
| `npm run check` in the clean export | **22 tests passed**, production build passed, server/shared syntax checks passed. |
| `npm run test:browser` in the clean export | **3 workflow tests passed**; the opt-in screenshot test was intentionally skipped. Real API/database; provider calls absent. |
| Development quick start | Login, add a result, and reload through Vite preserved `1.23450`; no browser errors. |
| Development-origin regression | Real Vite proxy and API accept same-origin login/writes and reject a foreign origin with HTTP 403. |
| Import CLI and packaged skill adapter | Preview added no database bytes or backups. Apply added two observations; its backup passed SQLite integrity/foreign-key checks and matched every original schema object and row. Reimport reported zero additions and two identical results. The browser fixture imports through the skill wrapper. |
| Data preservation | Demo refused an existing database. Personal setup created one administrator and refused to replace credentials on a second run. Synthetic legacy migrations preserved observations and unrelated tables. |
| Dates | Result/import tests also passed with `TZ=America/Los_Angeles` and `TZ=Asia/Kolkata`. |
| Authorization and AI boundaries | Cross-account profile-ID substitution, mismatched child IDs, catalog cloning, saved chats and job polling are denied. Stubbed provider tests verify server-selected context, consent, failure preservation, and session handling. |
| UI and accessibility | Keyboard entry/calendars, Escape/focus return, exact chart/table values, marker/date selection, duplicate errors, reload persistence, empty states and missing-key disclosure passed. At 390px, no page overflow and the first result/unit are visible and editable. |
| Dependencies | `npm audit` reported **0 vulnerabilities**, including development dependencies, at the validation date. License metadata and bundled assets were reviewed; notices are included. |
| Source and documentation | `git diff --check`, relative documentation links, source allowlist review, and synthetic image metadata checks passed. |

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

- The September checks did not use a live service. The separate October release section above records the later deployment verification.
- The September checks used only simulated provider responses. The separate October release section records one successful live synthetic extraction; browser tests still cover the missing-key path.
- Chromium covers the recorded desktop/mobile workflow. Safari, Firefox, a screen-reader session, hostile workbook fuzzing, and load testing are not claimed.
- Optional Docker packaging requires separate verification on its target runtime.
