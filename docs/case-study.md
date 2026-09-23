# Case study: making longitudinal bloodwork review trustworthy

## Problem

Laboratory history arrives as separate reports. A trend view is useful only if it preserves collection dates, marker identity, units, and report-specific context. A visually smooth chart can otherwise hide missing measurements or join observations that should not be compared.

## Constraints and contribution

The project is a private, self-hosted tracker built with React, Express, and SQLite. The aim was an understandable application a reviewer can run locally, without a paid API or access to patient records. Keeping the existing stack and populated-database compatibility mattered more than adding SaaS infrastructure.

The author designed the idea, architecture, and detailed behavior. AI helped implement the application and prepare data from PDFs in the original private workflow. AI also assisted with this publication preparation, tests, documentation, and the generalized import skill. This is not a claim of unaided implementation, individual authorship of every line, or clinical validation. No business metrics or user outcomes have been established for this case study.

## Decisions

**Put authorization at the account boundary.** The original API scoped records by profile but let every signed-in account select any profile. Profile separation was therefore not account authorization. Profiles now have an owner; API guards check that owner before reads, writes, chat access, or catalog cloning. SQL still checks child-resource/profile consistency, and SQLite triggers reject mismatched record/marker profiles. Administrators remain explicitly privileged. Existing profiles with unknown ownership remain administrator-only instead of guessing who owns medical data.

**Preserve reported measurements rather than infer equivalence.** The original marker-level unit could not describe a changed unit over time. Records now retain their own unit, lab, method, reference text, and entered value spelling. Finite numeric values drive chart coordinates; exact stored values drive labels, copying, and tables. Lines stop across missing results or changed metadata, and unknown comparison metadata gives points only. This intentionally sacrifices visual continuity. Matching metadata still does not establish clinical equivalence; automatic normalization and diagnosis are outside the feature.

**Make imports reviewable and atomic.** Startup no longer searches a private workbook path. A dry-run opens an existing database read-only. Applying an import creates a SQLite backup, rechecks conflicts inside an immediate transaction, and adds only new observations. Repeating a manifest reports identical records; a later conflict prevents the entire batch. A new marker and its first manually entered result also share one transaction. The agent skill prepares reviewed observations and calls the same importer, avoiding two drifting data-write implementations.

## Verification

Node regression tests use temporary synthetic databases to exercise invalid/leap dates, numeric spelling, incompatible units, duplicate imports, conflict rollback, historical-schema migration, resource authorization, and AI request boundaries. A test provider captures the outgoing request and proves that selected markers/date limits come from the database, that arbitrary client observations are ignored, and that another account cannot poll the result. No paid AI request is needed.

Chromium tests run the real UI against a newly seeded database, import an additional synthetic date, select markers, compare chart/table values, add a result, reload it, reject a duplicate, exercise keyboard dialogs, inspect empty states, and check mobile width. A failed mobile test exposed absolutely positioned screen-reader text escaping a table scroll region; giving that region a positioning context fixed the cause.

See [the validation record](verification.md) for exact completed checks and remaining limits. Passing these checks does not imply medical accuracy or deployment readiness.

## Outcome and next improvement

The result is a runnable tracking application with invented demo data, a documented architecture, and repeatable tests. Real health records and paid API credentials are not needed to evaluate the core workflow.

The next substantial improvement would be explicit provenance and review UI for imported observations: show the source/page, review status, and conflicting measurements before proposing a correction. The manifest already preserves source metadata, but the application does not yet offer that review experience. A clinical equivalence/conversion engine or a SaaS rollout would need a separate design and validation effort.
