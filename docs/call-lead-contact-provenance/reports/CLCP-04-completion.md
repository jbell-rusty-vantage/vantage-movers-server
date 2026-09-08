# CLCP-04 completion

Closed 2026-09-04. Repo `vantage-main-server`, branch `call-lead-contact-provenance`. Admin `CONTEXT.md` pointer flipped on `vantage-admin` (`call-lead-contact-provenance`). Knowledge-only. No runtime code. No flag apply. No live-cluster apply.

## Behavior documented (matches shipped CLCP-01–03, CLCP-05)

- Planner: Call/Granot-created qualified contact plans `granot_contact_snapshot` only. Live phone/name/email and `ingested_contact_snapshot` are not planned.
- Identity: unique Call Job/link returns before the phone rung. Phone `$or` is still live + ingested only — not `granot_contact_snapshot`.
- Enrichment leftover CSV: Job-first preview; no live contact write; skip+warn; apply stays processor.
- Processor: matched Call synchronize does not overwrite operational phone.
- Desk Call `q`: any-known-contact (live + ingested + Granot). Headline stays Called. Identity still omits snapshot phone.
- Automatic intake suggestion stays Job else operational phone. No snapshot-phone auto-attach.

## Files changed

- `docs/knowledge/granot-lifecycle/desired-state.md`
- `docs/knowledge/granot-lifecycle/identity.md`
- `docs/knowledge/services/call-lead.md`
- `docs/knowledge/services/enrichment.md`
- `docs/knowledge/granot-lifecycle/processor.md`
- `docs/knowledge/services/lead-browse.md`
- `docs/knowledge/services/admin-search.md`
- `docs/knowledge/services/call-lead-search.md`
- `docs/knowledge/granot-lifecycle/projections.md`
- `docs/knowledge/granot-lifecycle/extension-apply.md`
- `docs/knowledge/granot-lifecycle/automation-apply.md`
- `docs/knowledge/granot-lifecycle/spec-hub.md` (already linked this pack; restamped)
- `docs/booking-intake-lead-attachment/booking-intake-lead-attachment-specification.md` — §2 one-line pointer
- `vantage-admin/CONTEXT.md` — Call Lead contact provenance marked shipped
- `docs/call-lead-contact-provenance/issues/CLCP-04.md` — §10 boxes
- `docs/call-lead-contact-provenance/PROGRESS.md` — close ledger
- this report

`docs/index.md` pack row already matched (five required issues; desk search required). Left unchanged.

## `okf:query` output (paths only)

`--type Service --tag call-lead`:

- `docs/knowledge/services/booked-call-lead-reconciliation.md`
- `docs/knowledge/services/call-lead-search.md`
- `docs/knowledge/services/call-lead.md`
- `docs/knowledge/services/enrichment.md`
- `docs/knowledge/services/lead-browse.md`
- `docs/knowledge/services/ringcentral-call-lead-qualification.md`

`--type Service --tag granot-lifecycle`:

- `docs/knowledge/granot-lifecycle/automation-apply.md`
- `docs/knowledge/granot-lifecycle/booking-reconciliation.md`
- `docs/knowledge/granot-lifecycle/capture.md`
- `docs/knowledge/granot-lifecycle/desired-state.md`
- `docs/knowledge/granot-lifecycle/drainer.md`
- `docs/knowledge/granot-lifecycle/extension-apply.md`
- `docs/knowledge/granot-lifecycle/identity.md`
- `docs/knowledge/granot-lifecycle/live-receipts.md`
- `docs/knowledge/granot-lifecycle/normalization.md`
- `docs/knowledge/granot-lifecycle/observability.md`
- `docs/knowledge/granot-lifecycle/processor.md`
- `docs/knowledge/granot-lifecycle/projections.md`
- `docs/knowledge/granot-lifecycle/release-reconciliation.md`
- `docs/knowledge/granot-lifecycle/revisions.md`
- `docs/knowledge/granot-lifecycle/source-policy.md`
- `docs/knowledge/services/granot-http-collector.md`

Index rows match files on disk. `admin-search.md` is tagged `search, admin` (not these two queries).

## Confirmation — no flags / no identity or planner rewrites

This issue did not edit:

- `src/services/granotLifecycle/leadDesiredState.ts`
- `src/services/granotLifecycle/identity.ts`
- `src/services/granotLifecycle/sourcePolicy.ts`
- `src/config/domain/granotLifecycle.ts`
- `.env` / effect flags

`priority_updated` / `booking_status_changed` still never mint (existing knowledge sentences left in place). FINAL SPEC untouched.

## Confirmation — desk search vs identity

Desk search docs (`lead-browse.md`, `admin-search.md`, `call-lead-search.md`, `projections.md`) say Call `q` is any-known-contact after CLCP-05. Headline stays Called.

Identity docs still omit Call snapshot phone (`findCallLeadsByScopedPhone` is live + ingested only). BILA §2 pointer does not claim automatic intake uses snapshot phone.

## Untouched on purpose

Runtime code. Flag apply. Live-cluster apply. New glossary terms. `human: verified`. BILA-01–03 reopen. Pack spec copied into Service bodies.
