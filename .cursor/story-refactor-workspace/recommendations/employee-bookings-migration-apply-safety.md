# Say Whether This CLI May Write To The Already-Connected Database — Treat `--apply` As The Write Request, Then Allow The Test Lab Only On testvantagemovers, Else Require The Dedicated Live-Apply Flag Plus `--confirm-<live>-db=vantagemovers` And Connected Name `vantagemovers` — Never Treat An Incidental `--apply` As Live Authorization, Never Use The Configured Name, Never Load Mongo, Never Inspect Collisions, Never Review A Manifest — operational story

- Status: recommended
- Service: `employeeBookings` (Wave A, visited after this pass)
- Pass: 9 of this service — `migrationApplySafety.ts`
- Remaining in this service: none — service visited
- Target: `src/services/employeeBookings/migrationApplySafety.ts`
- Knowledge: [`docs/knowledge/services/employee-bookings.md`](../../../docs/knowledge/services/employee-bookings.md) does **not** name this file in `applies_to` — do not invent a second Service. Closest: [`operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (“Inventory and migration scripts are deterministic, redacted, dry-run first, [live-database] guarded, and never access historical models”; “Every [live] M2–M5 apply must name the exact reviewed dry-run manifest”). Unique-index apply lives on [`bookings.md`](../../../docs/knowledge/services/bookings.md). This checkout’s `CONTEXT.md` defines `employee booking submission`, `booking lead reconciliation case`, `employee booking origin`, and `matching unavailable` — those are not this fence; do not invent a glossary term for “live apply.” `docs/adr/` is absent here — do not invent ADR copies. This authorize is **not** Book The Employee Job, **not** rematch, **not** sibling identity-collision inspect, **not** “may I even look at this database,” **not** “name the reviewed dry-run manifest,” and **not** Granot `--confirm=<name>` / historical-consolidation apply.
- Callers: four Operations Registry CLIs only — `scripts/migrations/operations-registry-agent-merchant-compatibility.ts` (M2), `operations-registry-source-granularities.ts` (M3), `operations-registry-cpl-schedules.ts` (M4), `operations-registry-ringcentral.ts` (M5). Each asks `isMigrationApplyRequested(process.argv)` to choose dry-run vs write, then `assertMigrationApplyAuthorized({ args, testMode: isTestMode(), selectedDatabase: mongoose.connection.db?.databaseName })` **only when** `--apply` is present. Their `*.test.ts` files assert the CLI source still imports both names. Barrel `employeeBookings/index.ts` does **not** re-export this file. Submit, desk, attach, rematch, policy, and sibling preflight do **not** import this file. Inventory refuses `--apply` entirely and does **not** import this file.
- Seams callers need: asked-to-write vs authorized-to-write-on-this-connected-database. Test-lab short-circuit vs live-database keys. There is no Mongo load **adapter**, no collision-inspect **adapter**, and no index-apply **adapter**. Sibling `assertMigrationDatabaseAllowed` (look, including dry-run on live) and `assertReviewedDryRunManifest` (M2–M5 extra key) are other fences. Sibling `migrationPreflight.ts` is a different question (may we lock identities).
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts` / `authorize.ts`. Identity inspect, database-allowed, reviewed-manifest, Granot confirm, and historical-consolidation apply stay siblings / other services / other scripts.

`assertMigrationApplyAuthorized` / `isMigrationApplyRequested` are executor mechanics. The owner question is: *Someone already connected Mongo and already decided they want to write. `--apply` means “I asked to write.” That flag alone must not enable a live `vantagemovers` write — an incidental `--apply` in argv is the accident this file exists to stop. TEST_MODE pointed at connected `testvantagemovers` may write. Live `vantagemovers` may write only when argv also has the dedicated live-apply flag and `--confirm-<live>-db=vantagemovers`, and the connected name is exactly `vantagemovers`. TEST_MODE pointed at `vantagemovers` still needs those two live keys. The selected name is Mongo’s connected database, not the configured name. This file does not connect. This file does not inspect collisions. This file does not apply indexes. This file does not refuse historical for dry-run. This file does not review a dry-run manifest.*

## What this file actually does

Two operations of one “say whether this CLI may write to the already-connected database” story, not “a CRUD safety helper,” and not Book The Employee Job:

1. **Say whether someone asked to write** — true only when argv includes `--apply`. The dedicated live-apply flag is **not** a write request. Missing `--apply` is dry-run. Callers branch on this **seam** before they ask authorize.
2. **Refuse a live-database write unless the two live keys and the connected name agree** — if `testMode` and connected name is `testvantagemovers`, return. Otherwise require both the dedicated live-apply flag **and** `--confirm-<live>-db=vantagemovers`, then require connected name `vantagemovers`. Missing either key throws the “requires both flags” sentence. Wrong or unknown connected name throws “connected database is …, expected vantagemovers.”

Asking is not authorizing. Authorizing is not connecting. Connecting, looking at a live database on dry-run, reviewing a manifest, and inspecting identity collisions are other files. This file never writes Mongo, never POSTs Granot, and never creates an index.

## Organization

Keep one file. This is the screenplay for “may this CLI write to the already-connected database.” `isTestMode()` already lives on `config/domain/runtime.ts`. Connected name already comes from `mongoose.connection.db?.databaseName` after `connectMongo`. “May I look at this database” already lives on `scripts/migrations/operations-registry-migration.lib.ts` (`assertMigrationDatabaseAllowed`). “Name the reviewed dry-run” already lives on the same lib (`assertReviewedDryRunManifest`). Identity collisions already live on sibling `migrationPreflight.ts`. Do not pull those in. Do not invent a `MigrationApplySafetyService` class. Do not invent a connect / inspect / apply-index **seam** — nobody fetches or writes here.

Do not split this 39-line file. Asked-to-write and authorized-to-write are two **seams** on one apply story, not two folders.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `isMigrationApplyRequested` | `someoneAskedThisCliToWrite` | dry-run vs write; `--apply` only — the live-apply flag must not flip this |
| `assertMigrationApplyAuthorized` | `refuseUnlessThisConnectedDatabaseMayBeWritten` | once asked, the test lab or the two live keys plus connected `vantagemovers` |

Keep the old names as one-line aliases until the four Registry CLIs migrate. Do not make callers learn `assertAuthorized` or `isRequested` as the domain language.

`MigrationApplyAuthorizationInput` is the handoff bag. Keep the old type name as an alias.

**No class for the workflow.** The one type that earns a name is the already-connected ask:

```ts
type AlreadyConnectedApplyAsk = {
  args: readonly string[]
  testMode: boolean
  selectedDatabase: string | undefined
}
```

That is the handoff from “the CLI connected and wants to write” to “may it.” Today’s `MigrationApplyAuthorizationInput` is that bag. Do not add `connectedByConfigName` so “we can fall back to `.env`.” Do not add `reviewedManifestPath` so “authorize can also review.”

Leave `isTestMode` on runtime config. Leave `assertMigrationDatabaseAllowed` / `assertReviewedDryRunManifest` / `the live-db confirm-token constant` on the Registry migration lib. Leave identity inspect on the sibling. Leave Granot `--confirm=<name>` on the Granot migration lib. Leave historical-consolidation apply on `historicalConsolidation/targetGuard.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// migrationApplySafety.ts
// Someone already connected Mongo.
// `--apply` means they asked to write.
// That flag alone must not enable a live vantagemovers write.
// TEST_MODE on connected testvantagemovers may write.
// Live vantagemovers may write only with the dedicated
// live-apply flag, --confirm-<live>-db=vantagemovers,
// and connected name vantagemovers.
// TEST_MODE pointed at vantagemovers still needs those keys.
// The selected name is the connected database, not .env.
// Connecting, looking, reviewing a manifest, and inspecting
// collisions are other files.

// ── 1. Say whether someone asked to write ─────────────────

export function someoneAskedThisCliToWrite(args)
  // true only when args includes `--apply`
  // the dedicated live-apply flag is not a write request

// ── 2. Refuse unless this connected database may be written

export function refuseUnlessThisConnectedDatabaseMayBeWritten({
  args,
  testMode,
  selectedDatabase,
})
  // test lab: testMode && selectedDatabase === "testvantagemovers" → allow
  // else require dedicated live-apply flag AND --confirm-<live>-db=vantagemovers
  // else require selectedDatabase === "vantagemovers"
  // missing keys → "requires --<live>-apply --confirm-<live>-db=vantagemovers"
  // wrong / missing name → "connected database is <name|unknown>, expected vantagemovers"

function thisIsTheTestLab(testMode, selectedDatabase)
  // both must be true — TEST_MODE on live is not the lab

function argvHasBothLiveKeys(args)
  // dedicated live-apply flag AND exact confirm token
```

Read the path out loud: *The CLI already connected. If argv has `--apply`, they asked to write — otherwise this is a dry-run and this file is not asked. If they asked, and TEST_MODE is on, and the connected name is `testvantagemovers`, let them write. If they asked and the connected name is live `vantagemovers`, refuse unless argv also has the dedicated live-apply flag and `--confirm-<live>-db=vantagemovers`. TEST_MODE pointed at `vantagemovers` is not a bypass. A connected name that is not `vantagemovers` is a refuse even when both live keys are present. An incidental `--apply` without the dedicated live-apply flag is a refuse on anything that is not the test lab. Then stop. Never connect. Never inspect collisions. Never apply indexes. Never review a dry-run manifest. Never refuse historical for a dry-run look — that is the other fence.*

That is the operation. `assertMigrationApplyAuthorized` is not.

The four Registry CLIs already sit this file next to `assertMigrationDatabaseAllowed` (look) and, on live apply, `assertReviewedDryRunManifest` (the extra M2–M5 key). Sibling preflight inspects identities and never imports this file. Inventory is read-only and refuses `--apply` in its own lib.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file lives under `employeeBookings` and has no employee-booking caller.** Four Registry CLIs import it. The barrel does not export it. Submit / desk / rematch / preflight never ask it. Leave that honest. Do not invent an employee unique-index CLI so “the folder matches,” or move the file into `scripts/migrations/` in this rename so “scripts own scripts,” or pull it into `operationsRegistry/` so “Registry owns migrations.” A later home is a later pass.

2. **`--apply` is not the live key.** The comment is the story: an incidental `--apply` must not enable a live write. `someoneAskedThisCliToWrite` is that incidental flag. Authorize requires the dedicated live-apply flag plus the confirm token. Do not OR the live-apply flag into “requested” so “either flag writes.” Do not drop `--apply` so “the live-apply flag is enough to write.” Do not treat `--apply --confirm-<live>-db=vantagemovers` without the dedicated live-apply flag as authorized.

3. **The dedicated live-apply flag alone is not a write request.** Callers who see only that flag stay on dry-run and never call authorize. Do not flip “requested” on that flag so “they clearly meant apply.”

4. **TEST_MODE + `testvantagemovers` short-circuits before flags.** The test lab may `--apply` without live keys. Do not require the live keys on the test lab so “same keys everywhere,” or the four CLIs’ local apply path breaks.

5. **TEST_MODE + `vantagemovers` still needs the two live keys.** Test mode is not a live bypass. The third test already locks this. Do not allow `testMode: true` on any database so “TEST_MODE is always safe.”

6. **Connected name, not configured name.** The file comment says so. Callers pass `mongoose.connection.db?.databaseName` after `connectMongo`. Do not switch to `process.env` / `getSelectedDatabase()` so “we match `.env`,” or a mis-pointed connection with a live-looking config would pass.

7. **`selectedDatabase` undefined is not the test lab.** The short-circuit needs the exact string `testvantagemovers`. Undefined then fails the live keys or, if those are present, throws “unknown.” Do not treat missing name as test so “TEST_MODE implies the test DB.”

8. **This file does not refuse historical by name.** Connected `vantagemovershistorical` fails because it is not `vantagemovers` (after the live keys). Sibling `assertMigrationDatabaseAllowed` refuses historical even for a dry-run look. Do not add a historical string here so “one file owns every database refuse,” or the two fences merge.

9. **This file does not connect Mongo.** Do not import `connectMongo` so “authorize can prove the name,” or callers would connect twice and the selected-name seam would hide.

10. **This file does not review a dry-run manifest.** Sibling `assertReviewedDryRunManifest` is the M2–M5 extra key (script version, database, mapping checksum, M4 cutover). Do not import that here so “apply safety is complete,” or RingCentral’s live-account validation would look like this fence.

11. **`the live-db confirm-token constant` is duplicated** on this file and on `operations-registry-migration.lib.ts` / inventory lib. Do not import the script constant into `src/` (wrong direction). Do not move this file into `scripts/` in this pass so “DRY.” Leave the token duplicated until a later home.

12. **Callers pass `isTestMode()` in.** This file does not read the env. Do not import `isTestMode` here so “the fence owns TEST_MODE,” or a test could no longer hand a lying boolean — and the interface would stop being argv + bag.

13. **Authorize is void / throw, and callers only ask it when requested is true.** Do not make authorize also require `--apply` so “one call does both” — then a dry-run would need a different function, and the asked-to-write **seam** would disappear.

14. **`someoneAskedThisCliToWrite` is a one-liner and still a real seam.** The four CLIs branch dry-run vs write on it. Do not inline `args.includes("--apply")` in every CLI so “too thin to export,” or the incidental-flag meaning would fork.

15. **Granot `--confirm=<name>` is a different flag shape.** Lifecycle scripts confirm the connected name with `--confirm=<database-name>`. This file’s confirm token is the exact `--confirm-<live>-db=vantagemovers`. Do not accept the Granot shape so “one confirm flag,” or a Granot-style argv would authorize a Registry write.

16. **`historicalConsolidation/targetGuard.ts` is a heavier story** (manifest hash, backup id, rehearsal, human sentence). Do not merge so “all apply gates live together.”

17. **Inventory is not this story.** S0 refuses `--apply` and the live-apply flag outright. Do not import this file there so “inventory can apply.”

18. **This file does not apply indexes and does not inspect collisions.** Sibling preflight groups already-loaded identities and never authorizes `--apply`. Do not import `inspectEmployeeJobUniqueIdentities` so “apply safety is the whole migration.”

19. **Do not treat Book The Employee Job, rematch, or Granot unique-index repair as this story.** Submit 409s / 200s at write time. `granot-lifecycle-indexes` / `granot-lifecycle-unique-index-repairs` own lifecycle indexes and use the Granot confirm shape.

20. **Do not treat Sheet Sync drain or Domain Command begin / complete as this story.** There is no persist **seam**.

21. **Leave sibling modules alone.** `isTestMode`, `assertMigrationDatabaseAllowed`, `assertReviewedDryRunManifest`, `buildEmployeeBookingMigrationReport`, and `assertApplyAuthorized` stay where they are. This file asks and refuses.

## Testing

The **interface** is the test surface: `someoneAskedThisCliToWrite`, `refuseUnlessThisConnectedDatabaseMayBeWritten`.

Today’s `migrationApplySafety.test.ts` already names the five authorize beats: test-lab `--apply` allowed; live `--apply` alone refused; TEST_MODE on `vantagemovers` refused without live keys; both live keys on the wrong connected name refused; both live keys on `vantagemovers` allowed. That is the right authorize story. Add the asked-to-write beats the current file only half-covers (`isMigrationApplyRequested(["--apply"])` is true; the live-apply flag alone is never asserted).

Replace executor names with tests that name the operation:

**Asked to write**
- `--apply` → asked.
- dedicated live-apply flag only → not asked.
- empty argv → not asked.
- `--apply` plus live keys → still asked (authorize is the next beat).

**Refuse unless this connected database may be written**
- TEST_MODE + connected `testvantagemovers` + `--apply` only → allow.
- not TEST_MODE + connected `vantagemovers` + `--apply` only → refuse (incidental apply).
- TEST_MODE + connected `vantagemovers` + `--apply` only → refuse (test mode is not a live bypass).
- both live keys + connected `testvantagemovers` + not TEST_MODE → refuse (wrong connected name).
- both live keys + connected `vantagemovers` → allow.
- both live keys + `selectedDatabase` undefined → refuse (“unknown”).
- `--apply` + confirm token, missing dedicated live-apply flag, connected `vantagemovers` → refuse.

**Refuse is not**
- Does not connect Mongo. Does not inspect collisions. Does not apply an index. Does not read `isTestMode()` from the env. Does not accept `--confirm=<name> vantagemovers` as this confirm token. Does not review a dry-run manifest.

Do **not** add a test per helper (`thisIsTheTestLab`, `argvHasBothLiveKeys`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

CLI source-import tests (`assert.match(cliSource, /assertMigrationApplyAuthorized/)`) stay on the four script files. They prove the **adapter** still asks this interface. They are not this file’s test surface.

## What I would not do

- A `MigrationApplySafetyService` class with `isRequested` / `assertAuthorized`.
- Thirty two-line functions that only wrap `args.includes`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or `authorize.ts`.
- Inventing a Mongo connect **adapter**, a collision-inspect **adapter**, or an index-apply **adapter** so “apply safety is complete.”
- Merging this with sibling `migrationPreflight.ts`, with `assertMigrationDatabaseAllowed`, with `assertReviewedDryRunManifest`, with Granot `--confirm=<name>`, or with `historicalConsolidation/targetGuard.ts`.
- Treating `--apply` as live authorization, or the dedicated live-apply flag as a write request.
- Allowing TEST_MODE on `vantagemovers` without the two live keys.
- Switching the selected name to the configured database.
- Importing a `scripts/` constant into `src/`, or moving this file in this rename.
- Treating Book The Employee Job, rematch, Granot index repair, or Registry inventory as this story.
- Opening Wave B. `employeeBookings` is visited after this pass; next Wave A service is `domainCommands` (unvisited — enumerate first).
