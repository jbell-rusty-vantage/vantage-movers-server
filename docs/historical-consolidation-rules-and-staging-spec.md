# Historical consolidation rules and staged-ingestion specification

Status: implementation-ready analysis supplement  
Generated from read-only audits on 2026-07-30

This document refines, but does not replace, the
[historical database consolidation plan](./historical-database-consolidation-plan.md).
It resolves the parsing, Customer cardinality, classification timing, exact
matching, conflict, and module-design questions left in the
[analysis handoff](./historical-consolidation-next-analysis-handoff.md).

No database or Reporting Sheet writes were made during this analysis.

## Decisions

1. Parse historical Agent labels only on `/`. It is the only observed Agent
   separator.
2. Strip recognized terminal Agent metadata (`Split` or a percentage) before
   exact Agent lookup. Do not create metadata-derived Agents.
3. Keep `BookedLead.customer` singular. Preserve a multi-name source value as
   the Customer/household display name; do not split it into Customer records.
4. Stage and resolve natural identities before calculating Duplicate Lead or
   Form Fill classifications.
5. Treat 2026-04-30 as a hard Form Lead duplicate-classification boundary:
   pre-cutoff and post-cutoff leads never make one another duplicate.
6. Preserve the existing duplicate result on matched production Form Leads at
   or after the cutoff. Classify an unmatched post-cutoff Form Lead only
   against the post-cutoff cohort using the application-owned rule.
7. Form Fill remains time-unbounded and may match across the cutoff.
8. Scope Duplicate Lead comparisons to the exact Source Granularity. A Source
   Company-only match is insufficient.
9. Allow only exact normalized names and explicit aliases to resolve Agents,
   Merchants, Source Companies, and Source Granularities. Similarity is review
   evidence, never an automatic merge.
10. Generate evidence and human decisions as separate immutable artifacts.
   Approved decisions are replayable only against the same evidence hash and
   rule version.
11. Import and invoke application-owned service/rule modules locally from this
    branch. Do not call the deployed production URL and do not reimplement
    application business rules inside migration scripts.

## New audit evidence

Reproducible artifacts:

- `scripts/historical/audit-historical-name-patterns.ts`
- `scripts/historical/reports/name-pattern-audit.md`
- `scripts/historical/reports/name-pattern-audit.json`
- `scripts/historical/audit-historical-classification-signals.ts`
- `scripts/historical/reports/classification-signal-audit.md`
- `scripts/historical/reports/classification-signal-audit.json`

The audit reads only `Booked Deals` and `Refunds`. It emits counts and source
row numbers, not raw Agent or Customer values.

Run from `vantage-main-server`:

```text
node --env-file=.env --import tsx scripts/historical/audit-historical-name-patterns.ts
node --env-file=.env --import tsx scripts/historical/audit-historical-classification-signals.ts
```

### Agent values

| Tab | Populated | `/` | `\` | `&` | `+` | comma | `and` | 3 segments | terminal `Split` | terminal `%` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Booked Deals | 4,769 | 67 | 0 | 0 | 0 | 0 | 0 | 1 | 4 | 2 |
| Refunds | 365 | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

This supports `/` as an automatic Agent separator. It does not support broad
punctuation splitting.

### Customer values

| Tab | Populated | Any signal | `/` | `\` | `&` | `+` | comma | `and` | 3 segments |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Booked Deals | 4,728 | 750 | 643 | 2 | 101 | 0 | 5 | 3 | 13 |
| Refunds | 365 | 47 | 32 | 0 | 15 | 0 | 1 | 0 | 1 |

The source has one Customer Name cell and no party roles, contact details,
ownership shares, or separate Customer identifiers. Eleven Booked Deals rows
have a candidate Customer segment equal to a known normalized Agent atom.
Those are suspicious-role cases, not evidence that every multi-name value
represents multiple Customer records.

## Parser specification

### Common output

Every parser returns a result, not a bare string array:

```ts
type ParsedNameField = {
  raw_value: string;
  display_value: string;
  tokens: string[];
  normalized_tokens: string[];
  metadata: {
    terminal_split?: true;
    terminal_percentage?: string;
  };
  disposition: "accepted" | "ambiguous" | "empty";
  reason_codes: string[];
};
```

The raw value remains in staging provenance. Reports and logs use source
provenance or case ids, not the raw value.

### Agent tokenizer

Apply these rules in order:

1. Unicode-normalize with NFKC, trim, and collapse whitespace.
2. Detect terminal metadata on the whole source value:
   - case-insensitive terminal word `Split`;
   - terminal numeric percentage from `0%` through `100%`.
3. Remove recognized terminal metadata from the parse input while retaining it
   in `metadata`.
4. Split on `/` only.
5. Trim/collapse each token.
6. Reject empty tokens produced by leading, trailing, or repeated `/`.
7. Normalize each token for identity using NFKC, trim, collapsed whitespace,
   and case folding. Preserve punctuation.
8. Remove duplicate normalized tokens while retaining first source order.
9. Resolve each token by exact normalized Agent name or an explicit alias.

Automatic acceptance requires:

- one or more non-empty tokens;
- no unrecognized suffix text;
- no empty token;
- every token resolving to exactly one Agent or to one deterministic
  migration-created inactive Agent.

Emit `ambiguous_agent_parse` when the label contains `\`, `&`, `+`, comma, or
the word `and`; when `/` is repeated; when metadata is not terminal; or when an
alias has multiple targets. The current inventory has no non-`/` Agent
separator cases, so these rules are defensive.

Never fuzzy-match Agent tokens. Existing production Agent identity and aliases
win. A missing exact Agent is created inactive in the manifest, never during
planning.

### Customer parser

Customer parsing is display normalization, not entity splitting:

1. NFKC-normalize, trim, and collapse whitespace.
2. Preserve `/`, `\`, `&`, `+`, commas, `and`, hyphens, and apostrophes in the
   display value.
3. Set pattern flags for review/analytics, but return one display value.
4. Do not strip Agent metadata from Customer text.
5. Do not resolve individual segments as Customers.

Create a review case when:

- a Customer segment exactly matches a known Agent but the complete Customer
  value does not match accepted lead/contact evidence;
- the Customer value conflicts with a non-empty production Customer name;
- duplicate booking rows for one Job Number contain incompatible Customer
  display values;
- a matched lead has materially different contact identity and neither value
  is empty.

### Exact comparison normalization

Names used for exact catalog matching use:

```text
NFKC -> trim -> collapse internal whitespace -> case fold
```

Punctuation is retained. Separator parsing happens before Agent normalization.
Do not remove punctuation globally, transliterate, apply phonetics, compare
initials, or use edit distance for an automatic write.

Explicit aliases are versioned inputs. The only confirmed Merchant alias is:

```text
Elavon CC -> Elavon
```

All other unmatched Merchant labels create inactive Merchant operations.
Similarity suggestions may appear only in conflict evidence.

## BookedLead Customer cardinality

### Decision

Do not add `customers[]` for this migration. Retain:

```text
BookedLead.customer      -> optional primary Customer reference
BookedLead.customer_name -> source-preserving Customer/household display name
```

For a name-only historical booking, create or reuse a migration Customer using
a Job-Number-scoped identity. Do not call the current name-only runtime upsert,
which globally matches `normalized_name`.

### Why

- The source records one Customer Name field, not multiple parties.
- Multi-name punctuation is common, but punctuation alone cannot distinguish
  spouses, a household label, alternate names, agents in the wrong column, or
  resubmissions.
- There is no source evidence for party roles, shares, separate contact
  identities, or a primary party.
- The production model, cancellation mirror, Customer reverse virtuals,
  booking services, admin detail/counts, search/export, Sheet projections, and
  analytics all use one Customer reference.
- A dual `customer` plus `customers[]` design would add two writable
  authorities without enough domain evidence to define synchronization.

### Compatibility rule

The source display value is preserved even when a matched lead supplies the
Customer reference. A non-empty disagreement becomes a field conflict:
production remains unchanged, historical evidence is retained, and the case
must be resolved before an update is planned.

Revisit cardinality only when a future source provides stable per-party
identifiers or roles. That would be a separate schema decision, not part of
historical consolidation.

### Affected surfaces if this decision changes later

- `src/models/BookedLead.ts`, `CancelledLead.ts`, and `Customer.ts` virtuals.
- Booking create/update, leadless/referral, customer upsert, mirror, and
  cancellation resolver/mirror modules.
- Booking and cancellation request validation.
- Google Sheets projections and shared sheet types.
- Admin browse population, Customer detail/count aggregation, global search,
  and CSV export.
- Analytics/revenue/customer aggregations and observability event identity.
- Historical relaxed schemas, reconciliation, apply, and rollback tooling.

## Agent allocation rules

For each accepted parsed Agent label:

1. Resolve tokens to canonical Agent ids in source order.
2. Require at least one distinct Agent.
3. Interpret the row binder as the total for that row.
4. Convert the total to integer cents.
5. Allocate `floor(total_cents / count)` to each Agent.
6. Give one remainder cent to each earliest source-order Agent until exhausted.
7. Require allocation cents to sum exactly to total cents.
8. Preserve parsed source order as provenance and primary-Agent behavior.

When duplicate booking rows share a Job Number:

- parse each row independently;
- union Agents by canonical Agent id in first-observed order;
- sum binder only for distinct sale/allocation rows;
- do not sum an exact resubmission;
- keep the maximum compatible repeated deposit;
- quarantine conflicting non-Agent facts;
- record which source rows contributed to each allocation.

The runtime schema accepts any non-empty allocation array, although the
convenience `agent`/`split_agent` input supports only two. Historical planning
must use the general `agent_allocations[]` shape so the observed three-Agent
row remains lossless.

Required pure tests:

- one Agent receives all cents;
- two and three Agents split even and uneven cents;
- negative and non-finite totals are rejected;
- missing binder is quarantined, not coerced to zero;
- duplicate normalized Agent tokens are de-duplicated;
- `/` parsing with whitespace;
- terminal `Split` and percentage removal;
- repeated `/` and non-observed separators are ambiguous;
- allocation sum is exact for every generated case;
- source order and case id are stable across reruns.

## Classification rule matrix

Identity resolution is distinct from business classification. Production
overlap is collapsed before the following rules run so one real event appears
once in the population.

| Classification | Population | Match key | Window | Scope | Timing | Result on ambiguity |
|---|---|---|---|---|---|---|
| Historical Form Duplicate Lead (`timestamp < cutoff`) | Canonical pre-cutoff Form Leads | normalized phone **or** normalized email against an earlier non-duplicate pre-cutoff Form Lead | no rolling window; hard upper boundary at cutoff | exact Source Granularity | chronological pass 1 | deterministic duplicate; record all matched ids |
| Modern Form Duplicate Lead (`timestamp >= cutoff`) | Post-cutoff Form Leads only | application-owned phone/email rule against the post-cutoff cohort | no pre-cutoff candidates | exact Source Granularity | preserve matched production; classify only unmatched records | cross-boundary candidate is ineligible |
| Call Duplicate Lead | Canonical Call Leads, including matched production | normalized phone against an earlier non-duplicate Call Lead | inclusive 90 days | exact Source Granularity | chronological pass 1 | deterministic duplicate; record all matched ids |
| Form Fill | Canonical Call Leads vs canonical non-duplicate Form Leads | normalized phone | none | same Source Company | pass 2, after Form Duplicate Lead | `true` when any match exists |
| Sheet Form Fill value | Source row annotation only | source cell/formula | source-defined | source tab | compare after derivation | discrepancy report; never authoritative |

### Form Lead duplicate cutoff

The cutoff is the start of the 2026-04-30 business date in the application's
canonical Eastern-time interpretation:

```text
historical cohort: authoritative timestamp < 2026-04-30 00:00 America/New_York
modern cohort:     authoritative timestamp >= 2026-04-30 00:00 America/New_York
```

The cohorts are isolated for Form Lead duplicate classification:

- a pre-cutoff Form Lead can be compared only with earlier pre-cutoff Form
  Leads in the same exact Source Granularity;
- a post-cutoff Form Lead can be compared only with post-cutoff Form Leads in
  the same exact Source Granularity;
- importing old history must not make an existing or future modern Form Lead a
  Duplicate Lead;
- matched production Form Leads in the modern cohort retain their stored
  `duplicate` value and CPL consequences;
- unmatched modern records use the same application-owned duplicate rule as
  ordinary ingestion, but with the modern-cohort candidate floor enforced.

There is no rolling time window within the historical cohort. "No time frame"
for Form Fill is separate: Form Fill may cross the cutoff in either direction.

Required cutoff fixtures:

- two matching pre-cutoff Form Leads in one Source Granularity: the later
  eligible event is duplicate;
- matching Form Leads on opposite sides of the cutoff: neither cohort may use
  the other as a duplicate anchor;
- two matching modern Form Leads in one Source Granularity: preserve an
  existing production result or apply the modern application rule to an
  unmatched record;
- matching Form Leads in different Source Granularities: never duplicates;
- a Call Lead and non-duplicate Form Lead on opposite sides of the cutoff:
  Form Fill may still be true.

### Form Fill source-signal evidence

The classification-signal audit compares each formatted `Form Fill Checker`
result with a same-workbook normalized-phone intersection. This baseline is
not the final classification because it cannot yet exclude duplicate Form
Leads or collapse production overlap.

| Workbook | Call rows | Formula cells | Static cells | Checker true | Phone intersection true | Comparable | Mismatches |
|---|---:|---:|---:|---:|---:|---:|---:|
| Top 10 | 270 | 0 | 4 | 4 | 4 | 257 | 0 |
| TBM | 2,793 | 1 | 0 | 0 | 55 | 2,759 | 55 |
| TBM Primes | 587 | 1 | 0 | 0 | 34 | 567 | 34 |
| Best Relocation | 227 | 0 | 22 | 6 | 8 | 211 | 2 |

The checker columns are mostly blank and almost entirely non-formula. TBM and
TBM Primes each contain only one formula cell despite dozens of normalized
phone intersections. Top 10's four static positives agree with the baseline;
Best Relocation has two comparable discrepancies plus unclassified static
labels. Therefore checker values are useful reconciliation evidence but are
not a complete or authoritative Form Fill population.

### Deterministic order

Use:

```text
authoritative event timestamp
-> source-system priority (existing production-only event before imported event)
-> workbook id
-> tab name
-> physical row
-> row checksum
```

The production record representing an overlapped historical event occupies the
historical event's authoritative timestamp and is included only once.

For a historical-cohort Form Duplicate Lead, a row is duplicate when any
earlier canonical non-duplicate Form Lead in the same exact Source Granularity
matches normalized phone or normalized email. There is no rolling time window,
but candidates at or after the cutoff are excluded.

For a modern-cohort Form Lead, candidates before the cutoff are always
excluded. Existing production classifications are preserved. Only unmatched
modern records are classified, using the application-owned rule against modern
candidates.

For Call Duplicate Lead, compare only to earlier canonical non-duplicate Call
Leads in the same exact Source Granularity. The inclusive window is 90 days.
This reproduces the runtime behavior without import-order dependence: a
duplicate does not become the anchor for a later duplicate chain.

Form Fill is time-direction independent in current production semantics. A
Call Lead is Form Fill when a non-duplicate Form Lead exists anywhere in the
complete population for the same Source Company and normalized phone.

### Authority and reruns

These fields are derived:

- `duplicate`;
- `form_fill`;
- CPL changes caused by Duplicate Lead classification.

They do not decide whether the raw event is staged. Rebuilding with the same
inputs, decisions, and rule version must return byte-equivalent
classifications. A changed source snapshot, alias set, accepted identity
decision, or rule version creates a new manifest; it never mutates an approved
one.

Historical orchestration imports the application-owned duplicate and Form Fill
rule functions locally; it does not call the deployed production URL. Shared
rule functions need injected repositories and policies so planning can run
without writes, while the apply path uses application services with a
migration context that disables Sheet Sync, CRM Posting, Lead Messages, and
other outbound effects.

The current branch is not yet compliant with the exact-granularity rule:
`duplicateLead.service.ts` and the RingCentral duplicate guard currently allow
Source Company/`lead_source_company` matching. Before consolidation, their
shared match scope must require `source_granularity_id` (or one uniquely
resolved exact granularity key during legacy normalization) and fail closed
when granularity is unresolved.

## Staged pipeline and state transitions

### Stage A: snapshot

Input: immutable Sheet cell values and database snapshots.

Output `RawSourceRow`:

- workbook/spreadsheet id, tab, physical row;
- source revision metadata;
- raw cell map;
- row checksum;
- capture timestamp.

No domain writes.

### Stage B: parse and normalize

Output `ParsedCandidate`:

- canonical field values plus raw-value provenance;
- parsed date/time with timezone and correction evidence;
- normalized natural keys;
- Agent parse result;
- Customer display pattern flags;
- validation errors and quarantine reasons.

No identity merges.

### Stage C: resolve source identity

Group candidates by the canonical identities in the main plan. Collapse exact
source resubmissions and duplicate booking rows only when compatibility rules
pass. Every non-exact collision becomes a conflict case.

Output states:

```text
canonical | conflict | quarantined
```

### Stage D: resolve production overlap

Compare canonical candidates to the captured production snapshot. Output:

```text
already_present | planned_insert | safe_fill | conflict | quarantined
```

No updates are performed.

### Stage E: derive classifications and relationships

Run historical-cohort Duplicate Lead classification, preserve matched modern
production classifications, and classify only unmatched modern records through
the application-owned rule with the cutoff floor. Then run time-unbounded Form
Fill, followed by accepted booking/lead links, receiver attribution, Customer
references, cancellation mirrors, and CPL snapshots. Validate each resulting
document against production schemas with integrations disabled.

### Stage F: build immutable manifest

The manifest contains exact inserts, field-level updates, before-images,
preconditions, ObjectId mappings, catalog creations, relationship operations,
classification evidence, expected counts, and the complete quarantine set.

### Stage G: review and apply

Production apply is blocked until all blocking cases are resolved, evidence
hashes still match, preconditions pass, and two applies on a fresh
`testvantagemovers` prove the second is a no-op.

## Planner module seam

Keep orchestration under `scripts/historical/`, but keep domain rules owned by
application modules under `src/services/`. Historical scripts import those
modules locally from the branch and supply snapshot-backed adapters; they do
not call HTTP endpoints.

The shared planning interface remains small and side-effect-free:

```ts
type BuildHistoricalManifest = (
  input: HistoricalSnapshot,
  rules: RuleBundle,
  decisions: DecisionBundle,
) => HistoricalManifest;
```

The module owns parsing, identity grouping, precedence, conflict generation,
expected counts, and deterministic ids. Duplicate Lead and Form Fill decisions
come from injected application-owned classifiers and a policy version; callers
do not recreate those rules.

Adapters:

- Google Sheets snapshot reader;
- production/historical Mongo snapshot reader;
- filesystem artifact writer;
- test fixture adapter.

The manifest applier is a separate local command. It accepts only an approved
manifest plus an explicitly selected target connection and migration context.
It invokes underlying application service functions directly—never the
production URL—and cannot read Sheets, reinterpret names, fuzzy-match, or
recalculate the plan. The migration context disables outbound integrations and
requires the selected database to match the intended rehearsal/production
gate.

This seam prevents the existing write-capable
`ingest-historical-sheets.ts` from becoming the planner. Its row-by-row upserts,
global name-only Customer reuse, and write-time Agent creation are incompatible
with the staged design.

## Conflict artifacts

### Aggregate report

Group by:

- conflict kind and blocking severity;
- source workbook/tab and Source Company;
- event date window;
- entity kind;
- attempted rule and proposed disposition;
- status.

Counts must reconcile to the record-level file.

### Generated case file

```ts
type ConflictCase = {
  case_id: string;
  evidence_hash: string;
  rule_version: string;
  kind: string;
  blocking: boolean;
  status: "unresolved" | "decision_supplied" | "stale";
  source_provenance: SourceProvenance[];
  normalized_fields: Record<string, unknown>;
  candidates: CandidateEvidence[];
  rule_attempted: string;
  evidence: EvidenceItem[];
  recommendations: ResolutionOption[];
};
```

`case_id` is SHA-256 over the case kind, sorted immutable provenance keys,
canonical candidate ids, and rule version. `evidence_hash` additionally covers
the evidence payload. Raw values may live in an access-controlled local case
file; aggregate reports remain redacted.

### Separate decision file

```ts
type ConflictDecision = {
  case_id: string;
  expected_evidence_hash: string;
  rule_version: string;
  resolution: string;
  selected_candidate_ids?: string[];
  field_choices?: Record<string, unknown>;
  rationale: string;
  decided_by: string;
  decided_at: string;
};
```

Generated evidence never overwrites decisions. Replay fails closed when the
case is absent, the evidence hash changed, the rule version changed, selected
candidates no longer exist, or the resolution is invalid for the case kind.

Review flow:

```text
generate evidence -> review -> record decision -> replay planner
-> case resolved or marked stale -> approve manifest hash
```

Never silently select among identity ambiguity, Customer interpretation,
conflicting booking facts, fuzzy suggestions, or conflicting non-empty fields.

## Implementation order

1. Extract pure normalization, parser-result, money, provenance, and stable-id
   modules under `scripts/historical/`.
2. Add fixture-based tests for Agent parsing/allocation and Customer
   non-splitting.
3. Implement snapshot types and adapters; forbid writes in planner processes.
4. Implement canonical identity grouping and booking compatibility checks.
5. Refactor application duplicate matching to require exact Source Granularity
   and expose injected, side-effect-free rule functions for historical use.
6. Add the Form Lead cutoff policy to the application-owned classifier:
   historical cohort `< 2026-04-30`; modern cohort `>= 2026-04-30`; no
   cross-cohort candidates.
7. Implement production-overlap matching against captured snapshots.
8. Implement deterministic Form Duplicate Lead, Call Duplicate Lead, and
   time-unbounded Form Fill passes through those shared functions.
9. Implement conflict evidence, separate decisions, stale-decision checks, and
   aggregate reconciliation.
10. Implement production-schema validation with all external integrations
   disabled.
11. Implement immutable manifest generation and hash verification.
12. Implement the separately gated local test/production applier, registry,
    journal, verification, and rollback using underlying application services.

## Acceptance gates

Planning:

- Every source row ends as canonical, conflict, or quarantined.
- Counts reconcile from raw rows through canonical entities and operations.
- No parser or matcher performs a fuzzy automatic merge.
- No Duplicate Lead comparison crosses Source Granularity.
- No Form Lead duplicate comparison crosses the 2026-04-30 cutoff.
- No matched modern production Form Lead has its stored `duplicate` value
  changed by the consolidation manifest.
- A future modern Form Lead cannot use an imported pre-cutoff Form Lead as a
  duplicate anchor.
- No Customer is globally merged by name alone.
- Every multi-Agent allocation sums exactly in cents.
- Same inputs/rules/decisions produce byte-equivalent outputs and hashes.
- All evidence cases have stable ids; stale decisions fail closed.

Test rehearsal:

- Fresh `testvantagemovers` restore matches manifest preconditions.
- All production schemas and unique indexes pass.
- All relationship targets exist and have the correct model.
- Existing receiver Agents and active catalog states remain unchanged.
- First apply matches manifest operation counts.
- Second apply has zero inserts, material updates, relationship changes, and
  outbound integration jobs.
- Rollback restores before-images only when applied values still match.

Production:

- No unresolved blocking case.
- Approved manifest hash and current source/target checksums match.
- Sheet Sync, CRM Posting, Lead Messaging, and other outbound integrations are
  disabled for the apply.
- The apply runs through local application service functions from the reviewed
  branch; it does not call a deployed URL.
- Pre-2026-04-30 records do not enqueue Master Leads backfill.
- Best Relocation 2026-07-24 completed history is matched, not replayed.
- The 0205 Book Date correction is present as 2025-07-20 with source evidence.
