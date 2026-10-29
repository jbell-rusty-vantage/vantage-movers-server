# Implementation board

Status: `queued` | `in-progress` | `implemented` | `merged`

- `queued` — recommendation exists; no implementation row yet. Do not
  pre-list the catalog here. Add a row when a pass starts.
- `in-progress` — `refactor/<slug>` is open; `src/` is changing.
- `implemented` — parity + required review done; on the branch, not on
  `main`.
- `merged` — on `origin/main`.

Recommendation path is always under
`.cursor/story-refactor-workspace/recommendations/`. Never copy the rec
into `passes/`. A pass file records what the implementation did.

## Stock

- Implementation rows: 3
- in-progress: 0
- implemented: 3
- merged: 0

## Rows

| Story | Rec | Target | Status | Branch | Pass |
|---|---|---|---|---|---|
| Form Lead | [form-lead.md](../story-refactor-workspace/recommendations/form-lead.md) | `src/services/leads/formLead.service.ts` | implemented | `refactor/form-lead-story` | [passes/form-lead.md](passes/form-lead.md) |
| Call Lead | [leads-call-lead.md](../story-refactor-workspace/recommendations/leads-call-lead.md) | `src/services/leads/callLead.service.ts` | implemented | `refactor/call-lead-story` | [passes/call-lead.md](passes/call-lead.md) |
| Duplicate Lead | [leads-duplicate-lead.md](../story-refactor-workspace/recommendations/leads-duplicate-lead.md) | `src/services/leads/duplicateLead.service.ts` | implemented | `refactor/form-lead-tests` | [passes/duplicate-lead.md](passes/duplicate-lead.md) |

## Next

Read [DIRECTIVE.md](../story-refactor-workspace/DIRECTIVE.md). Duplicate Lead is implemented on `refactor/form-lead-tests` and not committed. Names were already the story names, so this pass proved outcomes and corrected comments. Do not start the next brief until the owner asks. One story at a time.
