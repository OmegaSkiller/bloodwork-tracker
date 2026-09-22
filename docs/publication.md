# Public source preparation

The intended publication unit is this application directory alone. Do not publish the surrounding workspace, a filesystem backup, or the private Git history.

## Audit and history decision

At the preparation baseline, the repository was private. The remote advertised one branch and no tags. Local `main` and `origin/main` pointed to the same commit. Inspection covered all four reachable commits and 73 unique historical blobs, plus tracked/untracked/ignored working-tree inventories. Pattern scanning and source review found no committed credential values, private keys, reports, database files, or medical exports. Secret-pattern matches were example placeholders/paths and SQL expressions. No credential rotation was identified as necessary from that evidence.

Historical versions do contain personal defaults, private infrastructure addresses, and identifying commit metadata. Ignored local configuration/runtime data and real medical artifacts in the surrounding workspace were identified and excluded; patient contents were not needed for this preparation. A text scan is not proof that every possible secret or identifying detail has been recognized. Review any future additions independently.

**Recommended history approach: create a new public repository from the sanitized allowlist export, with one reviewed initial commit.** Keep the current private repository as the original history. Removing identifiers at the tip or adding ignore rules does not sanitize old commits. A new repository avoids rewriting shared history, preserves the private provenance, and needs no force-push. Do not mirror branches/tags or push the old history into the new repository.

No commit, push, visibility change, force-push, history rewrite, or deployment is performed by the export command. Choose the public repository name and publication timing separately. Use a GitHub no-reply commit email if you do not want a personal email in the new history.

The public repository is now [OmegaSkiller/bloodwork-tracker](https://github.com/OmegaSkiller/bloodwork-tracker). Its initial commit contains the reviewed export with fresh history; the original private history was not copied. [Verification results](verification.md) include the completed GitHub Actions runs.

## Exact candidate contents

[scripts/public-files.json](../scripts/public-files.json) is the exact allowlist. It includes application source, build/runtime configuration with placeholders, package/lockfiles, tests and CI configuration, independently authored demo fixtures, the generalized import skill, documentation, license/notices, and two reviewed synthetic screenshots. There is no database, secret, patient report, extraction output, build output, or existing `.git` directory in it.

```bash
npm run release:export -- /tmp/bloodwork-public-candidate
```

The exporter refuses an existing destination or a symlink, copies only listed files, and adds `PUBLIC_CONTENTS.sha256`. It does not infer publication permission from a filename or scan; review the actual exported files, then run the README quick start and checks from that directory. Keep generated `.env`, `data/`, `node_modules/`, reports and build output ignored when making the initial commit. Re-export after any reviewed change; do not reuse an old candidate with stale hashes.

MIT was selected by the author. [Third-party notices](../THIRD_PARTY_NOTICES.md) preserve asset attribution and identify dependency licenses. The public docs describe author-confirmed contribution and AI assistance without unverified business or clinical claims.

Suggested repository description:

> Self-hosted bloodwork tracking with profile authorization, atomic imports, careful time-series comparisons, and a fully synthetic local demo.

Suggested topics: `bloodwork`, `self-hosted`, `react`, `nodejs`, `sqlite`, `data-visualization`, `privacy`, `playwright`.

## Portfolio summary and launch draft

Portfolio summary:

> I designed a self-hosted bloodwork tracker and used AI to help implement it, including a reviewed PDF-to-data workflow. Its engineering focus is preserving measurement context, enforcing profile ownership, and importing history without overwriting data. A synthetic demo and regression/browser tests make those decisions inspectable without exposing health records.

LinkedIn launch draft — review before posting:

> I've published Bloodwork Local, a self-hosted way to compare lab history while preserving dates, units, and report context.
>
> I designed the idea, architecture, and detailed behavior; AI helped bring it to life, including the original PDF import workflow. Preparing it for public review meant fixing profile authorization, making imports atomic, and stopping charts from joining incompatible measurements.
>
> The repository includes a synthetic demo, tests, and a short engineering case study. No patient data or paid API key is needed to try the core workflow.
>
> I'm looking for a remote full-time engineering role where careful implementation and product judgment matter. Code and case study: https://github.com/OmegaSkiller/bloodwork-tracker.

Interview talking points:

1. **Profile filtering versus authorization:** reproduce the old profile-ID substitution problem, explain owner checks plus SQL/trigger constraints, and discuss why migrated unknown owners remain administrator-only.
2. **Honest comparisons:** explain raw spelling versus numeric coordinates, observation-level metadata, missing values, and why chart segments break instead of suggesting equivalence or silently converting units.
3. **Safe assisted import:** trace source review → manifest → read-only plan → backup → atomic apply, including duplicate/conflict behavior and why the skill delegates to the app's importer.

Publication of source is not deployment of a service. The private production installation and its database are outside this preparation.
