# Trace one Granot automation action

Use this local read when you have the run ID and the exact action ID from an authorized operator. Start at the repository root with Node and dependencies installed with `pnpm install --frozen-lockfile`. Discovery works before Mongo is running.

```powershell
pnpm vantage -- services
pnpm vantage -- runbook granot
```

Set the three variables to the supplied values, keeping spaces and punctuation in the action ID. The run ID is 24 hexadecimal characters. A single-quoted PowerShell string preserves dollar signs and spaces. Use a doubled apostrophe for an apostrophe in a value. The CLI never echoes the action ID, which can contain a source label.

```powershell
$traceRun = '000000000000000000000001'
$traceAction = 'Synthetic source:followUpEstimates:1'
$traceProfile = 'granot-rehearsal'
pnpm --silent vantage -- granot trace --run $traceRun --action $traceAction --target local --profile $traceProfile --json
```

`granot-rehearsal` selects the disposable `testvantagemovers_granot_trace` database. `agent` selects `testvantagemovers_agent`. Both require the writable primary of the single-member `rs0` replica at `127.0.0.1:27017`. Check the returned identity. The CLI opens its own direct local connection and ignores application connection settings. It never starts a worker. Production targets exit 4 before opening a connection. There is no production adapter. A production adapter would require a separately reviewed deployment-bound identity, allowlist and read permissions.

## Read the result

1. `run` reports the workflow, lock time, original expiry and approval time. `checksum_matches` compares the saved approval and sealed-plan checksum fields. Recomputing the checksum would require reading the full plan. Actor identity, permissions at approval time and payload hash equality are outside the projection. `action` reports exact selected membership and whether the stored operation ID agrees with the requested pair. If the run checkpoint is absent after interrupted apply, the same operation key and kind can locate a candidate receipt. The trace stops at `operation_key_correlation_only`. It cannot verify payload equality. An idempotency conflict, invalid required checkpoint pointer, or mismatched operation kind also stops the walk.
2. `action.recorded_*` is the collector checkpoint. The lifecycle receipt is independently linked by the exact channel and operation. For Estimates, `matches_sealed_capture_time` compares the receipt timestamp with the stored action capture time when both exist. The Observation links by receipt ID, and its Decision must match both the receipt's latest Decision pointer and the Observation ID. A later match attempt or reconciliation may move that pointer before the collector updates its checkpoint. `matches_run_checkpoint: false` reports this difference. `accepted_for_processing` is pending evidence, even when a later linked Decision already exists.
3. `decision` gives the stored execution mode, outcome, reason, target and deduplicated effect kinds. A target is an identity match. For a live Decision, `target_lead_effect_kinds` gives the recorded Lead creation/update kinds whose reference matches that exact model and ID. Other effect kinds may refer to a sibling or another resource. A shadow Decision or an `already_current` outcome does not prove a Lead update. Matching a field on the Lead cannot establish which command wrote it. This trace does not read change history or delivery receipts.
4. `lead` is the canonical Form Lead or Call Lead read at inspection time. Compare the traced Observation with its current accepted winner using capture time and then Observation ID. `same` identifies the same tuple, `older` means a later tuple now wins, `newer` means this Observation is ahead of the stored tuple, and `unknown` means at least one tuple is missing. `certified_for_this_decision` requires the same winner plus the current Lead's version-2 accepted evidence for the same receipt, live Decision and outcome. Historical decisions survive later winners.

`status: traced` means the linked Lead could be read. `partial` and `stop` identify the first missing, inapplicable or inconsistent edge. Pending or non-Lead Decisions can legitimately end before a Lead. Missing run history can reflect purge. An absent pointer remains unknown. A pointer mismatch stops the walk. Reads are sequential and can straddle a new decision or Lead update. Repeating the same command can show a new current winner. Neither status authorizes replay, mutation or billing.

## Collection, retries and original expiry

The collector holds the account lease during collection, seals a schema-v2 plan, and records approval of the selected actions. Each action's immutable operation key is the run ID joined to the action ID. The run worker captures through the shared lifecycle service. A queue message or recovery heartbeat wakes work. A due receipt claim and its lease fence control processing. A pending match follows the receipt's captured-time schedule through the 24-hour match window. Compare the reported next attempt and lease times with current UTC. A terminal Decision can already exist while the collector still shows a pending checkpoint.

The plan expires 24 hours after run creation. The original expiry closes further execution from that plan, including unstarted actions after partial apply. Captured lifecycle evidence keeps its own processing history. A run document may later disappear at its purge deadline. Never extend the clock or issue a new apply to fill a trace gap. Preview and unselected actions provide no approval. Official Booking and Cancellation outcomes and RingCentral Call admission have separate authorities. [Collector contract](../knowledge/services/granot-http-collector.md) · [Receipt processing and scheduler](../knowledge/granot-lifecycle/drainer.md) · [Domain commands](../knowledge/services/domain-commands.md)

## Read boundaries and exits

At most five indexed Mongo reads return one scalar projection apiece, excluding the initial identity handshake. Each read has a two-second server deadline and disables disk spill. Only the selected action and its checkpoint are examined within one run; Mongo may traverse that run's embedded arrays. The CLI fetches no full run, payload, plan row, contact, command body or provider response. String statuses, reasons and effect kinds use closed vocabularies. The two secondary lookups require the shipped channel/operation and receipt-ID indexes. A failed query returns a redacted error. The authenticated Owner run detail and authorized Lead lifecycle timeline supply the read vocabulary. The local projection narrows both to one chain, without opening either broader HTTP response. [Authenticated run and Lead reads](../knowledge/granot-lifecycle/projections.md)

Exit 0 means the bounded read completed, including a partial result. Exit 2 indicates invalid input. Exit 3 means the identity check, permission or query failed. Verify the target/profile, local primary and existing read access. Exit 4 indicates an unsupported production target. Discovery is read-only. There are no repair or scheduling commands for Granot.

## Reproduce the diagnostic tests

The fast test checks discovery, identifier limits and target refusal. The explicit replica test creates synthetic records in the fixed rehearsal database, monitors every Mongo read, exercises conflicting pointers and removes only its own generated records. Use a running local rehearsal replica.

```powershell
node --import tsx --test ops/vantage/granot-trace.test.ts ops/vantage/granot-trace.replica.ts
```

To prepare an independent onboarding exercise, the coordinator can run `node --import tsx ops/vantage/granot-fixture.ts`. This separate fixture writer inserts a fresh synthetic history and prints its local profile, run ID and exact action ID. It does not call providers. Give the operator those inputs and the checkout. The scenario tests evidence interpretation. The canonical lifecycle qualification exercises actual processor and command writes separately.
