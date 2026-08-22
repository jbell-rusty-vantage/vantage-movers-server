# Session opt-g-bookings-2026-08-22T0254Z

- Date (UTC): 2026-08-22T02:54Z
- Phase: optimization
- Unit started / ended: `g-bookings` / `g-bookings`
- Lock: taken
- Branch / PR: `docs/okf-optimization` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/6

## Disk at start

- `OPTIMIZATION.md` next unchecked: this Cloud checkout was stale on `cursor/okf-documentation-optimization-d5b4` / main (`opt-a`); disk on `origin/docs/okf-optimization` had `g-bookings` unchecked
- `.cursor/businesslogic/` exists?: no
- `pnpm okf:query --type Service` count: 40
- `pnpm okf:query --type Service --status deprecated` count: 0

## Units completed

- `g-bookings` → done
  - `bookings.md` → changed
  - `booked-call-lead-reconciliation.md` → changed
  - `cancelled-lead.md` → changed
  - `cancellation-mirror.md` → changed
  - `customer.md` → changed
  - `agent-allocation.md` → changed

## Code-truth

- `bookings.md` → referral/leadless **delete** allowed; update 409 for both; leadless case only on Best Relocation import; from-source override writes Registry assignment + CPL; unmatched Call create uses `applicable: false`; `claimAvailableLeadForBooking` does not rewrite CPL; canonical update no-ops on empty field diffs; public update always sheets
- `booked-call-lead-reconciliation.md` → `/sync` is extension `booking_action_apply`; CSV still owns `syncBookedCallLeadReconciliation`; `phone_number` is not patched; `book_date` is Florida calendar not UTC; customer write is `$setOnInsert`; job-no-only assigned-source miss is `conflict`, phone-path miss is `no_match`
- `cancelled-lead.md` → public referral cancel 409; leadless cancel only with `allowLeadless` (BR import); public `customer_name` snapshot is populated `full_name` only; pending employee/BR case dismissed on cancel; canonical update no-ops
- `cancellation-mirror.md` → skipped when booking has no lead; booking delete uses `clearBookingFromLead`
- `customer.md` → optional `customer_email`; phone stored as submitted; public customer routes are not canonical executor
- `agent-allocation.md` → `upsertAgentByName` gone; `resolveAgentByName` + `includeInactive`; alias lookup; BR receiver attribution
- tests read: `bookingMirror.test.ts`, `cancellationResolver.test.ts`, `customerFromLead.service.test.ts`, `agentAllocation.service.test.ts`, `bookedCallLeadReconciliation.service.test.ts`
- routes: `v1.routes.ts`, `extension-granot-apply.routes.ts`

## Messages posted

- next-run: start `g-sheets`. Update PR #6. Do not removen.
- resolved prior next-run from `opt-f-2026-08-22T0154Z`

## Ideas parked

- none

## Contradictions

- `adr-skipped-absent` still open
- `ops-registry-authoritative-plan-absent` still open
- `public-v1-referral-cancel-vs-gated-release` still open (g-bookings noted leadless BR exception + referral delete allowed; did not merge gated Release)

## Next atomic unit (must match NOW.md)

- `g-sheets` — `sheet-sync.md`, `google-sheets.md`, `domain-commands.md`
