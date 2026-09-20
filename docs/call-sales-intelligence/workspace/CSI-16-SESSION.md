# Later session — one task: CSI-16 only

Do not open this session until CSI-15 has a handoff packet with synthetic replica proof. This is Team F certification and documentation restamp. It is **not** a second implementation of backfill, and it is **not** authorization to enable production flags, run fleet backfill, send a nudge, or create a subscription.

Copy the prompt below into that later session. Subagents are allowed. Prefer Cursor Grok 4.6. Cursor quality / `finish-work` may use Grok 4.6, Auto, or Composer 2.5 only — never a GPT model.

> One task: **CSI-16 only** — integrated certification, honest capability proof, and docs restamp. Team F. CSI-15 must already be locally implemented; read its `evidence/csi-15/HANDOFF.md` and `CHECKS.md` first. If that packet is missing or backfill is still `available: false` with no workers, stop and return to CSI-15.
>
> Inspect remotes and dirty files first. All three remotes must stay `jbell-rusty-vantage`: server `vantage-movers-server`, Admin `vantage-admin`, MCP `vantage-movers-mcp`. Work on local `main`. MCP is in scope only for contract consistency checks, not new tools. Never force-push. Never skip hooks. Do not write `.env` or paste `ADMIN_SEED_*`. Do not point 3107/3108 at Atlas.
>
> Claim CSI-16 in `LEDGER.md` before edits. Packet: `docs/call-sales-intelligence/workspace/evidence/csi-16/{INTAKE,SOURCES,FILES,CHECKS,REVIEW,HANDOFF}.md` plus a filled [ACCEPTANCE](ACCEPTANCE.md) record that lists pass / fail / not-run / capability-blocked per scenario.
>
> **Still forbidden without a new explicit Owner sentence:** `NUDGE_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`, `BACKFILL_DAYS`, capture/media/outreach Vercel or `.env` writes; `migration:csi:indexes --apply`; production `POST /backfill`; live send; new RingCentral subscription create/renew/repair; paid Gateway/STT just to green a row; pointing preview fixtures at Atlas. Historical September 14 recording denial is **not** a current grant. `RINGCENTRAL-CAPABILITY.md` may be cited as historical only.
>
> ## What CSI-16 is
>
> 1. **G4 synthetic resilience.** Execute (or reuse with fingerprints) CSI-15 plus prior replica proofs for duplicate/race/history/budget/permission/retry/retention. Do not silently edit B–E fixtures to hide a failure; file the exact owning issue.
> 2. **G5 Owner walkthrough.** Run [ACCEPTANCE](ACCEPTANCE.md) scenarios 1–14 against isolated Admin + local API + replica/preview DBs (or the existing 3107/3108 topology if still up). Record expected vs actual, redacted source, and owning team for each gap. Use CSI-09 Lead entry and the named subjects only as **read** examples: P5562014 Outreach `6aaf051bec271d561ab295c7`, 5564480 Outreach `6aaf051dec271d561ab295cb`. Those rows have **no** Number Activity, **no** attachments, and 5564480 has **no** Vantage conversation. Do not invent Play/media.
> 3. **G6 capability list — record, do not fake.** Fresh probe only if the Owner authorizes that probe in this session. Otherwise mark each row `not probed`: current recording-read grant, subscriptions/renewal ownership, Gateway model/STT route + current pricing, private Blob binding, worker/queue/cron limits, index `--verify` (verify only), deployed Admin/server/MCP revisions, rollback. Deployed `/outreach/by-lead` was `FEATURE_DISABLED` on September 19; do not call that production-ready.
> 4. **Docs restamp.** Update `docs/index.md`, matching `docs/knowledge/services/*`, `workspace/{CONTRACTS,LEDGER,README,SPRINT-PLAN,teams/f-integration}.md`, and Admin CONTEXT/rules pointers so they describe current behavior. CONTRACTS G2/G3/G4/G5/G6 rows are stale as of the CSI-09 briefing — restamp them from evidence, not hope. Use glossary words from workspace `CONTEXT.md`.
>
> ## Honest remaining product limits (do not close by prose)
>
> - CSI-14 fuller dialogs/history; live send still gated. Smallest Message-rep picker and destination/P2 exist.
> - CSI-10 empty-recording replay may still gate on `call.recordings.length`.
> - Named-subject seed created Lead Outreach only; capture/attach/Play were not seeded.
> - Official indexes: `--verify` only unless the Owner re-authorizes apply (ledger claims apply already happened; if verify disagrees, stop).
> - Flag enablement is the Saturday full cutover in [AFTER-16](AFTER-16.md) D+E (all capability flags at once). Fleet backfill still needs an explicit day range. Write the cutover as performed work only after that session.
>
> ## Proof
>
> Cross-repo: server typecheck/focused CSI-15+acceptance tests; Admin typecheck/focused SI tests; MCP typecheck/existing suite if you touch it. Browser proof for G5 on isolated preview, not Atlas. No customer phones in artifacts.
>
> Finish with the CSI-16 packet, the acceptance matrix, the G6 table (probed vs not probed), and the restamped pointers. Stop. No production enablement. No commit or push unless the Owner asks. After this packet exists, use [AFTER-16](AFTER-16.md) — one slice per session.
