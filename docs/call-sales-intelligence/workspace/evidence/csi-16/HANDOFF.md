# CSI-16 handoff

Team F certification packet produced on local main. This is an honest evidence packet, **not an all-green production certification**. CSI-15 implementation remains landed; no backfill/retention/budget reimplementation or Teams B–E fixture changes.

- G2: local operational loop has fresh replica/HTTP/browser evidence; no production claim.
- G3: fresh real SDK + local HTTP MCP/fake-model application and Owner intervention proof; no paid model/STT quality claim.
- G4: fresh resilience checks largely pass, but media Retry-After has one failing leaf plus parent; exact owning issue F-01 remains open.
- G5: execution matrix and browser artifacts produced with partial/not-run/capability-blocked portions stated. Not every full scenario is certified. Generic conversation replay-label integration F-02 remains failed.
- G6: all eight current production rows explicitly not probed; historical grants/denial/configuration/Git SHAs do not substitute.

[CHECKS](CHECKS.md) records exact results; [ACCEPTANCE](../../ACCEPTANCE.md) is the executed matrix; [GAPS](GAPS.md) files owners and reproduction; [G6](G6.md) is the capability list; [SOURCES](SOURCES.md) fingerprints prior proof; [REVIEW](REVIEW.md) distinguishes independent review and checkpoint results. Server full typecheck remains blocked only by the preserved concurrent probe; scoped current-code check and Admin checks are separate.

Preserved dirty files: server package.json/external MCP probe and MCP api/registration formatting. No .env writes, production flags, production migration, provider recording fetch, subscription action, paid STT/Gateway, live send, or fleet backfill. Named production subjects were not copied into preview or given invented Number Activity/attachments/Play.

The Owner's full rollout decision is preserved. Next operational work is [AFTER-16](../../AFTER-16.md), one slice per session; D+E together is the full cutover, not work executed here. Existing CSI-10 empty-recording repair and CSI-14 fuller dialogs remain explicit limits. Fleet backfill requires a day range. EXACT_EVIDENCE_VERIFICATION remains false. Review the packet and exact gaps before enabling; do not relabel failed checks green by prose.

Commit/push and final checkpoint outcome will be recorded in the closing ledger/checks entry. Stop after this packet; do not start AFTER-16 automatically.

Composer first review additionally found source-confirmed pending-recording retry delay drift, filed as F-07 (CSI-11/CSI-01). It is not hidden by the passing 404 fixture, which forces the job due. No runtime correction was applied.
