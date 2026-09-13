# Session story-models-granot-observation-receipt-2026-09-13T1115Z

- Date (UTC): 2026-09-13
- Service / module: `models` / `GranotObservationReceipt.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 358
- Current service / next module (TRAVERSAL): `models` / `GranotObservationReceipt.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/models/GranotObservationReceipt.ts` → [recommendations/models-granot-observation-receipt.md](../recommendations/models-granot-observation-receipt.md)
- operations named: hold the credential-redacted Granot envelope on `granot_webhook_receipts`; redact credentials on insert and keep `payload_sha256` honest; refuse evidence mutation after insert so only `processing.*` may change (mongoose allowlist + refuse replace/delete); bind the selected Mongo database and declare the five named indexes (partial unique channel + operation-id, due, lease, route, diagnostic hash)
- remaining in this service: `GranotObservation.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GranotObservation.ts`

## Messages posted

- 2026-09-13T1115Z next-run (this session)

## Ideas parked

- none (do not unique-index payload_sha256 so identical webhooks collapse; do not flip autoIndex false so boot matches Form; do not rewrite collection.updateOne Decision stamps so hooks always run; do not merge into WordPress ingress; do not add lead_ref; do not rename granot_webhook_receipts; do not drop legacy_unknown from the enum without a historical-row proof)

## Contradictions

- Cloud cursor/* seed still pointed at WordpressFormSubmissionReceipt.ts / 357 recs. Disk on `docs/story-refactor` already had that pass. Checked out that branch before recommending.
- Leftover next GranotObservation.ts is a different row — do not copy this envelope catalog onto it without reading it
