# AGENTS.md

## Project purpose

Bloodwork Local is a private, self-hosted health-data dashboard. It stores multiple isolated profiles, normalized laboratory results, life events, and saved AI conversations in SQLite. Treat all application data as sensitive medical information.

## Architecture

- `src/`: React 18 frontend built with Vite and Tailwind CSS v4.
- `src/components/ui/`: shared low-level UI primitives, including the calendar and popover.
- `server/index.mjs`: Express API, authentication, provider integrations, and security headers.
- `server/db.mjs`: SQLite schema creation, idempotent migrations and database paths.
- `server/import.mjs`: shared non-destructive workbook/manifest import.
- `shared/results.js`: date/value and comparison invariants.
- `shared/ai.js`: provider configuration, approved model lists, marker limit, and default system prompt shared by client and server.
- `public/`: static files copied by Vite, including the favicon and `robots.txt`.
- `data/`: runtime SQLite database and server-managed secrets. This directory is private, mounted into Docker, and ignored by Git.
- `compose.yaml`: optional loopback-bound local container configuration.
- `skills/bloodwork-profile-import/`: distributable import workflow; never edit the operator's installed skill as a side effect.

## Privacy and security invariants

- Never commit `.env`, SQLite files, API keys, password files, medical exports, or runtime data.
- Do not read or print secrets unless the task explicitly requires using a secret value. Prefer checking whether configuration exists.
- Authorize profile ownership before every API data operation. Members access owned profiles; administrators can access all profiles. Never infer ownership for migrated profiles.
- Keep profile isolation enforced in SQL queries and mutations. Every marker, record, life event, and saved AI chat must be scoped to its `profile_id`.
- Keep authentication and unsafe API mutations server-side. Preserve same-origin validation, HTTP-only session cookies, login throttling, and existing security headers.
- Keep public self-registration disabled. Only an authenticated administrator may create users, and password hashes must remain server-side.
- Never return saved provider keys to the browser. OpenAI keys entered in settings must remain server-side, use restrictive file permissions, and require HTTPS except on localhost.
- Preserve all anti-indexing layers: `robots.txt`, HTML robot directives, and the `X-Robots-Tag` response header.
- Do not weaken the Content Security Policy or expose the app directly to the public internet without authentication.

## AI data-scope invariants

- Provider and model identifiers must be validated against the server-approved lists in `shared/ai.js`.
- Build health-data context on the server from database records. Do not trust client-supplied observations or life-event contents.
- AI requests must contain only the active profile, explicitly selected markers, and observations inside the inclusive chart timeframe.
- Include only life events overlapping that timeframe. Include their notes and substances when present.
- Keep the non-editable medical-safety and scope guardrails appended by the server.
- Treat life events as temporal context, never proof of causation.
- Do not add an application-side output-token cap unless the user explicitly requests one.
- Direct OpenAI requests use the Responses API with response storage disabled.
- AI is optional BYOK only. Do not reintroduce a self-hosted or hardcoded private provider endpoint. Require transfer consent; bind async jobs to the requesting user and profile.

## Database changes

- Make schema changes through `createSchema()` in `server/db.mjs`.
- Migrations must be idempotent and safe for an existing populated database.
- Never reset, reseed, delete, or overwrite the real database during routine development or verification.
- Demo seeding must refuse an existing database. Import preview is read-only; apply backs up and adds records transactionally, refusing conflicts.
- Preserve original result spelling, per-record units, methods, and report-specific reference text. Do not connect incompatible or missing observations in the chart.
- Use a temporary database under `/tmp` for migration or API tests.
- Keep database and workbook data out of Docker image layers; runtime data belongs in the mounted `data` volume.

## Frontend conventions

- Reuse existing Tailwind/HyperUI visual language and primitives before introducing another component library.
- Use the shared shadcn-style calendar fields for all date and date-range inputs.
- Keep layouts responsive and keyboard accessible. Dialog controls require accessible labels and visible focus behavior.
- Chart timeframe is shared application state. Any AI scope display and request payload must reflect the exact visible chart range.
- Saved-chat, provider, and profile changes must not leak state across profiles.

## Editing workflow

- Preserve unrelated user changes in the working tree.
- Use `apply_patch` for source edits.
- Update `.env.example`, Compose configuration, and `README.md` when adding runtime configuration.
- Do not deploy, restart production, modify DNS, or change the live database unless the user explicitly requests it.

## Verification

Run the smallest relevant checks, then the full build for frontend or cross-stack changes:

```bash
npm run check
npm run test:browser
node --check server/index.mjs
node --check server/db.mjs
node --check shared/ai.js
git diff --check
```

For API or migration tests:

- Use a temporary SQLite path and synthetic credentials. The tests create their own databases and never load the real `.env` in the server.
- Never use a real provider key for a smoke test.
- Provider tests preload a test-only fetch stub. Never use a real API key, enable a custom production endpoint, or send medical data as part of a smoke test.
- Remove temporary credentials and medical-data copies after testing.

## Commit hygiene

- Review `git status` and `git diff --check` before committing.
- Confirm ignored secrets and runtime files are not staged.
- Use concise conventional commit messages describing the user-visible change.
