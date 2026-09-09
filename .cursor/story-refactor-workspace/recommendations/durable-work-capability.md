# Say Whether This Capability Is Actually On — Credentials Must Be Present, The Deploy Gate Must Be On, And The Owner Must Have Said Yes; Collect Every Reason It Is Off — Never Read Env, Never Claim A Run, Never Apply — operational story

- Status: recommended
- Service: `durableWork` (Wave A, in-progress)
- Pass: 5 of this service — `capability.ts`
- Remaining in this service: `schema.ts`, `providerRetry.ts`, `runTransitions.ts`, `testing.ts`
- Target: `src/services/durableWork/capability.ts`
- Knowledge: none for this folder. Callers already have Services: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (`BEST_RELOCATION_INGEST_ENABLED` must be true before `application_enabled=true`, non-bootstrap apply, or retry — the worker **reads those two itself** and never **asks** this file), [`docs/knowledge/services/granot-http-collector.md`](../../../docs/knowledge/services/granot-http-collector.md) (automation run lives under its own account lease and flags), [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (`REPORTING_GOOGLE_DELIVERY_ENABLED` and leftover live-test OAuth prerequisites stay in `src/config/domain/reporting.ts` / `reportingLiveTest.ts`), [`docs/knowledge/services/sheet-sync.md`](../../../docs/knowledge/services/sheet-sync.md) (tri-state `SHEET_SYNC_MODE`, not three booleans). Distinct from already-recommended [durable-work-leases.md](durable-work-leases.md) (named-scope fence; never ANDs a gate). Distinct from already-recommended [durable-work-checksum.md](durable-work-checksum.md) (seals a bag; never ANDs a gate). Distinct from already-recommended [durable-work-actors.md](durable-work-actors.md) (names who is speaking; never ANDs a gate). Distinct from already-recommended [durable-work-checkpoints.md](durable-work-checkpoints.md) (proves a cursor; never ANDs a gate). Distinct from later `schema.ts` `durableRunControlFields` (the persisted nest; no capability field). Distinct from later `providerRetry.ts` (classifies Google / checksum; does **not** match these reason strings). Distinct from later `runTransitions.ts` / `testing.ts` (status graph + persist / in-memory fake; neither **asks** this file). Distinct from skipped `types.ts` `EffectiveCapability` (this file **fills** that shape; it does not name it). Distinct from already-recommended [ingestion-worker.md](ingestion-worker.md) (`deploymentGateEnabled` + leftover `isConnectionApplicationEnabled` + leftover `DEPLOYMENT_GATE_DISABLED`). Distinct from leftover Wave B `best-relocation-ingestion-cron.routes.ts` (`envGateEnabled` + leftover `ingestionHeartbeatSkipReason`, first-fail). Distinct from already-recommended [granot-lifecycle-source-policy.md](granot-lifecycle-source-policy.md) (eight `EFFECT_GATE_NAMES`). Distinct from Wave B `src/config/domain/granotLifecycle.ts` (ten flags; processing/shadow default true). Distinct from already-recommended [reporting-live-test-security.md](reporting-live-test-security.md) (reads env, rejects service accounts). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Effective Capability” / “Owner Intent” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Durable Work Service in this rename.
- Callers: **none at runtime.** Folder test `durableWork.test.ts` **asks** the export twice (all three true → `effective_enabled`; missing configuration → that one reason). Barrel `durableWork/index.ts` re-exports this file. No worker, route, cron, or later folder sibling imports the name. Not this **interface**: leftover `deploymentGateEnabled`, leftover `assertIngestionEnabled`, leftover `envGateEnabled`, leftover `ingestionHeartbeatSkipReason`, leftover `getGranotLifecycleFlags`, leftover `getSheetSyncMode`, leftover `isReportingLiveTestEnabled` / leftover `validateReportingLiveTestPrerequisites`, leftover `EFFECT_GATE_NAMES`.
- Seams callers need: already-judged three answers vs this AND; collect-every-missing-reason vs live first-fail skip; this unused snapshot vs live workers that read env and persist their own skip code. There is no begin / complete Domain Command **seam**. There is no env **adapter**. There is no per-workflow **adapter**. There is no “skip the run” **adapter**.
- Split later (only if the file outgrows one sitting): this ~29-line file is one sitting if you read it as say whether this capability is actually on. If it later splits: do not. One function. Never `resolve.ts` / `create.ts` / `update.ts` / `delete.ts`. Live env readers and live skip codes stay siblings / other services.

`resolveEffectiveCapability` is executor mechanics. The owner question is: *Someone already judged three questions: are the credentials there, did deploy turn the gate on, and did the owner say yes? AND them. The capability is on only when all three are true. Collect every reason it is off — missing credentials, disabled deploy gate, disabled owner intent — not just the first. Echo the three answers under the snapshot names (`env_configured`, `env_enabled`, `owner_enabled`) plus the AND (`effective_enabled`) plus the reason list. This file does not read `process.env`. This file does not claim a run. This file does not apply. Live Best Relocation, Granot, Reporting, and Sheet Sync decide their own gates without walking through here.*

Who reads the env, who skips a Best Relocation heartbeat, who evaluates eight Granot effect gates, and who rejects a live-test service account already live in other **modules**. Do not pull those in.

## What this file actually does

One “say whether this capability is actually on” story with one owner operation, not “a capability helper,” and not Skip This Best Relocation Heartbeat / Evaluate These Eight Granot Effect Gates / Prove This Live-Test Harness May Talk To Google:

1. **Say whether this capability is actually on** — `resolveEffectiveCapability`. Take three already-judged booleans. AND them into `effective_enabled`. Copy them onto `env_configured` / `env_enabled` / `owner_enabled`. For each false input, push a reason in that order: `required_configuration_missing`, `deployment_gate_disabled`, `owner_intent_disabled`. Two or three misses keep every reason. This beat does **not** read env. This beat does **not** short-circuit after the first miss. This beat does **not** persist. This beat does **not** skip a run.

There is no second mutate operation. Re-export through the barrel is convenience for a caller that does not exist yet, not a second story.

## Organization

Keep one file. This is the screenplay for “say whether this capability is actually on.” `EffectiveCapability` already lives on skipped `types.ts`. Live env readers already live on Wave B `src/config/domain/` and leftover worker / cron helpers. Eight Granot effect gates already live on already-recommended `sourcePolicy.ts`. Live-test prerequisites already live on already-recommended `reporting-live-test-security.md`. Do not pull those in. Do not invent a `DurableCapabilityService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a per-workflow **seam** that has only `BEST_RELOCATION_INGEST_ENABLED` as an **adapter**. Do not invent an env **seam** beside three already-judged booleans. Do not invent a CRUD folder so “each boolean gets a file.”

Do not move leftover `deploymentGateEnabled` here so “one gate owns Best Relocation.” Do not move leftover `getGranotLifecycleFlags` here so “one AND owns Granot.” Do not move leftover `getSheetSyncMode` here so “one helper owns Sheet Sync.” Do not add `process.env` here so “the unused helper becomes true.” Do not split `resolve.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `resolveEffectiveCapability` | `sayWhetherThisCapabilityIsActuallyOn` | unused AND; folder test only |

Keep the old name as a one-line alias until a later caller — if any — migrates. Do not make callers learn `reasons.push` / input-vs-output field copies as the domain language. Do **not** rename the snapshot field names (`env_configured`, `env_enabled`, `owner_enabled`, `effective_enabled`, `reasons`) — skipped `types.ts` already stores those names. Do **not** invent persisted capability columns on later `schema.ts` so “the nest owns the gate.”

**No workflow class.** The one type that *does* earn a name already lives on skipped `types.ts`:

```ts
type WhetherThisCapabilityIsActuallyOn = {
  env_configured: boolean
  env_enabled: boolean
  owner_enabled: boolean
  effective_enabled: boolean
  reasons: readonly string[]
}
```

That is today’s `EffectiveCapability` — the handoff from “someone already judged the three answers” to “AND them and name why not.” Do **not** add `skip_reason` here so “Best Relocation owns the snapshot.” Do **not** add `EFFECT_GATE_NAMES` here so “Granot owns the snapshot.” Do **not** add `process.env` keys here so “this file reads the company.”

Leave `EffectiveCapability` on skipped `types.ts`. Leave leftover `deploymentGateEnabled` on already-recommended `ingestion/worker.ts`. Leave leftover heartbeat first-fail on leftover Wave B cron. Leave ten Granot flags on Wave B `granotLifecycle.ts`. Leave eight effect gates on already-recommended `sourcePolicy.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// capability.ts
// Someone already judged three questions:
// are the credentials there, did deploy turn the gate on,
// and did the owner say yes?
// AND them. Collect every reason the answer is no.
// Do not read env. Do not claim a run. Do not apply.

// ── 1. Say whether this capability is actually on ─────────

export function sayWhetherThisCapabilityIsActuallyOn(input: {
  required_configuration_present: boolean
  deployment_gate: boolean
  owner_intent: boolean
}): WhetherThisCapabilityIsActuallyOn {
  const reasons: string[] = []
  if (!input.required_configuration_present) {
    reasons.push("required_configuration_missing")
  }
  if (!input.deployment_gate) {
    reasons.push("deployment_gate_disabled")
  }
  if (!input.owner_intent) {
    reasons.push("owner_intent_disabled")
  }
  return {
    env_configured: input.required_configuration_present,
    env_enabled: input.deployment_gate,
    owner_enabled: input.owner_intent,
    effective_enabled:
      input.required_configuration_present &&
      input.deployment_gate &&
      input.owner_intent,
    reasons,
  }
}
```

Read the unused path out loud: *Someone already decided the three answers. AND them. If credentials are missing, say so. If the deploy gate is off, say so. If the owner did not say yes, say so. Keep every reason, not just the first. The capability is on only when all three are true. This file never reads `BEST_RELOCATION_INGEST_ENABLED`. This file never skips a run. Live Best Relocation ANDs env plus application and writes `DEPLOYMENT_GATE_DISABLED`. Live heartbeat first-fails `environment_disabled` / `application_disabled` / `not_due`. Live Granot evaluates ten flags and eight effect gates. Live Reporting and Sheet Sync read their own env. None of them walk through here.*

That is the operation. `resolveEffectiveCapability` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file has no runtime caller.** Live Best Relocation leftover `deploymentGateEnabled` reads `BEST_RELOCATION_INGEST_ENABLED` and leftover `isConnectionApplicationEnabled` reads `application_enabled`. Leftover cron leftover `ingestionHeartbeatSkipReason` first-fails `environment_disabled` then `application_disabled` then `not_due`. Live Granot leftover `getGranotLifecycleFlags` plus leftover `EFFECT_GATE_NAMES` are ten flags and eight gates. Live Reporting leftover `REPORTING_GOOGLE_DELIVERY_ENABLED` and leftover live-test OAuth stay in config. Live Sheet Sync is a tri-state mode. Do not silently wrap those readers with `sayWhetherThisCapabilityIsActuallyOn` so “one AND owns the company” — leftover heartbeat would lose first-fail and leftover Granot would lose eight gates. Do not delete the export so “nothing imports it.”

2. **Input names and snapshot names disagree.** Caller says `required_configuration_present` / `deployment_gate` / `owner_intent`. Snapshot says `env_configured` / `env_enabled` / `owner_enabled`. The story should keep one vocabulary on the **interface**. Do not silently rename persisted snapshot fields on skipped `types.ts` in this pass without an **interface** proof. Do not add a second mapping layer so “both names stay.”

3. **Reasons collect every miss; live skip codes take the first.** Two false inputs yield two reasons, in config → gate → owner order. Leftover heartbeat returns one string. Leftover worker skip writes one `DEPLOYMENT_GATE_DISABLED` for env **or** application. Do not silently change this file to first-fail so “it matches leftover cron.” Do not silently change leftover cron to collect-all so “the unused helper becomes true.”

4. **The folder test is one happy AND and one missing-config refuse.** It never proves a disabled deploy gate, a disabled owner intent, two reasons at once, or reason order. Add **interface** proofs of this file; do not treat the one `required_configuration_missing` assert as this **interface**.

5. **The third gate has no live three-way analog.** Best Relocation is env + application (two). Heartbeat adds `not_due` (time, not owner intent). Granot is ten flags / eight gates. Reporting live-test is “enabled plus named env present, and no service account.” Do not invent a live `owner_intent` reader here so “the third boolean finds a home.” Do not map leftover `application_enabled` onto `owner_intent` so “two becomes three.”

6. **Reason strings are not later structural codes.** Later `providerRetry.ts` matches `CHECKSUM_MISMATCH` by code and leftover `ChecksumMismatchError` by name. These reasons are lowercase underscored phrases. Leftover worker skip is `DEPLOYMENT_GATE_DISABLED`. Do not silently add these strings to later `providerRetry` so “one structural list owns every refuse.” Leave that for the later pass.

7. **Later schema has no capability nest.** Later `durableRunControlFields` stores lease, cursor, counters, and failure. Do not add `effective_enabled` there so “the run owns the gate.”

8. **Leave sibling modules alone.** Skipped `types.ts` owns the snapshot type. Already-recommended leftover `ingestion/worker.ts` owns leftover `deploymentGateEnabled`. Leftover Wave B cron owns leftover first-fail. Wave B `granotLifecycle.ts` owns ten flags. Already-recommended leftover `sourcePolicy.ts` owns eight gates. Do not open those as a second recommendation this pass.

## Testing

The **interface** is the test surface: `sayWhetherThisCapabilityIsActuallyOn`.

Today’s folder test **asks** the old name twice. That is not enough for a story that claims three independent gates.

Add tests that name the operation:

**Say whether this capability is actually on**
- All three true → `effective_enabled: true`, `reasons: []`, the three echoes true.
- Missing credentials only → `effective_enabled: false`, `reasons: ["required_configuration_missing"]`, `env_configured: false`, the other two echoes true.
- Deploy gate off only → `reasons: ["deployment_gate_disabled"]`, `env_enabled: false`.
- Owner intent off only → `reasons: ["owner_intent_disabled"]`, `owner_enabled: false`.
- Credentials missing **and** deploy gate off → both reasons, config first, then gate. `effective_enabled` false.
- All three false → three reasons in config → gate → owner order.
- The function does **not** read `process.env`. A test that stubs env is testing past this **interface**.

**Out of scope for this interface**
- This file does not import `IngestionRun` / `ReportingRun` / `GranotAutomationRun`.
- This file does not write leftover `DEPLOYMENT_GATE_DISABLED`.
- This file does not evaluate leftover `EFFECT_GATE_NAMES`.
- This file does not claim a named-scope lease.
- This file does not pick `SHEET_SYNC_MODE`.

Do **not** add a test per reason-string constant. Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The one export stays exported because already-judged three answers vs this AND is the **interface**, not a test leak. There is no second **adapter** until a runtime caller appears.

## What I would not do

- A `DurableCapabilityService` / `DurableWorkService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap the same three-boolean AND.
- Moving this into a CRUD folder (`resolve.ts` / `create.ts`) for cleanliness.
- Breaking the collect-every-reason **seam**. A later caller must see every miss, not only the first.
- Treating leftover `deploymentGateEnabled`, leftover `ingestionHeartbeatSkipReason`, leftover `getGranotLifecycleFlags`, leftover `EFFECT_GATE_NAMES`, leftover `getSheetSyncMode`, or leftover live-test prerequisites as this story.
- Inventing an env **seam** that has only `BEST_RELOCATION_INGEST_ENABLED` as an **adapter**.
- Silently wrapping live workers / cron / Granot flags / Reporting live-test with this AND, silently first-failing the reasons, or silently adding a capability nest to later `schema.ts`.
- Jumping to `schema.ts` before this file is on the checklist.
- Writing a whole-folder recommendation for `durableWork`.
