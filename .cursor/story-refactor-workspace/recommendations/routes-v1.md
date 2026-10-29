# routes-v1

- Status: recommended; refreshed 2026-10-29.
- Target: `src/routes/v1.routes.ts`
- Domain evidence: `docs/index.md`
- Current exported operations and constants: `buildGranotSyncExpectedFilter`.

## Current boundary

Preserve the current target’s authentication, inputs, outputs, ordering, errors, idempotency and side effects; retain existing public names as aliases until callers migrate. Structured logs are current: do not recreate Operational Events storage or notifications.

## Specific implementation checks from the original brief

2. **Ask a canonical command** — `handleCanonicalCreate` / `handleCanonicalUpdate` / `handleCanonicalDelete`: `connectMongo`, Zod parse, `existingWriteContextFromRequest({ req, command_name, payload, resource_id? })`, `runExisting*`, `201` / `200` / `204`. Call Lead ingest, Book This Lead, Book From Source, public Referral, Leadless, Cancellation, and the matching correct / remove paths use this **seam**. Persisted `command_name` strings stay `createFormLead` / `createCallLead` / `updateSourceOwnedLead` / `createBookingFromLead` / `createExistingReferralBooking` / `createLeadlessBooking` / `createCancellation` / `updateBookedLead` / `updateCancelledLead` / `delete*`. This beat does **not** connect inside the command. This beat does **not** call leftover `ingestFormLead`.

3. **Ingest a Form Lead over HTTP** — `POST /api/v1/form-leads` and `POST /api/v1/create-form-test` share `handleCreateFormLeadRequest`. Log received / body keys / sanitized preview, `connectMongo`, `createFormLeadSchema.parse`, `runExistingCreateFormLead`, log created (lead id, contact, sheet / CRM / messaging statuses), `201 { ok, data }`. The test path wraps the same beat in `withRuntimeDomainOverrides({ testMode: true, sheetSyncMode: "legacy" })`. Zod and leftover `AppError` warn; anything else errors. This beat is **not** `handleCanonicalCreate`. PATCH `/form-leads/:id` is a sibling correct: `updateFormLeadSchema` then `runExistingUpdateSourceOwnedLead({ lead_model: "FormLead" })` — also **not** `handleCanonicalUpdate`. GET `/form-leads/:id` **asks** already-recommended `findFormLeadForEnrichment` (Duplicate Lead is 404). `POST /form-leads/granot-match` **asks** leftover `resolveGranotFormLead` and must stay registered **before** `/:id`.

4. **Answer a leftover desk read or leftover non-command write** — browse / search / find-all / admin browse+export / compatibility analytics / registry / CPL / testimonials / Moving Carriers / Granot CSV / lead-messages / employee-booking options+submit+recon. Registry mutations **ask** `requireRegistryOwnerActor`. Sheet-contains and employee-booking recon **ask** `requireOwnerActor`. Employee submit is secret-only plus `x-public-client-key-hash` (64 hex). Customer POST/PATCH/DELETE still **ask** leftover `handleCreate` / `handleUpdate` / `handleDelete` + `v1.service` — not `runExisting*`. Catalog `GET /admin/catalog/agents` is registered **before** the browse loop so Express first-match cannot hide metrics. This beat is the leftover inline cluster, not a second owner product. Extract later by story.

1. **Form Lead ingest is a second create adapter.** Call Lead uses `askThisCanonicalCreate`. Form Lead copies connect / parse / context / 201 and adds logging plus the test-mode override. Shared beats: connect, parse, trusted bag, `runExistingCreate*`, 201. Only the log prefix and `withRuntimeDomainOverrides` differ. Do not silently shove Form Lead into `handleCanonicalCreate` so “one helper owns every ingest” — the structured logs and test-mode wrap are load-bearing. Extract the shared ask; keep the Form Lead parent deep.

3. **Customer writes never entered the command.** `POST/PATCH/DELETE /customers` still **ask** leftover `createCustomer` / `updateCustomer` / `deleteCustomer` through `handleCreate` / `handleUpdate` / `handleDelete`. Do not silently wrap them in `runExisting*` so “every public write is a command.” That is a later Domain Command pass. Lock leftover `handleCreate` on Customer.

4. **`handleCreate` / `handleUpdate` / `handleDelete` survived the command migration.** After Customer is the last leftover caller, they are pass-throughs. Do not delete them in the same rename until Customer is proven the only caller. Do not teach Moving Carrier create to use `handleCanonicalCreate` so “catalog is a command.”

5. **`buildGranotSyncExpectedFilter` is a leftover extract leak.** Sibling `extension-granot-apply.routes.ts` owns `PATCH .../granot-sync` and **does not import** this function. The folder test still asks fill-only `$in` / zero-zip / null receiver clauses. Do not silently move the filter onto the sibling so “one file owns Granot-sync,” and do not delete it until the test drops. Do not thread it into `runExistingUpdateSourceOwnedLead({ expected })` — already-recommended existing-writes called that a different unused preview **seam**.
