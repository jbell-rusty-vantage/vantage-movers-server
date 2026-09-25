# CSI-17 core read checks

Owned source: `src/services/salesIntelligence/analysis/reads.ts`, `reads.test.ts`. Disposable proof: `scripts/test-csi-intelligence-reads.ts`, `scripts/test-csi-intelligence-reads.replica.test.ts`. Run from `vantage-main-server`; no `.env`, credentials or deployed API defaults loaded.

## Direct current-source commands

1. `node --import tsx --import ./ops/test-setup.ts --test src/services/salesIntelligence/analysis/reads.test.ts`

   Final run: 4 tests, 4 pass, 0 fail, 0 skipped; duration 3559.1272 ms. Cursor run/query binding and strict operator rejection; full-number relevance; redacted closed Lead projection; strict response with unknown speaker/null timing.

2. `node --import tsx scripts/test-csi-intelligence-reads.ts`

   Initial attempt refused loopback Mongo at `127.0.0.1:27189`: `ECONNREFUSED`, before fixture writes. Inspection found the already documented local `csi01` container exited. `docker start csi01` successfully restarted that disposable service. No production configuration or database was accessed.

   First successful run: `testvantagemovers_csi17reads5687a62487f2`, 5 tests pass, 0 fail. After adding official activity projection coverage and legacy formatted-phone support, activity run: `testvantagemovers_csi17readseee5dbc7a509`, 6 tests pass, 0 fail. After adding the real Cancellation projection, final run: `testvantagemovers_csi17reads153349b27eb9`, 7 tests pass, 0 fail, 0 skipped, duration 80202.7939 ms. The test verifies `TEST_MODE`, exact loopback URI, database-name prefix and replica-set identity before writes; it applies existing CSI indexes only inside that fresh database and drops exactly that database in teardown.

   Final output:

   ```text
   relevant candidates paginate; arbitrary Lead/Booking IDs never authorize reads — pass
   immutable pinned transcript pages retain missing ranges and null timing — pass
   cancellations use scoped Booking and surviving Lead snapshots with pagination — pass
   historical reviewed retirement resolves; proposals/conflicts/unknown fail closed — pass
   Owner precedence and restriction context are scoped and redacted — pass
   official activity timeline projects canonical scoped records without refresh — pass
   CSI-17 bounded reads on disposable synthetic replica — pass
   tests 7; pass 7; fail 0; skipped 0
   ```

   All fixtures use synthetic `202-555-01xx` customer numbers and synthetic identifiers. A fetch trap rejects provider/network access. Before/after serialized rows for Lead, Booking, Contact Number, interaction, conversation, identity, Outreach, followup, Owner instruction/restriction, original transcript snapshots and jobs remain identical across the tested reads.

3. `pnpm exec eslint src/services/salesIntelligence/analysis/reads.ts src/services/salesIntelligence/analysis/reads.test.ts scripts/test-csi-intelligence-reads.ts scripts/test-csi-intelligence-reads.replica.test.ts`

   Exit 0: source files have no lint errors. Both script paths report `File ignored because no matching configuration was supplied` (2 warnings), so script lint is not claimed.

4. `pnpm exec tsc --noEmit --pretty false 2>&1 | Select-String '(analysis/reads|test-csi-intelligence-reads)'`

   No matching diagnostics after fixing optional transcript timing by strict page parsing and using the required `.js` dynamic import suffix. This filtered diagnostic check is not evidence of the entire server's typecheck status; whole-server checks belong in CSI-17 `CHECKS.md`.

## Adaptation rationale and coverage limits

Official broad Lead/Booking CRUD services use global models and import write dependencies; this module uses configured-dataset collections with shared official any-known-contact paths, normalization and strict projections. The official Outreach DTO mapper imports nudge history and performs unbounded joins, so Intelligence context uses its pure `stateWithActions` helper over bounded official models. The official activity timeline is reused after preflight checks for its bounded recording scan and unbounded attachment/Outreach join inputs. Historical Rep Identity consumes `resolveRepIdentityAt` over a bounded account/extension/time query.

Context over 100 attachment/instruction/followup rows, 50 restrictions or 200 total records fails closed. Activity over 100 attachment/Outreach rows or 2000 recording-bearing interactions fails closed. Booking relevance over 100 related Leads fails closed. These limits are explicit unavailable evidence, never silently labeled complete. Lead/Booking search and transcript pages remain bounded and pageable. Transcript segments are fetched with Mongo `$slice`, not copied in full into every page. Original-evidence capture/intake, transaction races, auth and MCP transport have separate parent-owned tests.

No live provider/model/media proof, production write, deployment, migration, flag enablement, message, commit or push occurred. These direct checks do not supersede the preserved CSI-14 independent review or establish independent whole-app approval.

## Final pagination audit correction

After the initial quality-checkpoint snapshot started, merged Lead pagination was corrected to order by `(ObjectId, model)`, including the model in its cursor and using inclusive ID continuation only for the later model. Equal ObjectIds in Form Lead and Call Lead collections no longer skip the second record. Single-model cursor behavior is unchanged. Activity now wraps its official timeline cursor with strict run binding.

`node --import tsx scripts/test-csi-intelligence-reads.ts` then passed **8 tests, 0 failures, 0 skipped** in 7495.9472 ms against `testvantagemovers_csi17reads35178e3a9b3f` (guarded cleanup completed). New regression checks traverse the same ID in both Lead collections with page size 1, compare against a page size 2 result, and reject cross-run merged-Lead/activity cursors. The activity test verifies two actual canonical interactions across pages. `pnpm exec eslint src/services/salesIntelligence/analysis/reads.ts src/services/salesIntelligence/analysis/reads.test.ts` passed with exit 0 and no output. These are direct checks of the correction, not a claim that the earlier checkpoint snapshot contains it.

## Final CSI-12 conversation/Outreach integration proof

The stored run may include a same-Contact-Number Outreach pointer when its subject is exactly the already validated `conversation:<conversation_id>`. Nonconversation subjects still require exact Outreach subject equality. Tool arguments cannot supply or change that stored pointer. Context includes the related Outreach's actual Lead subject in its Owner instruction lookup, preserving Lead Owner precedence for a conversation analysis.

Final `node --import tsx scripts/test-csi-intelligence-reads.ts`: **9 tests, 9 pass, 0 fail, 0 skipped**, exit 0, duration 126097.8029 ms, database `testvantagemovers_csi17reads68c8e9176da2` (guarded cleanup completed). The added regression accepts a conversation with its persisted same-number Lead Outreach, returns its observed instruction revision/followup authority, denies a foreign-number Outreach pointer, and retains nonconversation subject mismatch denial. [Actual final output](reads-replica-final.log) joins the completed tool session's output chunks. Final source eslint command above again exited 0 without diagnostics. Source changes and this direct proof postdate the initially started quality snapshot; no newer independent snapshot approval is claimed here.
