# Messages

Open items first. Newest on top. Not knowledge.

## Open

## 2026-08-21T1417Z | to: next-run | from: pass-done-2026-08-21T1417Z | kind: next

Conversion is **Done** on `docs/okf-conversion` (`pnpm okf:progress` pass done / 36/36 moved / routers 9/9). Do not start maintenance.

1. Pause or retarget this 2-hour automation.
2. Fresh `main` checkouts still look like Pass 3 (`form-lead`). Continue `docs/okf-conversion`. Do not removen. Do not open a second conversion PR.
3. PR #5 is the one conversion PR: https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/5
4. ADRs remain `skipped-absent`. Stamp only if `../docs/adr/` appears.

`pnpm okf:query --type Service --status draft` = 36. Thirty-six deprecated stubs remain under `.cursor/businesslogic/`.

## 2026-08-21T0220Z | to: human | from: pass0-2026-08-21T0217Z | kind: question

This standalone checkout has no `../CONTEXT.md` and no `../docs/adr/0001`–`0003`. Progress recorded them `skipped-absent`. Stamp those ADRs only when a workspace checkout includes them. Do not copy them into this repo.

## Resolved

## 2026-08-21T1217Z | to: next-run | from: pass-done-2026-08-21T1217Z | kind: next

Conversion is **Done** on `docs/okf-conversion` (`pnpm okf:progress` pass done / 36/36 moved / routers 9/9). Do not start maintenance.

Resolved by pass-done-2026-08-21T1417Z: confirmed still Done; no removen; PR #5 remains the conversion PR.

## 2026-08-21T1017Z | to: next-run | from: pass-done-2026-08-21T1017Z | kind: next

Conversion is **Done** on `docs/okf-conversion` (`pnpm okf:progress` pass done / 36/36 moved / routers 9/9). Do not start maintenance.

Resolved by pass-done-2026-08-21T1217Z: confirmed still Done; no removen; PR #5 remains the conversion PR.

## 2026-08-21T0817Z | to: next-run | from: pass-done-2026-08-21T0817Z | kind: next

Conversion is **Done** on `docs/okf-conversion` (`pnpm okf:progress` pass done / 36/36 moved / routers 9/9). Do not start maintenance.

Resolved by pass-done-2026-08-21T1017Z: confirmed still Done; no removen; PR #5 remains the conversion PR.

## 2026-08-21T0417Z | to: next-run | from: pass3-2026-08-21T0417Z | kind: next

Conversion is **Done** on disk. Pause this 2-hour automation. Continue `docs/okf-conversion`.

Resolved by pass-done-2026-08-21T0817Z: confirmed still Done; no removen; PR #5 remains the conversion PR.

## 2026-08-21T0220Z | to: next-run | from: pass0-2026-08-21T0217Z | kind: next

Pass 0–2 are on disk. Start **Pass 3** at `form-lead` (leads cluster).

Resolved by pass3-2026-08-21T0417Z: all remaining inventory Services moved and stubbed; Pass 4 routers applied; progress is Done.

## 2026-08-21T0047Z | to: next-run | from: setup | kind: next

Workspace is live. Conversion has not started.

Resolved by pass0-2026-08-21T0217Z: Pass 0–2 completed; ADRs recorded skipped-absent.
