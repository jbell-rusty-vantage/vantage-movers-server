# Pre-merge review — 2026-09-01

Parent scan plus two code-reviewer subagents on the uncommitted server and admin trees. Compared to `main` (same SHA; all work was still in the working tree).

## Verdict

Safe to merge to local `main` and push. No P0/P1 found in the parent scan.

## What was checked

- Setup writes Lead Source + Feed + optional Granot name in `withMultiEntityRegistryMutation` and refuses a live/SMS-on result.
- Leaving `create_if_missing` turns `outbound_sms.enabled` off in the same Granot update `$set`.
- Sheet/legacy resolution is collection-first; inactive-Feed mappings fail closed (`inactive_destination`).
- Owner Granot create derives `crm_origin` / `workspace_slug`; new names stay inactive.
- Admin proxy: setup POST is Owner-only; preview POSTs are in the read-preview allow-list.
- Inbound card joins Lead Source → Feed from catalogs and rejects ObjectIds as display names.
- No `.env` or live secrets in the pack. Test phone `+19545550142` is a fixture.

## Residual risk (not merge blockers)

- Wizard `splitMoveTypes` still creates one Feed (`local`). Extra Feeds are after draft.
- New projection/setup routes 404 until this server commit is the API host.
- §9.7 observation window is open. §9.8 removals stay out of pack.
