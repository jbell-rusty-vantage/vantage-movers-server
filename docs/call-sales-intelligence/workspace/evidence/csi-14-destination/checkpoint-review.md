Reviewing the checkpoint changes: reading quality context and diffs, then inspecting implementation, tests, and docs.


# Quality review — CSI-14 destination (Owner Rep Nudge)

Scope: CSI-14 September 19 destination change (directory User send, optional reviewed link, per-extension rate limit, docs + rep list DTOs). Review-only; no files edited.

## Summary

The behavioral shift is largely consistent with the updated spec and API contract: strict Zod pairing of `rep_identity_link_id` / `expected_rep_revision`, directory User validation, optional link metadata, per-`(rc_account_id, rc_extension_id)` rate window, and a strong replica proof for unlinked User `102` (Joshua). Owner auth and route boundaries look unchanged and are covered by `routes.test.ts`.

Below are concrete issues ordered by severity.

---

## Correctness / contracts

### 1. Wrong operational event entity on customer-destination rejection  
**Severity:** Medium  
**Path:** `src/services/salesIntelligence/nudges/commands.ts` (in `checked()`, ~lines 37–38)

**Scenario:** Preview/send fails `NUDGE_DESTINATION_IS_CUSTOMER`. `nudgeOperational` is called with `command.nudge.outreach_record_id` as the first argument, but that helper records `entity: { type: "OwnerRepNudge", id }` and `details.nudge_id: id`. Observability shows an Outreach id as a nudge id; dedupe keys are wrong.

**Smallest fix:** Emit an outreach-scoped event (e.g. `entity.type: "OutreachRecord"`) or skip the nudge entity until a nudge row exists; do not pass `outreach_record_id` as `OwnerRepNudge` id.

---

### 2. Per-User rate limit under-counts legacy rows; new index required at send  
**Severity:** Medium (production deploy / limit bypass until backfill)

**Scenario A:** Existing `owner_rep_nudges` rows lack `rc_account_id` / `rc_extension_id`. `rateWindow()` filters on those fields, so historical attempts may not count toward the rolling hour after deploy → limit can be exceeded.

**Scenario B:** `sendNudge` calls `assertIndexes(..., OWNER_REP_NUDGE_INDEXES)` including `nudge_extension_created`. HANDOFF states official CSI index migration was not applied; first send in an environment without that index fails closed (409-style index assertion), or ops must run migration before enablement.

**Smallest fix:** Document/run additive index migration + optional backfill of `rc_*` from `rep_identity_link_id` / authorized command snapshot for existing rows; or treat missing extension fields in rate query explicitly (fail closed or count legacy via link id during transition).

---

### 3. Team Messaging person id comes only from reviewed link, not directory User  
**Severity:** Low (documented limitation; product/spec tension)

**Scenario:** Owner selects a directory User with no reviewed link (or omits link id). `storedPerson = link?.rc_team_messaging_person_id ?? null` (`eligibility.ts` ~134–144). Snapshot extensions have no person id field; unmatched Users get pager/SMS only when snapshot facts allow — not Team Messaging. Replica test asserts this (~211–225). Pack text says channels come from “stored snapshot User” including TM when a stored person id exists; runtime only stores person id on `RepIdentityLink` after review.

**Smallest fix:** Either align spec/API copy with HANDOFF (“person id only on reviewed link today”) or extend directory snapshot + eligibility to read a stored User person id without requiring a link.

---

### 4. Auto-resolved reviewed link without revision fence when link id omitted  
**Severity:** Low–Medium (stale preview / channel surprise)

**Scenario:** Request omits `rep_identity_link_id` but extension has a current reviewed link. `optionalCurrentReviewedLink` applies `nudge_channels_allowed` and TM person id without requiring `expected_rep_revision`. Client can preview TM; concurrent link review changes channels; send may fail or switch behavior without a clear 409 unless `expected_revisions` includes `target: "rep"`.

**Smallest fix:** When auto-resolved link is used, require `expected_rep_revision` (or auto-inject it in preview DTO and enforce on send), matching the explicit-link path.

---

## Auth / validation

- **Owner + signed proxy + idempotency:** Still enforced in `routes.test.ts`; no regression seen.
- **`rc_account_id` vs configured account:** `IDENTITY_BLOCKED` in `checkNudge` (~73); no dedicated test — **test gap only**.
- **Zod refine** (`rep_identity_link_id` ⇔ `expected_rep_revision`): Present and unit-tested in `nudges.test.ts`.
- **Removed `agent.active` gate:** Previously blocked inactive agents; replica test now allows preview with inactive agent (~102–104). Likely intentional for directory-only messaging; confirm with product if inactive agents should never appear as link metadata.

---

## Side effects / safety

- Customer destination guards, review-context contact-instruction validation, and idempotent send/repair paths remain strong; replica coverage is substantial (`scripts/test-csi-nudges.replica.test.ts`, gated by `CSI_REPLICA_TEST`).
- No new external write paths beyond existing nudge send; rep identity reads are additive DTO fields for Admin pickers.

---

## Tests

| Area | Assessment |
|------|------------|
| Unlinked User send, channel restriction, per-extension rate limit | Covered in replica test |
| Template/body/customer guards | Unit + replica |
| Route auth / 422 / 409 mapping | `routes.test.ts` |
| `rc_account_id` mismatch, legacy rate counting, index-missing send | **Missing** |
| Operational event on `NUDGE_DESTINATION_IS_CUSTOMER` | **Missing** |

---

## Maintainability

- **Stale comment:** `commands.ts` ~80 still says “link's rolling hour”; rate is per extension — update comment only.
- **History API:** `nudgeHistoryQuerySchema` filters by `rep_identity_link_id` only, not `rc_extension_id` — auditing sends without a stored link id is awkward (DTO now exposes `rc_*`; query does not).
- **Mixed naming:** Template/spec use `recipient_first_name`; code still uses `repName` in `renderNudgeTemplate` — behavior OK, naming drift.
- **Dependency inversion:** No new abstractions warranted; adapter boundary for RingCentral remains appropriate.

---

## Documentation

Service docs (`sales-intelligence-nudges.md`, `sales-intelligence-rep-identity.md`) and pack addendum match implementation direction. No mandatory doc fixes beyond resolving the TM person-id spec vs HANDOFF “known limit” if you want zero drift.

---

## Verdict

**Not “No findings.”** One clear observability bug (wrong operational entity id), deploy/migration/backfill risks for rate limit and indexes, and smaller contract/fencing gaps around auto-resolved links and TM channel source. Core destination change, auth, and unlinked-User send path look sound given the documented TM limitation and replica proof.