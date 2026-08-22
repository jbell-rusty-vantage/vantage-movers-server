# Messages

Open items first. Newest on top. Not knowledge.

## Open

## 2026-08-21T2352Z | to: next-run | from: opt-c-2026-08-21T2352Z | kind: next

`opt-c` and `opt-d` are done on `docs/okf-optimization`. One optimization PR: https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/6 — update it; do not open a second.

1. Next unit: **`opt-e`** (create or skip `lead-messaging`, `employee-bookings`, `reporting`, `ingestion` — code + tests first; no hollow Services).
2. Ignore `pnpm okf:progress`. Disk = `OPTIMIZATION.md`.
3. Suggested remaining split: run 3 = E; run 4 = F + first unfinished `g-*`.
4. Do not removen. Do not start maintenance. Do not recreate `.cursor/businesslogic/`.
5. Do not start G before F.

## 2026-08-21T0220Z | to: human | from: pass0-2026-08-21T0217Z | kind: question

This standalone checkout has no `../CONTEXT.md` and no `../docs/adr/0001`–`0003`. Progress recorded them `skipped-absent`. Stamp those ADRs only when a workspace checkout includes them. Do not copy them into this repo.

## Resolved

## 2026-08-21T2254Z | to: next-run | from: opt-a-2026-08-21T2254Z | kind: next

`opt-a` and `opt-b` are done on `docs/okf-optimization`. Conversion PR #5 is merged. One optimization PR: https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/6 — update it; do not open a second.

1. Next unit: **`opt-c`** (rename `Related businesslogic`, fix old `.service.md` labels). Then **`opt-d`** if time (code-read the four fat routers first).
2. Ignore `pnpm okf:progress` (still says done). Disk = `OPTIMIZATION.md`.
3. Suggested remaining split: run 2 = C+D; run 3 = E; run 4 = F + first `g-*`.
4. Do not removen. Do not start maintenance. Do not recreate `.cursor/businesslogic/`.

Resolved by opt-c-2026-08-21T2352Z: C and D finished; next is `opt-e`.

## 2026-08-21T2147Z | to: next-run | from: opt-setup-2026-08-21T2147Z | kind: next

Optimization phase is live. Conversion is **frozen Done**. Do not removen. Do not start maintenance.

Follow `.cursor/skills/okf-docs-optimization/SKILL.md`. Paste `.cursor/okf-workspace/CLOUD-PROMPT.md` each Cloud run (same prompt, 4 slices).

1. Next unit: **`opt-a`** (delete `.cursor/businesslogic/`, retarget `okf:query` + documentation-maintenance). Then **`opt-b`** if time.
2. Branch: create `docs/okf-optimization` from the conversion tip. One optimization PR. Do not pile onto conversion PR #5 unless NOW already names it.
3. Ignore `pnpm okf:progress` (still says done). Do not `--write` it. Disk = `OPTIMIZATION.md`.
4. Suggested split: run 1 = A+B; run 2 = C+D; run 3 = E (code-heavy); run 4 = F + first `g-*`.
5. D/E/G require reading `resource` code + tests before editing docs.
6. ADRs remain `skipped-absent`. Do not invent `../CONTEXT.md` or `../docs/adr/`.

Resolved by opt-a-2026-08-21T2254Z: A and B done; branch `docs/okf-optimization`; PR #6.

## 2026-08-21T1417Z | to: next-run | from: pass-done-2026-08-21T1417Z | kind: next

Conversion is **Done** on `docs/okf-conversion` (`pnpm okf:progress` pass done / 36/36 moved / routers 9/9). Do not start maintenance.

Resolved by opt-setup-2026-08-21T2147Z: phase retargeted to optimization. Conversion frozen. Next unit `opt-a`.

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
