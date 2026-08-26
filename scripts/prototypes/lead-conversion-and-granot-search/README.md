# Lead conversion rates and Granot observation/command search

Read-only script prototype. It proves two Owner questions against
`vantagemovers` before either surface becomes an application report.

**Specification:** [`specs/lead-conversion-and-granot-search-prototype-specification.md`](specs/lead-conversion-and-granot-search-prototype-specification.md)

This folder does not add an Admin route or a new collection.

## Commands

```text
pnpm prototype:lead-conversion-and-granot-search -- rates --confirm-production-db=vantagemovers

pnpm prototype:lead-conversion-and-granot-search -- search --job-no 5562924 --confirm-production-db=vantagemovers

pnpm prototype:lead-conversion-and-granot-search -- search --job-no 5562924 --event booking_status_changed --booking-action Booked --confirm-production-db=vantagemovers
```

`--event` is `lead_created`, `priority_updated`, or
`booking_status_changed`. `--booking-action` is `Booked` or `Releas` and
only legal under `booking_status_changed`.

Search returns Observations, the latest Synchronization Decision per
Observation, and Domain Commands whose `provenance.observation_id`
matches. `timeline_seed` is the ID list the Job Number timeline can
render.

## Tests

```text
pnpm test -- scripts/prototypes/lead-conversion-and-granot-search/src/rates.test.ts scripts/prototypes/lead-conversion-and-granot-search/src/search.test.ts
```

Ordinary tests use synthetic rows only. Live reads require the
production confirm flag and write gitignored JSON under
`scripts/output/lead-conversion-and-granot-search/`.
