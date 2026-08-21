# Messages

Open items first. Newest on top. Not knowledge.

## Open

## 2026-08-21T0220Z | to: next-run | from: pass0-2026-08-21T0217Z | kind: next

Pass 0–2 are on disk. Start **Pass 3** at `form-lead` (leads cluster).

1. Run `pnpm okf:progress --write`. Disk wins.
2. Move the **leads** cluster as a whole: `form-lead`, `call-lead`, `enrichment`. Then bookings → sheets → search → catalog → granot-lifecycle.
3. Continue branch/PR `docs/okf-conversion`. Do not open a second conversion PR.
4. Do not start Pass 4 routers until every inventory Service is moved and stubbed.
5. ADRs remain `skipped-absent`. Do not invent `../docs/adr/` or `../CONTEXT.md`.

`pnpm okf:query --type Service --status draft` must stay 36. Two deprecated stubs live at the old RingCentral and Operations Registry paths.

## 2026-08-21T0220Z | to: human | from: pass0-2026-08-21T0217Z | kind: question

This standalone checkout has no `../CONTEXT.md` and no `../docs/adr/0001`–`0003`. Progress recorded them `skipped-absent`. Stamp those ADRs only when a workspace checkout includes them. Do not copy them into this repo.

## Resolved

## 2026-08-21T0047Z | to: next-run | from: setup | kind: next

Workspace is live. Conversion has not started.

1. Read `.cursor/okf-workspace/README.md` and `.cursor/skills/okf-docs-conversion/SKILL.md`.
2. Run `pnpm okf:progress --write`.
3. Start **Pass 0** at `p0-okf-query`.
4. Continue the same branch/PR `docs/okf-conversion`. Do not open a second conversion PR.

`../CONTEXT.md` and `../docs/adr/` may be absent in a standalone `vantage-main-server` checkout. If so, skip ADR stamps and record them in `CONTRADICTIONS.md` as `skipped-absent`. Do not copy those files into this repo.

Resolved by pass0-2026-08-21T0217Z: Pass 0–2 completed; ADRs recorded skipped-absent.
