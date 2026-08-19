# Unit F — Agent metrics

> **Contract maturity: implementation-ready.** Implementation-blocked until ODV-A lands. Small unit, one sharp correctness rule: `receiver_agent` and `agent_allocations` answer different questions and must never be merged into one number.

## 1. Authority and required reading

- **Specification:** **challenge 0.7**, §3.2, §3.3, §6.7, §8.
- **Wireframes (illustrative only):** `owner-daily-view-planned.txt` §8.
- **Read the source comment that makes this a correctness issue:** `src/models/CallLead.ts` lines 148–157 — the `receiver_agent` block explicitly states it is independent of `BookedLead.agent_allocations`, which tracks commission credit.
- **Existing patterns:** `src/services/analytics/agentPerformance.service.ts`, `src/services/analytics/agentSalesReport.service.ts` — reuse the allocation-summing approach, not the reporting shape.

## 2. Objective

Deliver the Agent tab: per-agent lead intake, conversion of leads they were handed, commission credit, and conversation volume, all bounded by the Daily View window. Present the two booking numbers as visibly distinct columns with tooltips naming which question each answers.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` and `vantage-admin` on the sprint branch.
- **Prerequisite:** ODV-A complete.
- **Soft dependency:** ODV-D. The conversation columns render `0` / `—` until `lead_conversations` holds records. That is a correct state, not a blocker.
- Redacted synthetic data. `TEST_MODE=true`. No commit, push, deploy, production apply, live payload read, or external send.

## 4. Current-state evidence to verify

Observed 2026-08-19; reverify at implementation:

- `FormLead` and `CallLead` both carry `receiver_agent`, `receiver_agent_name_snapshot`, `receiver_agent_source`, `receiver_agent_source_value`, `receiver_agent_set_at`. Both index `receiver_agent`.
- `BookedLead.agent_allocations` is an array carrying `agent_name_snapshot` and `binder_amount` per entry.
- `RECEIVER_AGENT_SOURCES` is defined in `src/models/granotLifecycleSchemas.ts`. Provenance of the attribution varies by source and is worth surfacing.
- Neither lead collection has an index on `{ receiver_agent, timestamp }`. The ODV-A window index plus the existing `receiver_agent` index may or may not serve the grouped query — measure before adding anything.
- `Agent` documents carry activation state. An agent with zero activity in the window should not appear; an inactive agent with activity in the window **should**, marked inactive.

## 5. Locked decisions and invariants at risk

- **Three separate numbers, never merged.** `leads_received`, `received_leads_booked`, `booking_credit`. A single "total booked" column silently picks one and is wrong for the other question.
- **Name them unambiguously and tooltip them.** The column header alone cannot carry the distinction.
- **The window binds on lead `timestamp` for intake columns and on `BookedLead.timestamp` for credit** — not `book_date`. Specification §3.2.
- **Snapshots, not `$lookup`.** `receiver_agent_name_snapshot` and `agent_name_snapshot` are already denormalized.
- Row click filters the Leads tab to that agent. It does not open a drawer — the useful next action is "show me their leads".
- Read-only. No mutation.

## 6. Deliverables and exact contract

### 6.1 Route

```text
GET /api/v1/admin/owner-daily/agents ?window=24h|48h
```

Owner-only. No cursor — the agent roster is small and the response is one page.

### 6.2 Payload

```ts
export type DailyAgentMetricsResponse = {
  window: DailyWindowEcho;
  generated_at: string;
  rows: DailyAgentRow[];
  team: DailyAgentTotals;
};

export type DailyAgentRow = {
  agent_id: string | null;          // null groups unattributed activity
  agent_name: string;               // snapshot; "Unattributed" when null
  active: boolean;

  leads_received: number;           // leads with receiver_agent = X, lead timestamp in window
  received_leads_booked: number;    // of those, how many have a Booking
  received_conversion_rate: number; // 0..1, 0 when leads_received is 0

  booking_credit_amount: number;    // sum of agent_allocations.binder_amount where X appears,
                                    // on BookedLeads with timestamp in window
  booking_credit_count: number;     // bookings X appears on

  conversations: number;            // lead_conversations by receiver_agent, started_at in window
  average_talk_seconds: number | null;
};
```

`received_leads_booked` and `booking_credit_count` **will disagree routinely.** That is correct and expected. Neither is derived from the other.

Unattributed activity groups under `agent_id: null` rather than being dropped — a window where a third of leads have no receiver is a fact the Owner needs to see.

### 6.3 Retrieval

Three bounded aggregates in `Promise.all`, grouped on the snapshot name with the ObjectId retained:

1. `form_leads` + `call_leads` grouped by `receiver_agent`, window on `timestamp`, with a `booked != null` sub-count.
2. `booked_leads` `$unwind` on `agent_allocations`, window on `timestamp`, grouped by agent, summing `binder_amount` and counting distinct bookings.
3. `lead_conversations` grouped by `receiver_agent`, window on `started_at`, counting and averaging `duration_seconds`. **Skip this query entirely when `capabilities.conversations` is not `available`** so the unit works standalone.

Merge in the service by agent id. No `$lookup`.

Sort by `booking_credit_amount` desc, then `leads_received` desc, then name.

### 6.4 Admin

| Path | Deliverable |
| --- | --- |
| `components/daily/agents-tab.tsx` | The table, team totals row, tooltips |
| `lib/api/ownerDaily.ts` | `fetchDailyAgentMetrics` |

Column headers and tooltips, exact:

| Header | Tooltip |
| --- | --- |
| `Leads recv.` | Leads assigned to this agent in the window. |
| `Recv. booked` | How many of the leads this agent received went on to book. Conversion of what they were handed. |
| `Conv. rate` | Recv. booked ÷ Leads recv. |
| `Booking credit` | Binder credited to this agent on bookings recorded in the window. A different question from Recv. booked — an agent can be credited on a booking from a lead someone else received. |
| `Conversations` | Recorded conversations on leads this agent received. |
| `Avg talk` | Mean conversation duration. |

Row click navigates to `?tab=leads&agent_id=<id>` preserving the window.

## 7. Explicitly out of scope

- Agent performance trends, charts, or comparison to prior periods. Different product; `/analytics` and the agent sales report already exist.
- Any agent grading, ranking-by-quality, or conversation-derived scoring. Specification §11.
- Editing agent records or allocations.
- An agent detail drawer.

## 8. Flags and runtime posture

No new flag. Renders correctly with every Granot effect flag false and with `lead_conversations` absent or empty.

## 9. Migration and indexes

**No index under this issue by default.** Measure first: run the three aggregates against a representative test dataset and record `explain()` plans in the completion handoff. If the grouped lead query is a collection scan, report `{ receiver_agent: 1, timestamp: -1 }` on both lead collections as a **recommended follow-up** rather than adding it here — index additions belong in a report-first migration, and this unit should not smuggle one in.

## 10. Acceptance criteria

- [ ] `received_leads_booked` and `booking_credit_count` are computed independently, and a fixture where they differ is a named test — an agent credited on a booking whose lead another agent received.
- [ ] Intake columns bind on lead `timestamp`; credit columns bind on `BookedLead.timestamp`. A booking with `book_date` outside the window but `timestamp` inside **is** counted.
- [ ] A multi-agent `agent_allocations` booking credits each agent their own `binder_amount`, and `booking_credit_count` counts the booking once per agent.
- [ ] Leads with no `receiver_agent` appear under `Unattributed`, not dropped.
- [ ] An inactive agent with window activity appears, marked inactive. An active agent with no window activity does not appear.
- [ ] `received_conversion_rate` is 0, not `NaN`, when `leads_received` is 0.
- [ ] With `capabilities.conversations` not `available`, the conversation aggregate is skipped and the columns render `0` / `—` without error.
- [ ] Team totals equal the sum of rows, including `Unattributed`.
- [ ] No `$lookup` in any pipeline.
- [ ] Every column has its tooltip, and the `Booking credit` tooltip states it is a different question from `Recv. booked`.
- [ ] Row click navigates to the Leads tab filtered by that agent, preserving the window.
- [ ] `explain()` plans for all three aggregates are recorded.
- [ ] No Command, Change, revision, outbox row, or notification is produced.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `agentMetrics.service.test.ts` — the divergence fixture as a named test; the `book_date`/`timestamp` case; multi-agent allocation; unattributed grouping; zero-division; the conversations-absent path.
- Route test: Owner-only gating, window validation.
- Admin: tooltip presence, row-click navigation target.

## 12. Live/staging verification

Preview deploy both repositories against seeded test data containing at least one booking credited to an agent who did not receive the lead. Verify the two columns visibly disagree and that a reviewer reading only the tooltips can tell why. Capture deployment ids.

**No production deploy, no live payload read.**

## 13. Rollback

Remove the Agents tab from the shell tab list, then unmount the route. No data was written, no index was added.

## 14. Required completion handoff

Report: files added; the three `explain()` plans and any recommended follow-up index; the divergence test output showing `received_leads_booked` ≠ `booking_credit_count`; test, typecheck, and build output; preview deployment ids; explicit confirmation of zero mutation.

**Unblocks:** nothing. This unit is a leaf.
