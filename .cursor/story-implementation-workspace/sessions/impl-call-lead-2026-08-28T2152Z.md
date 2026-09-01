# Session impl-call-lead-2026-08-28T2152Z

- Date (UTC): 2026-08-28T21:52Z
- Story: Call Lead
- Recommendation: `recommendations/leads-call-lead.md`
- Branch: `refactor/call-lead-story`

## Decisions

1. Operational story name: Call Lead ingest / correct / list / remove
2. Module seam: one file; `begin` / `complete` stay split; RC injectable adapter keeps its own after-commit
3. Type home: `CallLeadIngestionInProgress` colocated in `callLead.service.ts`
4. Helper home: owning file (shared refuse / tombstone / erase). No `types/` or `utils/` folder

Did not: `CallLeadService` class, sibling rewrite, drop/add `lead.call.created`, move correction missing-CPL, change persisted `command_name`.

## This pass

- opened new implementation row?: yes
- path: implement → `passes/call-lead.md`
- review subagent: ran; fixed source-scan asserting helper name

## Stock at end

- Implementation rows: 2
- Current story: `call-lead` (implemented)
- Next story: next `leads` rec after commit

## Messages posted

- 2026-08-28T2152Z next-run
