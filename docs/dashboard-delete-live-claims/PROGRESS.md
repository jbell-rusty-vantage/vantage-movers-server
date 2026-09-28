# Progress

Live status for this pack. The specification wins on behavior.

| Issue | Status | Note |
| --- | --- | --- |
| DLC-01 | complete | Booking delete releases live claims. Lead stays. |

## Issue log

| When | Issue | Entry |
| --- | --- | --- |
| 2026-09-28 | DLC-01 | Pack authored from the job 5565003 Confirm `GRANOT_IDENTITY_CONFLICT`. Production rebook is already done. This issue does not repair rows. |
| 2026-09-28 | DLC-01 | Started on `vantage-main-server` branch `main`. Working tree already had unrelated local edits, so no extra feature branch. |
| 2026-09-28 | DLC-01 | Finished on `main`. Booking delete releases an active Record Link `booking_ref` and an open booking-case `deterministic_booking_id`. Cancellation delete leaves `booking_ref`. The Lead document stays. `preallocatedChangeIds` for `deleteBookedLead` is 5. AC-DLC-01 through AC-DLC-12 passed. |
