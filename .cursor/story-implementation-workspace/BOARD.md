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

- Implementation rows: 1
- in-progress: 1
- implemented: 0
- merged: 0

## Rows

| Story | Rec | Target | Status | Branch | Pass |
|---|---|---|---|---|---|
| Form Lead | [form-lead.md](../story-refactor-workspace/recommendations/form-lead.md) | `src/services/leads/formLead.service.ts` | in-progress | `refactor/form-lead-story` | [passes/form-lead.md](passes/form-lead.md) |

## Next

After Form Lead is committed: `leads-call-lead.md` (next `leads` rec in
the recommendation TRAVERSAL). One story per branch.
