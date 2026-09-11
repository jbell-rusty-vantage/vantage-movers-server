# Session story-routes-tariff-adjustments-2026-09-11T2012Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `tariff-adjustments.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 320 (through `routes-extension-granot-apply.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `tariff-adjustments.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-tariff-adjustments.md`
- operations named: after the secret, append this Binding Estimate Fee pair onto Master (Zod pair, stamp omitted local effective date, connect so carrier lookup can run, ask append, hide spreadsheetId, 200) — never write customer or job, never leak the spreadsheet id, never use Sheet Sync, never treat this as a Domain Command, never check roles in this file
- remaining in this service: `granot-automation.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `granot-automation.routes.ts`

## Messages posted

- 2026-09-11T2012Z next

## Ideas parked

- This desk sits after `/api/v1` secret and does not remount `requireApiSecret` or 403 anyone. Sales 403 `"Forbidden"` is the parent.
- Knowledge names Owner / Customer Service / leftover Employee; it omits secret-only. The route test locks secret-only 200.
- This file does not ask `requireRegistryOwnerActor`.
- Pair / forbidden keys live on Zod. Append accepts any non-empty list.
- Omitted `effective_date` is local wall date. Append Timestamp is Florida. Two clocks. First-row date fallback is tautological except when both omit.
- `connect` is for `moving_carriers` lookup, not a Tariff document.
- HTTP hides `spreadsheetId` and forwards painted `rows`.
- `sendError` 500 echoes `error.message` (Extension Users style), not Job Number `"Internal error"`.
- `formatTariffActorRole` is log paint; empty roles fall through to `"sales"`. Logs `actor_email`.
- Not a Domain Command. Not Sheet Sync.
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- Knowledge omits secret-only; route test locks secret-only 200
- This file never 401/403; Sales 403 is parent `"Forbidden"`
- No HMAC Owner hatch
- Local effective date vs Florida Timestamp
- First-row effective_date fallback is tautological with Zod
- `sendError` 500 echo vs sibling `"Internal error"`
- `formatTariffActorRole` empty-roles fallback `"sales"`
