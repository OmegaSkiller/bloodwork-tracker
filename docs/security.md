# Privacy and security boundaries

This is a private self-hosted tracker. Publishing its source is separate from running an internet-accessible service. Use synthetic data for evaluation.

## Accounts and profiles

- All data APIs require an authenticated session. Members access owned profiles; administrators can access every profile and manage member credentials. There is no public registration. Categories and profile-name uniqueness are shared, so this is not a tenant-isolated service.
- Ownership checks precede profile-scoped reads/mutations, saved chats, catalog cloning, and AI requests. Child IDs must also belong to the requested profile. AI jobs belong to the requesting account and profile; random IDs alone are not treated as authorization.
- Passwords use salted scrypt. Opaque session tokens are HTTP-only, SameSite Strict cookies; only token hashes are held in memory. Production mode uses Secure, host-only cookies and requires HTTPS. Sessions expire, and account deletion/password reset revokes them. Restarts sign everyone out.
- Five failed attempts per IP block login for 24 hours. Arbitrary forwarding headers are ignored unless the operator explicitly configures a trusted proxy. Unsafe API requests reject mismatched origins.

The previous version intentionally shared profiles across all accounts. The additive migration leaves old profiles with no owner, accessible only to administrators. No existing results are reassigned or deleted. Reintroducing sharing or transferring ownership needs an explicit operator decision. The database migration test covers preservation using a synthetic historical schema; it has not been run on a live database as part of this preparation.

## Data at rest and imports

SQLite, provider-key files, backups, manifests, source reports, and saved chats are sensitive. They are excluded from the public export and Docker context. New data directories/files use restrictive permissions; existing filesystem permissions are not silently changed. SQLite is not encrypted by the app. The operator controls OS access, disk encryption, backup protection, retention, and secure deletion.

Manual numeric input is finite and limited to 15 significant digits. Original entered spelling is retained; plotting uses floating-point numbers. Legacy numbers cannot recover precision already lost before migration. Qualitative/limit results remain text. No automatic unit conversions, reference-range classification, imputation, or medical risk scoring is performed.

The CLI is a trusted local operator tool and bypasses HTTP sessions by design. It requires both the target profile ID and exact name. Preview is read-only; apply creates a backup and then writes one transaction, rejecting conflicting observations. Restore requires stopping the app and restoring the chosen backup to an offline database destination; do not copy over a running WAL database. Backups have the same sensitivity as the source database.

There is no upload endpoint. Workbook parsing is for trusted local files, with input-size/dimension limits and rejection of formulas/errors; it is not a hardened sandbox for hostile archives. PDFs/images require a separate extraction workflow, source review, and permission for any external processor. The [import skill](../skills/bloodwork-profile-import/SKILL.md) does not silently send documents to a provider.

## Optional external AI

The self-hosted AI connection has been removed. OpenAI/OpenRouter are optional and require operator BYOK. Only administrators manage the shared OpenAI key; stored keys are never returned by the API. Every authorized user can incur costs using a configured operator key. Provider usage budgets should be set at the provider; the app has no billing or per-user quota system. One pending AI request per user limits accidental concurrent requests.

The server derives observation context from the authorized profile, selected markers, and inclusive date range. It includes units, labs, methods, reference text and notes, plus overlapping life-event notes/substances. Structured context omits the profile's display name and source filenames. User prompts, free text, and chat history may still identify a person or contain information outside that scope. The UI discloses this and requires transfer consent. Saved conversations remain in SQLite; prompts are not persisted in browser storage by this version.

OpenAI uses the Responses API with response storage disabled. That option is not a guarantee of zero logging/retention by the provider. OpenRouter forwards to another provider and may use fallbacks. Review the selected providers' policies before using real health data. Tests use a stubbed provider; availability, charges, retention, and medical output have not been live-validated.

Provider/model IDs are allowlisted, custom endpoints are not accepted, provider jobs are account-bound, and server-added instructions discourage diagnoses, treatment advice, causal claims, or invented observations. Those instructions cannot guarantee safe or accurate AI output. Tracking and visualization do not require AI.

## Limits before any public service

No organization/tenant model, audit trail for all user actions, MFA, password recovery flow, external security assessment, regulatory compliance claim, encrypted backup service, or load/availability guarantee exists. Sessions and job state live in one process; horizontal scaling is unsupported. The operator/admin can read all stored data. Anti-indexing directives and CSP are retained, but robots rules are not authentication. Do not deploy the public demo account or expose the Vite server.

Report suspected issues privately to the repository maintainer through available GitHub security reporting. Do not attach real reports, credentials, or patient identifiers to public issues.
