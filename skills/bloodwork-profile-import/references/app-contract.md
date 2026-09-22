# Bloodwork Local adapter

Run from the application root on Node 22 after `npm ci`. There are no machine-specific defaults. The database is selected by `BLOODWORK_DB_PATH` or `--db`; otherwise the app uses `data/bloodwork.sqlite`. Start the app first to apply its additive migrations. Create the target profile in the UI and obtain its ID from the authorized `/api/bootstrap` response.

```bash
node skills/bloodwork-profile-import/scripts/import_manifest.mjs \
  --app-root . --db ./data/bloodwork.sqlite \
  --profile-id 1 --profile-name 'Synthetic demo' \
  --manifest ./demo/import-example.json
# Review the dry-run, then repeat the command with --apply.
```

The equivalent app command is `npm run import -- --profile-id ID --profile-name NAME --manifest FILE`. The wrapper accepts `--app-root` and `--db`, removes them, and calls `server/import-cli.mjs` with the remaining arguments. It resolves the app's dependencies rather than requiring a separate installation. It refuses unknown projects that lack this adapter. Porting the workflow to another application requires its own supported import adapter.

Invariants:

- Members access only their owned profiles through the API; administrators access all profiles. The import CLI is an operator tool with direct local database privileges. It requires exact ID/name confirmation, not an API session.
- Marker identity is profile + category + case-insensitive marker name. One result per marker/date. The adapter refuses same-day conflicting observations; use distinct, meaningful marker labels for genuinely distinct tests.
- Each record stores original value spelling, numeric/text value, reported unit, lab, method, reference range, and optional source provenance. It never overwrites an existing result.
- A dry-run reports additions and identical rows; a conflict rejects the batch. Apply creates `data/backups/before-import-<random-id>.sqlite` beside the selected database and then rechecks/writes in one transaction.
- The database, backup, and provenance are sensitive. Keep them private. Workbook/source registration tables from older private tools are not required or modified by this adapter.
- There is no HTTP upload endpoint, PDF parser, OCR service, or automatic clinical normalization in the web app. The skill's reviewed preparation step is separate from the app's tracking and optional chat features.
