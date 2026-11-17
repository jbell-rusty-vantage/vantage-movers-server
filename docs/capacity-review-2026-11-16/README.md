# Database scaling and write efficiency mission

November 16, 2026 New York. The original read-only review is preserved below. **Phase 1 implementation and release evidence is tracked in [PHASE-ONE-RELEASE.md](PHASE-ONE-RELEASE.md).** Later phases and sustained capacity qualification remain separate.

- [Specification and Owner decision memo](SPECIFICATION.md)
- [Ordered action and release plan](ACTION-PLAN.md)
- [All 127 collection configurations](COLLECTIONS.md)
- [Granot automation, false changes, retention and evidence compaction](GRANOT-RETENTION.md)
- [Outreach, Numbers and RingCentral review](OUTREACH-RINGCENTRAL.md)
- [Lead ingestion and Sheet Sync review](INGESTION-SHEETS.md)

Highest-priority result: the Call Lead projection omits `move_date`, producing false changes; the live window has 17,512 provenance-only Call updates across 502 Leads in two days. Fix this before changing audit semantics. The planner reproduction verifies the defect without connecting to a database. Next reduce duplicate Outreach work, use narrow terminal-job cleanup, and make retention reliable and faster than eligible intake.

## Evidence and validation

The Phase 1 release commits the planning Markdown, pure reproduction and bounded release evidence. The original large inventory JSON and planning collectors remain in the preserved workspace packet at `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/docs/capacity-review-2026-11-16/`; historical relative links to those raw artifacts refer to that local packet. They are not a production deletion manifest.

Raw aggregate evidence is under `evidence/`; credentials and customer payloads are excluded. `measure.mjs`, `atlas.mjs`, `probes.mjs` and `logic-probes.mjs` are read-only collectors. They use local environment files in-process; never print or commit those files. `summarize.mjs` and `build-evidence.mjs` derive local summaries and the register. Full backlog partitioning timed out at its bound and is explicitly unqualified; do not use the sample/counts as a deletion manifest.

The pure planner reproduction and JavaScript syntax checks passed. No production mutation or runtime regression/load suite was performed. The next implementation must exercise the specified isolated-replica tests before release.

Two independent scoped reviewers checked the final specification/action plan. Incorporated corrections: equal-date suppression must preserve genuine linking/other changes/sibling repair; command-time empty differences must still accept fresh evidence; terminal cleanup must positively allow known results; pausing future stamps does not stop TTL on already-stamped records. They also verified historical-cutoff separation, after-expiry closure compatibility, overlap of savings estimates and bounded v1 relief without forcing archive v2 first.

Existing unrelated `.gitignore` and untracked user files were left intact. No commit or push was performed.
