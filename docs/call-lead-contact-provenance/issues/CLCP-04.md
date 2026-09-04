# CLCP-04 — Knowledge and BILA pointer

> **Contract maturity: implementation-ready.** Last required issue.
> Rewrite Services so they describe shipped CLCP-01–03 and CLCP-05. No
> live-cluster apply. No new glossary terms.

## 1. Authority and required reading

- **Pack specification:** [`../call-lead-contact-provenance-specification.md`](../call-lead-contact-provenance-specification.md)
  — §7, §11, §12.8–12.10.
- **docs-keeper:** `.cursor/agents/docs-keeper.md` (preferred).
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Index:** [`../../index.md`](../../index.md) (pack row already added
  at authoring; verify it still matches).

## 2. Objective

Knowledge files match repository state after CLCP-01–03 and CLCP-05.
BILA §2 gets a pointer that Call live fields are no longer “the
enrichment.” Spec hub links this pack. Do not copy this specification
into Service bodies.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Prerequisites:** CLCP-02, CLCP-03, and CLCP-05 `complete`.
- Invoke docs-keeper when more than one Service or glob rule may be
  stale.

## 4. Current-state evidence to verify

Reverify after CLCP-01–03 and CLCP-05. At pack authoring these sentences
are stale once those issues ship:

- `desired-state.md` — “Granot-created and RingCentral-created qualified
  contact become current operational fields”
- `identity.md` — “Job and phone pointing at different eligible Leads
  are `conflict`” (Call, after unique Job)
- `call-lead.md` — enrichment still described as filling live contact
- `enrichment.md` — after CLCP-03: leftover CSV does not write live
  contact; preview is Job-first; apply still processor. File still
  lists name/email as live writes.
- `extension-apply.md` / `automation-apply.md` — need one sentence:
  same snapshot contact rule as webhook synchronize
- `processor.md` — may omit “synchronize does not overwrite operational
  phone”
- `lead-browse.md` / `admin-search.md` / `call-lead-search.md` /
  `projections.md` — Call desk `q` is any-known-contact after CLCP-05
- BILA spec §2 — “Live fields already are the enrichment”
- `spec-hub.md` — no link to this pack (authoring may already add one)

`docs/index.md` Delivery packs / Reference rows were added with this
pack. Confirm they still exist.

## 5. Locked decisions and invariants at risk

- Link glossary terms; do not redefine.
- Do not mark `human: verified`.
- Do not claim processor identity searches Call snapshot phone.
  Desk search does.
- Do not enable flags. Do not change `sourcePolicy.ts`.
- Do not rewrite FINAL SPEC.

## 6. Deliverables and exact contract

Update exactly the files in pack spec §11 (including browse / search /
projections after CLCP-05, and one sentence on extension-apply /
automation-apply). One pointer paragraph in BILA §2 is enough — do not
reopen BILA-01–03. Also update Admin CONTEXT “Form Lead contact
snapshots” pointer so Call Leads are named.

## 7. Out of scope

Runtime code. Live Registry rows. New Service files unless docs-keeper
requires a stub pointer.

## 8. Tests

```text
pnpm okf:query --type Service --tag call-lead
pnpm okf:query --type Service --tag granot-lifecycle
```

Index rows must match files on disk. No skipped query.

## 9. Knowledge updates after this issue ships

This issue **is** the knowledge update.

## 10. Acceptance criteria

- [x] `desired-state.md` says Call/Granot-created qualified contact
      plans `granot_contact_snapshot` only
- [x] `identity.md` says unique Call Job/link skips competing phone
- [x] `call-lead.md` says operational phone is not Granot-upserted
- [x] `enrichment.md` matches CLCP-03 (no live contact write)
- [x] `processor.md` has one sentence on operational phone
- [x] `lead-browse.md` / `admin-search.md` / `call-lead-search.md` /
      `projections.md` say Call desk `q` is any-known-contact; identity
      still omits snapshot phone
- [x] BILA §2 points here
- [x] `spec-hub.md` links this pack
- [x] `okf:query` lists the touched Services
- [x] No runtime diff except comments if a source comment would lie

## 11. Commands

```text
cd vantage-main-server
pnpm okf:query --type Service --tag call-lead
pnpm okf:query --type Service --tag granot-lifecycle
```

## 12. Risks

- Rewriting BILA as if **automatic** intake uses snapshot phone.
- Copying this pack’s full spec into a Service file.
- Claiming processor identity searches Call snapshot phone.

## 13. Rollback

Revert the markdown files.

## 14. Handoff list for the completion report

- Files changed
- `okf:query` output (paths only)
- Confirmation no flags / no identity/planner rewrites
- Confirmation desk search docs match CLCP-05; identity docs still omit snapshot phone
