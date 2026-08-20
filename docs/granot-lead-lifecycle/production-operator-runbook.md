# Granot Lead Lifecycle production operator runbook

This is an instruction set, not evidence that production is enabled. Unit 31
authorizes only redacted synthetic work against a confirmed disposable replica.
Production report, apply, deploy, flag/Registry mutation, activation, Owner
command, external send, or current-payload access each requires separate exact
authorization.

## Preflight

Record repository commits/dirty state, target database name and mode, Mongo
replica-set identity, lifecycle collection names, Sheet Sync mode, observability
notification mode, RingCentral collection/write mode, queue/provider isolation,
all ten lifecycle flags, and activation presence/cutoff. Never record a secret,
connection string, raw receipt field, contact, address, Job Number, provider
body, cookie, or authorization header.

Checked-in defaults are processing `true`, shadow `true`, and Lead writes,
creation, Booking cases/commands, Release cases/commands, Referral Booking, and
email all `false`. Activation is Owner-only, audited, write-once, and is never
edited or deleted.

## Migration and index gate

Run every fixed Unit 31 command in `scripts/migrations/README.md` in report ->
review -> separately authorized apply -> verify order. Repeat to prove no-op
idempotency. Stop on unknown database, mismatch, collision, non-idempotency,
unsafe manifest, or verification drift. Never drop or replace an index
automatically. Owner-gated one-shots in that README (inbound job-prefix
repair and owner booking-case intake) are not the Unit 31 package; each
needs its own report → review → separately authorized apply cycle.

Source Registry classification uses that README's guarded
`migration:granot-lifecycle:sources` flow. Production `vantagemovers` already
applied `--scope=link_only_automation_sources` for Main Site, TBM, TBM Prime,
Top10, and 10best. Do not repeat it without new authorization. Those families
remain `link_only`; WordPress and RingCentral still create their Leads.

Indexes precede their consumers. Required unique definitions include the
RingCentral Call Log singleton, processed-call telephony/call-log identities,
command ID/idempotency, one Booking per normalized Job, and every open/sequence
case/discrepancy fence.

## Historical shadow certification

Run bounded ascending-ObjectId batches with `granot:lifecycle:shadow`. Resume
from the private checkpoint; an explicit `--after-id` is exclusive and cannot
move behind it. Only pre-activation work is eligible. A historical Decision may
create Observation/Decision and safe job-level Record Link evidence; it may not
change Leads, Bookings, Cancellations, revisions, cases, discrepancies,
Commands, Changes, Sheet work, notifications, Registry/activation, or provider
state. A technical failure is not a business Decision. Run
`granot:lifecycle:certify` after the fixed migration cycles.

## Staged rollout order

1. processing in shadow;
2. one reviewed matched-Lead write source;
3. creation source-by-source;
4. RingCentral adoption, then leased 30-minute cadence;
5. Booking case reads, then Booking commands;
6. Release case reads, then Release commands;
7. Referral Booking;
8. discrepancies and Record Link correction;
9. optional email last (remains false for this delivery).

Deploy read/processing capability before enabling each narrow flag. Inspect
bounded causal Receipt -> Observation -> Decision -> Command -> Change/outbox
references and Mongo-backed health for at least one normal operating interval.

## Thresholds and stop conditions

The seven thresholds are: oldest due over 15 minutes continuously for 10
minutes; any dead letter; any capture 503 in 24 hours; more than five claim
recoveries/hour; p95 capture-to-decision over 10 minutes/24 hours; RingCentral
lease held over 10 minutes; enabled-source ambiguity/policy-blocked rate over
5%/24 hours. Inspect bounded codes/counts/masked IDs only.

Stop on a secret/raw-data finding, source reassignment, duplicate Booking,
unexplained aggregate mutation, missing causal reference, queue-age breach,
repeated dead letter, false RingCentral duplicate, case concurrency violation,
index drift/collision, or external call during certification.

## Read-only verification and rollback

Production verification is read-only unless separately authorized and uses
metrics, counts, and masked causal IDs—never payload/contact. Roll back the
narrow effect first, set shadow true, stop the historical runner/certification
caller, and keep capture active. Preserve receipts, Observations, Decisions,
activation, Registry/audits, links/history, aggregates, cases/discrepancies,
Commands, Changes, revisions, outbox, RingCentral state, Operational Events,
incidents, manifests, and checkpoints. Any unset, repair, or index change is a
new report-first authorized procedure; never delete evidence, rewrite
activation, decrement revisions, or compensate official facts automatically.

Public manifests intentionally contain masked identifiers and cannot drive a
rollback. Before any separately authorized rollback, bind the exact target to
a fresh deterministic database re-scan and compare its count and canonical
hash with the original manifest. Refuse missing, ambiguous, or changed targets;
do not emit raw identifiers to make a public artifact executable.
