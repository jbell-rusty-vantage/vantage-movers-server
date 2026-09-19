# Next agent session — one task: named 1–2 subject seed

This is a single Owner-authorized example-seed task. It is **not** CSI-15 fleet backfill, CSI-14 dialogs, flag enablement, or the CSI-10 empty-recording repair.

Copy the prompt below into the next session. Subagents are allowed. Prefer Cursor Grok 4.6. Cursor quality / `finish-work` may use Grok 4.6, Auto, or Composer 2.5 only — never a GPT model.

> One task: seed the **two named number-lead subjects** so the Owner can open them in Sales Intelligence. CSI-09 Coverage/settings plus Lead-detail entry is locally complete on `main` and committed. Owner named Job **P5562014** and Job **5564480**. Read [`evidence/named-subjects/AUTHORIZATION.md`](evidence/named-subjects/AUTHORIZATION.md) before any write. This is not CSI-15. Do not enable `NUDGE_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`, `BACKFILL_DAYS`, or capture/media/outreach flags in Vercel or `.env`. Do not apply `migration:csi:indexes`. Do not start CSI-14 fuller dialogs/history, CSI-15/16 workers, live send, or the CSI-10 empty-recording repair in `repIdentity/worker.ts`.
>
> Inspect remotes and dirty files first. All three remotes must stay `jbell-rusty-vantage`: server `vantage-movers-server`, Admin `vantage-admin`, MCP `vantage-movers-mcp`. Work on local `main` in each repo. MCP should stay clean and untouched. Record actual HEADs. Never force-push. Never skip hooks. Do not write `.env` or paste `ADMIN_SEED_*`. Do not point CSI-07 preview ports 3107/3108 at Atlas.
>
> **Indexes.** CSI-09 did not run the official catalog. The workspace ledger claims Owner-authorized `--apply --confirm-production=vantagemovers` already succeeded with `--verify` ready and unresolved 0, after stamping company `provider_account_id` `62948571023` on conversation `6a905b5cf7dda52cfacb721e`. Confirm with `pnpm migration:csi:indexes -- --verify` only. If verify is not clean, stop and ask. Do not `--apply` or `--report` into a write. Mapping artifacts stay local/gitignored. Receiver Agent Patrick is identity only; not the account field.
>
> **Subjects.** Look up by job number / Mongo ids. Last-four is not a unique key. Do not copy customer phones into chat, commits, evidence, or screenshots.
>
> - **P5562014** — Call Lead `6a761d3d7ceae445794c57bd`, Booking `6a7d4e3529d500054c6b5be5`, conversation `6a905b5cf7dda52cfacb721e`, stored Blob `conversations/3750152612023.mp3`. Use this subject when the walkthrough needs Play / existing media. Do not re-fetch that recording. Do not call paid STT or Gateway.
> - **5564480** — Call Lead `6aaaf552ca2df3ab6f396b5d`, Booking `6aac3c5c825e5bfbdddaa34b`, RingCentral session `8205746055`, call log `AK3DcEGCAYGvjUA`, **no** `lead_conversations` row. A recording is unproven in Vantage. Do not fetch production recordings. Do not claim stored media. Recording grant must still be re-probed before any live media pull; this session does not re-probe to green a checklist.
>
> **Allowed writes.** Claim every production write in `LEDGER.md` before doing it. Use existing official seams only: Number Activity reads, CSI-05 attachment suggest/attach for exact Call Lead identity, CSI-06 `outreach_ensure` for current official records, and CSI-09 `outreach/by-lead` / `salesIntelligenceLeadHref`. Official Booked/Cancelled must win: ensure may create or refresh the Outreach/Number so Lead Actions can open the matching subject, but it must not invent attachments, reopen closed work, or create current overdue first-action / missed-callback / going-cold from historical calls. If `outreach_ensure` would activate historical obligations, stop and report the exact transition. Do not run Call Log reconcile windows, webhook backfill, `POST /backfill`, or `BACKFILL_DAYS`.
>
> **Proof.** Prefer the already-deployed internal Owner dashboard, or local Admin whose server-only API origin already points at the same production API. Do not retarget 3107/3108. Walk both subjects from Form/Call Lead Actions → Open in Sales Intelligence → matching Number/Outreach. P5562014 should show the existing stored conversation when the official attachment exists; 5564480 should stay honest about missing Vantage audio. Record exact reads/writes, HTTP codes, and redacted browser proof under `docs/call-sales-intelligence/workspace/evidence/named-subjects/`. No secrets, no customer phones.
>
> **Still forbidden:** CSI-15 windows; live send; subscriptions; identity writes for Josh, Roy, Jason, either Tyler, Russell, QA, or unmatched Users; paid model/STT; pointing preview fixtures at Atlas; commit or push unless the Owner asks.
>
> Finish with: what exists vs what you wrote for each subject, the two SI URLs (ids only), index verify result, and the evidence packet path. Stop there.
