# CLCP-04 — Knowledge and BILA pointer

> **Contract maturity: implementation-ready.** Last required issue.
> Rewrite Services so they describe shipped CLCP-01–03. No live-cluster
> apply. No new glossary terms.

## 1. Authority and required reading

- **Pack specification:** [`../call-lead-contact-provenance-specification.md`](../call-lead-contact-provenance-specification.md)
  — §7, §11, §12.7–12.9.
- **docs-keeper:** `.cursor/agents/docs-keeper.md` (preferred).
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Index:** [`../../index.md`](../../index.md) (pack row already added
  at authoring; verify it still matches).

## 2. Objective

Knowledge files match repository state after CLCP-01–03. BILA §2 gets a
pointer that Call live fields are no longer “the enrichment.” Spec hub
links this pack. Do not copy this specification into Service bodies.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Prerequisites:** CLCP-02 and CLCP-03 `complete`.
- Invoke docs-keeper when more than one Service or glob rule may be
  stale.

## 4. Current-state evidence to verify

Reverify after CLCP-01–03. At pack authoring these sentences are stale
once those issues ship:

- `desired-state.md` — “Granot-created and RingCentral-created qualified
  contact become current operational fields”
- `identity.md` — “Job and phone pointing at different eligible Leads
  are `conflict`” (Call, after unique Job)
- `call-lead.md` — enrichment still described as filling live contact
- `enrichment.md` — sync still lists name/email as live writes
- `processor.md` — may omit “synchronize does not overwrite operational
  phone”
- `lead-browse.md` — Call browse stays live-only (do **not** claim
  any-known-contact)
- BILA spec §2 — “Live fields already are the enrichment”
- `spec-hub.md` — no link to this pack (authoring may already add one)

`docs/index.md` Delivery packs / Reference rows were added with this
pack. Confirm they still exist.

## 5. Locked decisions and invariants at risk

- Link glossary terms; do not redefine.
- Do not mark `human: verified`.
- Do not un-defer CLCP-05 in the Services. Say Call desk search stays
  live-only until that issue.
- Do not enable flags. Do not change `sourcePolicy.ts`.
- Do not rewrite FINAL SPEC.

## 6. Deliverables and exact contract

Update exactly the files in pack spec §11. One pointer paragraph in
BILA §2 is enough — do not reopen BILA-01–03.

## 7. Out of scope

Runtime code. CLCP-05 Admin UI. Live Registry rows. New Service files
unless docs-keeper requires a stub pointer.

## 8. Tests

```text
pnpm okf:query --type Service --tag call-lead
pnpm okf:query --type Service --tag granot-lifecycle
```

Index rows must match files on disk. No skipped query.

## 9. Knowledge updates after this issue ships

This issue **is** the knowledge update.

## 10. Acceptance criteria

- [ ] `desired-state.md` says Call/Granot-created qualified contact
      plans `granot_contact_snapshot` only
- [ ] `identity.md` says unique Call Job/link skips competing phone
- [ ] `call-lead.md` says operational phone is not Granot-upserted
- [ ] `enrichment.md` matches CLCP-03 (no live contact write)
- [ ] `processor.md` has one sentence on operational phone
- [ ] `lead-browse.md` does not claim Call snapshot search
- [ ] BILA §2 points here
- [ ] `spec-hub.md` links this pack
- [ ] `okf:query` lists the touched Services
- [ ] No runtime diff except comments if a source comment would lie

## 11. Commands

```text
cd vantage-main-server
pnpm okf:query --type Service --tag call-lead
pnpm okf:query --type Service --tag granot-lifecycle
```

## 12. Risks

- Rewriting BILA as if intake Call snapshot search shipped.
- Copying this pack’s full spec into a Service file.
- Claiming CLCP-05 is done.

## 13. Rollback

Revert the markdown files.

## 14. Handoff list for the completion report

- Files changed
- `okf:query` output (paths only)
- Confirmation no flags / no identity/planner rewrites
- Explicit “CLCP-05 still deferred”
