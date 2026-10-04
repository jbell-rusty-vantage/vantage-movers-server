# Lead ID as Granot leadno and ref_no when available

When CRM Posting runs for a non-duplicate Form Lead, the server sends the Lead ID (MongoDB `_id`) as `leadno` — a required field on the Granot posting endpoint — and Granot stores that value in the row's `ref_no` column. This is the preferred cross-system link: enrichment, admin search, and extension lookup treat a matching CRM Lead Reference as the highest-confidence match key.

Not every Granot row has Lead ID in `ref_no`. The owner migrated to this system over time, and CRM Posting was not always enabled for landing-page submissions — so older or manually created rows may lack it. Matching workflows must fall back to phone, email, or other keys when `ref_no` is missing or invalid. Tracking Reference (`?ref_no=` on the landing page) remains a separate attribution field and is not the CRM Lead Reference.

## Amendment (30 September 2026): what `leadno` carries today, and Job Page identity

**Status:** accepted as the current contract; the original decision above is superseded where it disagrees.

**What changed.** The running payload no longer sends the Mongo Lead ID. `buildCrmFormLeadPayload` (`vantage-main-server/src/services/crm/formLeadPayload.ts`) sends the Form Lead's **Tracking Reference** (`ref_no`, blank when the partner sent `not provided`) as `leadno`, and its tests pin that. The internal `lid` may appear in `notes` for operator context but is never a matching key. The glossary already says this: Granot's `ref_no` for a Form Lead is the **Granot Form Reference**, which today equals the Tracking Reference. A Mongo Lead ID found in `ref_no` on legacy or externally created rows is compatibility evidence, not the posting contract.

**Consequences.**

1. `ref_no` / Granot Form Reference is **not** the Lead ID and is not a highest-confidence Lead match key by itself. Matching must say which reference it compared (Tracking Reference vs a legacy Mongo ID) and keep falling back to reviewed keys.
2. Granot job identity is the **Job Number** (`job_no`, normalized with the existing prefix-equivalence helpers), bound to a Lead through the Lead's `normalized_job_no` or an active, reviewed **Granot Record Link**. Phone or e-mail equality never binds a job.
3. The Granot Case File Job Page adapter (sales rep tracker S5, `docs/sales-rep-tracker/IMPLEMENTATION-DESIGN.md` §6) reads the page's `Ref No` control (`ORDREF`) as an observed text field only. It never uses it to authorize a job, pick a Lead, or create or correct a Record Link. Its identity gate is: displayed Job Number (the `#dept` prefix plus digits) equivalent to the requested Job Number, and the requested Job Number equal to the Outreach Lead's `normalized_job_no` or an active Record Link for that Lead. A mismatch goes to Owner identity review and publishes nothing.
4. The `GranotRecordLink` active unique index is `(provider, normalized_job_no)` with **no account key**. Job Page evidence is keyed by `(dataset, configured account, resolved Job Number)`; until links carry an account, only the one configured Granot account may consume them. Enabling a second account needs a reviewed Record Link / Observation / Booking identity migration and a collision report first.
5. A pasted Granot URL is a locator hint, never identity: session-token links (`mpcharge~chargeswc~<session>`) carry no Job Number and are never fetched.

**Not changed.** CRM Posting behaviour, the Tracking Reference attribution field, lifecycle apply and the Record Link write paths are untouched by this amendment. It records the running contract so identity work stops relying on the superseded Lead-ID statement.
