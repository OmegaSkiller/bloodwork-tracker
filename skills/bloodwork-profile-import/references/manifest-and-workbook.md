# Observation manifest

Use UTF-8 JSON with a `profile.name` and `entries` array. [The synthetic example](../../../demo/import-example.json) can be imported into the seeded demo. Every value in it was invented from scratch.

Each entry requires `category`, `marker`, `date` (real `YYYY-MM-DD`), `value` (number or string), and `unit` (empty when genuinely unspecified). Optional fields: `lab`, `method`, `reference`, `notes`. Decimal strings retain reported precision: `"1.2300"`. Use a decimal point, not a comma. Scientific notation is accepted within finite, 15-significant-digit limits. Qualitative or limit values such as `"Negative"` and `"<0.1"` stay text and are not plotted. Do not include entries for blank cells.

Optional `sources` contains `current_file` (unique label), `status`, `date`, `lab`, and `sha256`. An entry referring to `source_file` must match a `Complete` source with the same date and lab. Add `page`, `marker_raw`, and `value_raw` to retain extraction provenance in the database. Duplicate sources can remain in the private manifest as `Exact duplicate` or `Incomplete duplicate`, but cannot supply observations. Hashes and filenames are sensitive metadata, not anonymization.

No automatic conversions are supported. A nonempty `conversions` array is rejected; submit original values and original units. The chart breaks lines across unit, lab, method, reference-range changes, or missing observations. Matching metadata still does not prove medical comparability.

Optional workbook review format:

- One category sheet per category, with `Marker`, `Unit`, and ISO or typed date columns in a header row among the first 12 rows.
- Optional `Sources` sheet has `Date` and `Lab` columns. Multiple labs on the same day require the manifest format.
- Use values only; formulas, spreadsheet errors, invalid dates and unrecognized category sheets are rejected by workbook import.
- The wide workbook format cannot represent per-date units, methods, ranges or provenance. Prefer the manifest for those fields. Do not flatten mixed metadata just to fit a spreadsheet.
- A workbook is an optional review artifact, not a mandatory dependency or an automated extraction result. If requested, render and verify every sheet before import.
