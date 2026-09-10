# Session story-conversations-seed-from-artifacts-2026-09-10T2318Z

- Date (UTC): 2026-09-10
- Service / module: `conversations` / `seedFromArtifacts.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 38 / 1 / 3
- Recommendations on disk: 299 (through `conversations-media.md`)
- Current service / next module (TRAVERSAL): `conversations` (in-progress) / `seedFromArtifacts.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/conversations-seed-from-artifacts.md`
- operations named: parse the already-paid artifact into the summary and the spoken transcript; stamp the redacted transcript bag; stamp the sectioned summary bag then split the six headings so the opened card can paint them; stamp media from the locker return
- remaining in this service: none — `conversations` is now **visited**

## Stock at end

- Visited / in-progress / unvisited: 39 / 0 / 3
- Current service / next module: `extensionUsers` (unvisited) / enumerate first

## Messages posted

- 2026-09-10T2318Z next

## Ideas parked

- Spec §5.2 Call Log fetch / `contentUri` download / live STT / live summarizer / CLI `--lead-id` stay parked — do not implement in the rename
- Stored `media.blob_url` from private `put` stays stamped by the script; opened card still omits it
- Script leftover `@` / 13–19 digit refuse stays on the operator script
- Rows 40–42 (`extensionUsers`, `jobNumberTimeline`, `tariff`) stay unvisited until the next run enumerates `extensionUsers`
- Disk also has unlisted `dailyOperations`; do not open it while Wave A rows 40–42 remain

## Contradictions

- Spec §5.2 names a live RingCentral + STT + summarizer seed under `scripts/dev_ops/`; this file and `scripts/conversations/seed-known-conversation.ts` replay `CHRIS_HUGHES_SEED` artifacts with no new vendor call
- `buildSeededSummary` writes artifact markdown as-is; spec says the redacted transcript goes to the summarizer
- Script leftover `@` / 13–19 digit refuse sits after `buildSeededTranscript` and can false-trigger on a Luhn-fail run
- Seed stores `media.blob_url`; opened card omits it
- Barrel does not re-export this file; `normalizeSummaryMarkdown` is a leftover export
- Knowledge links [Lead Conversation](CONTEXT.md); this checkout’s `CONTEXT.md` does not define it; `docs/adr/` is absent
