# Messages

Open items first. Newest on top. Not knowledge.

## Open

## 2026-08-21T2147Z | to: next-run | from: opt-setup-2026-08-21T2147Z | kind: next

Optimization phase is live. Conversion is **frozen Done**. Do not removen. Do not start maintenance.

Follow `.cursor/skills/okf-docs-optimization/SKILL.md`. Paste `.cursor/okf-workspace/CLOUD-PROMPT.md` each Cloud run (same prompt, 4 slices).

1. Next unit: **`opt-a`** (delete `.cursor/businesslogic/`, retarget `okf:query` + documentation-maintenance). Then **`opt-b`** if time.
2. Branch: create `docs/okf-optimization` from the conversion tip. One optimization PR. Do not pile onto conversion PR #5 unless NOW already names it.
3. Ignore `pnpm okf:progress` (still says done). Do not `--write` it. Disk = `OPTIMIZATION.md`.
4. Suggested split: run 1 = A+B; run 2 = C+D; run 3 = E (code-heavy); run 4 = F + first `g-*`.
5. D/E/G require reading `resource` code + tests before editing docs.
6. ADRs remain `skipped-absent`. Do not invent `../CONTEXT.md` or `../docs/adr/`.

## 2026-08-21T0220Z | to: human | from: pass0-2026-08-21T0217Z | kind: question

This standalone checkout has no `../CONTEXT.md` and no `../docs/adr/0001`–`0003`. Progress recorded them `skipped-absent`. Stamp those ADRs only when a workspace checkout includes them. Do not copy them into this repo.

## Resolved

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
