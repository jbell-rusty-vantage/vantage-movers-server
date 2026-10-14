# Priority Pool prototype — throwaway, synthetic

Question: can normal Leads retain their assigned Rep while all eligible Reps share one daily requirement, with separate assigned fulfillment and actual-caller credit?

From `vantage-main-server`:

```powershell
pnpm prototype:pool
pnpm prototype:pool:ui
pnpm prototype:pool:replay
```

The UI runs at [localhost:4179](http://127.0.0.1:4179). Terminal and browser use `shared-state.mjs`; state is in memory and resets on restart/reload. The UI simulator buttons intentionally name the synthetic actor submitting the event independently of the selected viewer. They are not production command endpoints or proof of authentication. Full relevant state is visible under the disclosure.

Select Rep B, call as A, then replay. P1 remains assigned to B, both views show completed, B's assigned workload is fulfilled and only A has an actual outbound. “A + B simultaneous” represents two distinct real event IDs: one duty, two real calls. Next NY day opens one new duty. Try exit/reentry, Booked/Cancelled, answered inbound on unassigned P2, late entry, closed date and advisory claim. B's personal goal is off; shared work still exists. New/Quoted/Other retain assigned scope. Inactive/generic Admin viewers are denied in the synthetic model.

`desk-demo.mjs --replay` is a deterministic demonstration, not a production test suite. The model serializes arrivals; durable database concurrency, identity history, coverage/restrictions, corrected/revoked provider events, cross-mode coverage transfer and SSE are specified implementation gates, not capabilities certified by this toy. Same-day reentry keeps the original day key; no accumulated Pool catch-up debt is modeled. Existing `parser.ts`, `matching.ts`, `live.ts` and their 17 checks remain the inspection prototype and were updated/reused rather than replaced with a new Lead model.

The explicit opt-in `inspect-live.ts` uses the shipped corrected collector with a local Pool-only session wrapper and the real shared account lease. It performs no domain mutations. `inspect-anchors.ts` joins redacted observed anchor keys to canonical history/flags using raw-driver reads. Neither is an automatic admission tool. Credentials load only via existing environment bindings and never enter output. Read the [findings](../../docs/rep-desk-and-pool/POOL-FINDINGS-2026-10-14.md) before rerunning.

Answer: the shared requirement and assignment can be independent. The observed normal Lead corpus supports reuse. Calendar, goal presentation, collection floor, same-day transfer and future creation/Sheet policy require Owner approval under the [current proposal](../../docs/rep-desk-and-pool/POOL-APPROVAL-2026-10-14.md). Delete or absorb this throwaway UI/state module after approval and production implementation; keep the evidence and accepted decisions.
