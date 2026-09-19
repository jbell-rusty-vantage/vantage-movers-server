Acting as the documentation-update stage: reading quality context, session/cleanup diffs, and documentation ownership rules.


Updating docs to match cleanup behavior: revision fencing for auto-resolved links, destination-rejection observability, and rate-limit index ops.


# Docs keeper — CSI-14 nudges (quality checkpoint documentation stage)

## 1. Target
- Session + cleanup changes: directory-User destinations, optional reviewed link, per-extension rate limit, customer-destination observability on `OutreachRecord`, auto-resolved link revision fencing, Zod pairing for `rep_identity_link_id` / `expected_rep_revision`
- Repo: isolated `vantage-main-server` quality workspace only

## 2. Layer decision

| Path | Matched glob / rule | Layer | Action |
| --- | --- | --- | --- |
| `docs/knowledge/services/sales-intelligence-nudges.md` | `docs/knowledge/**` / docs-keeper map | Business logic (Service) | **Update** (cleanup had audit/index ops; added revision-fence paragraph) |
| `docs/call-sales-intelligence/workspace/evidence/csi-14/API-CONTRACT.md` | Long-form CSI contract | Product/browser contract | **Update** |
| `docs/index.md` | Catalog | Index row | **Update** |
| `docs/call-sales-intelligence/04-server-routes.md` | Long-form routes | **Update** (stale “CSI-14 unimplemented”) |
| `docs/call-sales-intelligence/workspace/evidence/csi-14-destination/HANDOFF.md` | Evidence handoff | **Update** (revision rules) |
| `docs/knowledge/services/sales-intelligence-rep-identity.md` | Service | **Skip** — already aligned in session diff |
| `.cursor/rules/project-organization.mdc`, `observability-service.mdc`, `schema-and-crud-inputs.mdc` | Globs | **Skip** — no CSI-14 route/index detail owned there |
| Workspace `LEDGER.md` / `NEXT-SESSION.md` / sprint ledgers | Coordination | **Skip** — instructions forbid marking work complete in ledgers |

## 3. Changes made
- **`sales-intelligence-nudges.md`** — Documented when `expected_rep_revision` is required (explicit link id or auto-attached current reviewed link) and that preview returns the revision; cleanup paragraph on `destination_rejected` + `nudge_extension_created` backfill was already present.
- **`API-CONTRACT.md`** — Destination addendum matches eligibility + Zod; errors note `OutreachRecord` observability for customer destination; operations note `nudge_extension_created` migration/backfill vs “no migration run in this checkout.”
- **`docs/index.md`** — Nudges catalog blurb: directory User destination, optional link, revision fence, per-extension rate limit.
- **`04-server-routes.md`** — CSI-10 section no longer claims CSI-14 is unimplemented.
- **`csi-14-destination/HANDOFF.md`** — Revision pairing wording aligned with server behavior.

## 4. Skipped on purpose
- **`sales-intelligence-rep-identity.md`** — Session diff already updated CSI-14 consumption wording.
- **Glob-scoped rules** — No new routes or folder ownership; observability event detail stays in Service + API contract.
- **Root `CONTEXT.md`** — Not present in this checkout; no new platform terms.
- **Most CSI workspace docs** (`01-specification`, `CONTRACTS`, `LEDGER`, evidence CHECKS) — Already updated in session or are coordination/evidence, not authoritative Service layer.

## 5. Contradictions
- **`04-server-routes.md`** still opens with “Status: build contract, not implemented” while CSI-14 addenda say implemented — intentional split (full catalog vs shipped subset); only the CSI-10 line claiming CSI-14 unimplemented was corrected.
- **`csi-14/HANDOFF.md`** still describes pre–destination-change behavior (“current reviewed identity authority”) — **unresolved**; prefer `API-CONTRACT.md` + Service for shipped behavior.
- **Inactive `agent.active` gate removed** for directory-only messaging — product decision per cleanup; not restated in Service (no code change this stage).
- **Team Messaging without stored person id** — HANDOFF + Service agree; snapshot Users lack person id (documented limit).

## 6. Follow-up
- **Ops:** Run CSI index migration + legacy `owner_rep_nudges` `rc_*` backfill before production rate limits (documented in Service + API contract).
- **Admin / vantage-admin:** Message-rep picker and proxy bodies live outside this repo; not updated here.
- **Optional:** Refresh `csi-14/HANDOFF.md` baseline narrative so it does not contradict the September 19 destination addendum.
- **Optional:** Integration test for `rc_account_id` mismatch → `IDENTITY_BLOCKED` (noted in cleanup as gap).

**Runtime code:** Not modified in this stage (documentation only).