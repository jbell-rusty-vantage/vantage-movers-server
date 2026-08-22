# Contradictions

Standing list. When code, a Service doc, `CONTEXT.md`, an ADR, and the Granot FINAL SPEC disagree, **stop and record**. Do not silently merge.

Format:

```markdown
## <id> | open|closed | <utc>
- sources:
- conflict:
- action: leave|flag-domain-modeling|sentence-fix-in-doc
```

## Open

## public-v1-referral-cancel-vs-gated-release | open | 2026-08-21T2352Z
- sources: `src/services/cancellations/cancellationResolver.ts` (`getBookedLeadForCancellation` 409 on `is_referral_booking`); `docs/knowledge/services/cancelled-lead.md`; gated `createCancellation` in Release owner commands / `releaseOwnerCommands.replica.test.ts`
- conflict: Public `POST /api/v1/cancelled-leads` blocks Referral Bookings. Gated Granot Release `createCancellation` can cancel a referral without a Lead mirror. Checked-in Release flags stay false. The old `business-logic.mdc` / `owner-lead-workflow.mdc` sentences said referral cancel is universally blocked.
- action: leave — public path stays documented in `cancelled-lead.md`. Do not merge the gated path into the public invariant. Deepen at Release Service if flags turn on.
- g-bookings (2026-08-22T0254Z): Public cancel of leadless is allowed only when Best Relocation import sets `allowLeadless`. That is not the gated Release path. Referral public cancel remains 409. Referral/leadless **delete** is allowed on `deleteBookedLead`.

## ops-registry-authoritative-plan-absent | open | 2026-08-21T0220Z
- sources: `docs/knowledge/services/operations-registry.md` header `Authoritative plan`; expected `docs/current_plans/01-operations-registry-specification.md`
- conflict: The Service still links that plan. The file is not in this checkout (same as before the move). Relative link was rewritten for the new depth only.
- action: leave — do not invent a copy.
- opt-f (2026-08-22T0154Z): GitHub MCP + `gh repo list jbell-rusty-vantage` show only three public repos: `vantage-movers-server`, `vantage-admin`, `vantage-movers-clients`. `docs/current_plans/` is absent on `docs/okf-optimization` and `main`. No canonical GitHub path to record.

## adr-skipped-absent | open | 2026-08-21T0217Z
- sources: `../docs/adr/0001-mongodb-system-of-record.md`, `../docs/adr/0002-granot-crm-post-despite-downstream-failures.md`, `../docs/adr/0003-lead-id-granot-leadno-ref-no-contract.md`; this standalone `vantage-main-server` checkout
- conflict: Conversion Pass 1 could not stamp those three ADRs. They are not present here (`optional_checkout`). Optimization unit `opt-f` must not invent copies. Record a GitHub path if MCP finds them in another Vantage repo.
- action: leave — do not invent copies. Stamp only if a later checkout includes `../docs/adr/`. Index lists the workspace paths.
- opt-f (2026-08-22T0154Z): The three public Vantage repos do not contain `docs/adr/0001`–`0003` or a workspace-root `CONTEXT.md`. `vantage-admin/CONTEXT.md` and `vantage-movers-clients/CONTEXT.md` are repo-local and also point at `../CONTEXT.md`. Parent paths are absent on this VM. No canonical GitHub path to record.

## Closed

none
