# Pool read evidence and GET-only reproducers

> **October 14 local continuation:** live Pool discovery and the shared-duty prototype are now complete. Use [current findings](POOL-FINDINGS-2026-10-14.md) and [current approval proposal](POOL-APPROVAL-2026-10-14.md). They supersede the historical access blockers, collection scope and unresolved code9 meaning below. Production Pool implementation remains gated.

These scripts preserve the coordinator's actual Phase 2 read method, separately from the Granot parser/matching prototype under `ops/pool-prototype/`. They perform Owner-signed GETs against the fixed deployed server API. They do not connect to Mongo, log into Granot, start/drain workers, submit POST/PATCH requests or change production data. No Pool feature or reconciliation is implemented.

## Recorded observations

The original API-surface and canonical inventory runs are retained as [read-api-surface.json](evidence/phase2/read-api-surface.json) and [canonical-priority9-collisions.json](evidence/phase2/canonical-priority9-collisions.json). The reproduced corpus is **canonical stored priority 9, not actual current-month Granot Pool membership**. No live Granot Pool form, selector or report rows were fetched by these reads.

The canonical inventory completed its observed passes from `2026-10-14T03:26:37.716080+00:00` to `2026-10-14T03:27:04.387627+00:00`, using offset pagination, `createdAt` ascending, page size 250 and both duplicate passes for each Lead model:

| Scope | Pages | Reported total / received / unique ids |
| --- | --- | --- |
| Form Lead, duplicate=false | 29 | 7,057 / 7,057 / 7,057 |
| Form Lead, duplicate=true | 1 | 166 / 166 / 166 |
| Call Lead, duplicate=false | 7 | 1,556 / 1,556 / 1,556 |
| Call Lead, duplicate=true | 2 | 290 / 290 / 290 |
| Booking, cancelled=false presence-filter subset | 4 | 896 / 896 / 896 |

Deduplicating by canonical model/id yielded **9,069 observed Leads**. Stored priority 9 appeared on **326 Form Leads and 14 Call Leads**, with **340 distinct normalized Job keys**, no missing Job, and 340 unique exact Lead matches within this observed Lead corpus. No cross-model/multiple exact matches, digit-core aliases, other-priority collisions or observed Booking anchors were found for those keys. This is not a globally complete Booking-absence or safe-creation assertion.

Canonical priority-9 flags were **339 assigned and one unassigned**, with zero returned duplicate, bad, cancelled, unmatched-creation, manual receiver, no_sync:true, attached booked or normalization-disagreement flags. Wider Lead inventory unusual-Unicode Job and raw/stored normalization-disagreement counts were both **zero**. The no_sync flag records only exact `true`; its false value can represent explicit false, absent or null and does not prove that the raw field was explicitly false. None of those states proves a prior Master Leads write; prior Sheet write remains unknown. Populated null references can hide raw dangling pointers, so zero returned `booked` cannot establish that no pointer exists.

## Booking error and corrected scope

The first full Booking browse failed with **HTTP 500**, with the literal error fragment **`Cast to ObjectId failed for value "true"`** in the `CancelledLead` population path. This is a legacy Boolean cancellation-reference/read-path failure, not a Pool row or customer value. No raw error/customer payload is retained, and no data repair was attempted.

The subsequent `cancelled=false` pass is **not all uncancelled Bookings**. The current API Boolean presence filter matches only missing/null `cancelled`; it excludes legacy `false` as well as non-null cancelled references. The corrected recorded inventory therefore consists of **896 missing/null-cancellation browse rows plus six additional Lead-attached populated Booking anchors, 902 known unique Booking ids**. Other unlinked cancelled/job-only anchors and legacy true/false rows can be missing. **Full Booking coverage is incomplete.** The stored report's `observed_complete:true` on the Booking pass means its received counts reconcile to that restricted API subset, never to all Bookings.

The new reproducer encodes those corrections directly. It records a one-row full-browse probe status and only recognizes the known non-customer literal-true cast signature. It then always enumerates the restricted missing/null Booking subset and adds minimal populated Lead-attached anchors. It reports `booking_browse_unique_ids`, `additional_lead_attached_booking_anchors`, the combined `booking_count` and `booking_inventory_complete:false`, even when every execution step finishes. If a future full-browse sample succeeds, that one-row probe still does not enumerate all Bookings or establish full coverage.

Booking examples now label **`official_anchor_eligibility`** as advisory Pool identity evidence. Linked, clean intentional referral and qualifying leadless facts are recognized anchors; any residual/partial raw Lead pointer is a Pool identity hold, reported as `held_partial_pointer` and `pool_identity_hold:true`. This does not evaluate or redefine financial official referral allocation credit. The current measured priority-9 corpus had zero observed Booking anchors, so this label clarification changes none of its recorded counts. Population-hidden absence remains unproved.

## Execution and privacy boundaries

- [api_read.py](../../ops/pool-read-evidence/api_read.py) probes the four Lead duplicate scopes and at most the **latest 100 stored automation run records**. It retains counts, top-level/plan field names and safe operation/workflow/status metadata only. It does not retain plan actions, receipts, contacts, money, run ids or a raw date-window object. The recorded completed Estimates detail had no exposed `date_window`; the repro intentionally retains that field as null. Eight returned `applying` records are stored statuses, not proof of active leases/workers. Absence from this bounded list cannot prove no other run, no Pool activity or system-wide quiescence.
- [canonical_inventory.py](../../ops/pool-read-evidence/canonical_inventory.py) executes the four full observed Lead passes and the restricted Booking pass. It retains only canonical ids, normalized Job keys, model/pointer identity and policy/eligibility flags in a **private runtime checkpoint**, never contacts, customer names, money, provider payloads or headers. Completed passes are checkpointed; an interrupted pass is re-enumerated on resume. Resumes can combine facts read at different times.
- Both CLIs require **`--run` and `--output-dir`**. The runtime directory must be outside this repository and every real Git checkout; no default output or checkpoint lives in the tracked tree. Private checkpoints and even redacted report files are created mode **0600**, with symlink writes refused. New runtime directories are created mode 0700. Do not commit the private checkpoint or copy it into an evidence directory.
- The host is fixed to `https://vantage-movers-main-server.vercel.app`. Paths are restricted to the three canonical browse endpoints and stored automation run GETs; query keys are restricted as well. Requests explicitly use GET with no body; redirects are disabled so signed headers are not forwarded elsewhere. These are runtime-bound Owner credentials in existing `VANTAGE_API_SECRET`, `VANTAGE_ADMIN_PROXY_SIGNING_SECRET`, `VANTAGE_ADMIN_USER_ID` and `VANTAGE_ADMIN_EMAIL` variables. The scripts do not read `.env`/secret files and never print header values.
- Redacted Job/entity keys use a **fresh random HMAC namespace for every report execution**, including checkpoint resumes. The namespace is not stored or printed; ids/jobs are consistently hashed within one report and do not intentionally correlate across reports. Examples are capped at 25 while counters use all retained observed records.
- `execution_complete` means all intended read steps returned; it does not mean full Bookings, snapshot consistency, actual Pool discovery, safe admission or prior Sheet writes are established. Each pass separately reports total reconciliation as `observed_complete` and `point_in_time_snapshot:false`. Offset pagination with a single sort field has no immutable snapshot guarantee. HTTP/transport/shape/page-budget failures produce failure or partial status, never a successful empty/complete inventory.
- Normalization mirrors the existing canonical comparison: NFKC, Unicode Letter/Number characters retained, punctuation replaced with **spaces**, whitespace collapsed, then uppercase. Equivalent-only aliases use the separate **ASCII** `[A-Z]*([0-9]+)` digit core; punctuation is not deleted to force equivalence, and non-ASCII digits do not enter that core. The observed source unusual-Unicode count was zero; unusual inputs are nevertheless covered offline.

## Reproduction and offline verification

Only run the live commands in the managed authenticated context under the established read-only authorization. Use a new directory for a fresh enumeration, or the same directory to resume previously completed passes. The private cache is `canonical-inventory-private-checkpoint.json`; incompatible format/scope or insecure permissions are refused. No production re-fetch was performed when refactoring or validating these scripts.

```sh
python3 ops/pool-read-evidence/api_read.py --run --output-dir /workspace/work/pool-read-evidence-run
python3 ops/pool-read-evidence/canonical_inventory.py --run --output-dir /workspace/work/pool-read-evidence-run
```

The resulting `read-api-surface.json` and `canonical-priority9-collisions.json` are redacted runtime reports. Review their flags, scopes and errors before copying those two reports into tracked documentation. The private checkpoint must stay outside Git. The recorded actual-run JSON was not overwritten by this refactor; its corrected scope and flag counts remain the authoritative observation for this handoff.

Offline commands passed **7/7 tests** and Python syntax checks:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s ops/pool-read-evidence -p 'test_*.py' -v
PYTHONPYCACHEPREFIX=/workspace/work/pool-read-evidence-pycache python3 -m py_compile \
  ops/pool-read-evidence/api_read.py \
  ops/pool-read-evidence/canonical_inventory.py \
  ops/pool-read-evidence/test_read_evidence.py
git diff --check
```

The tests cover CLI opt-in and outside-Git guards, fixed GET/no-body paths/query keys and redirects, private permissions/symlink refusal, Unicode normalization and ASCII cores, literal-true error recognition, restricted Booking scope plus additional attached anchors, canonical-9 flags, fresh hash namespaces, contact/money non-retention, partial-pointer identity holds and interrupted-pass non-completion. They substitute synthetic API responses and send no network requests.

There are no database migrations, production writes, new environment variables, runtime feature controls or application changes. Removing these reproducers affects only the optional read-evidence workflow; no production rollback or canonical data reversal is required. Pool implementation/mutation approval remains outstanding.
