# Unit 23 Preview — blank case detail (Owner review blocked)

Date: 2026-08-19 (late)

This is the next-session handoff. Do not start Unit 24. Production env and effect flags stay unchanged.

Authoritative contracts: `delivery/issues/UNIT-23.md`, `delivery/issues/UNIT-24.md`, `delivery/UNIT-STATUS.md`.
Prior deploy handoff: `delivery/HANDOFF-2026-08-19-UNIT-23-PREVIEW.md`.

## What Owner saw

On Admin Preview case URLs, the page no longer hard-crashes. It now renders a **blank but valid-looking detail**:

- Title is `Granot lifecycle case` then `# ·` (kind and Job Number missing)
- `case rev` / `evidence rev` have no numbers
- Observed contact = Not available; move date / cubic feet / estimate / payment / balance / priority = —
- Submitted / accepted contacts = Not available
- Official facts = no Booking, no Cancellation
- Evidence history (0)
- Job timeline empty

That screen is **not** an empty database. It is the Admin client rendering **default empty objects** after a successful fetch that did not contain the projection.

Earlier on the same review URLs (older Admin Previews):

1. Queue: `can't access property "length"` → `items` was undefined (`e_.map` / `items.length`).
2. Every case: `can't access property "booking", ea.official_current is undefined`.

Those throws were real. The later Admin commit stopped the throw by defaulting missing fields. The payload problem remains.

## Direct answer: yes, the showcase data is `testvantagemovers`

Synthetic Owner-review fixtures were seeded **only** into Atlas `testvantagemovers` (job prefix `U23P`, source label `U23 Preview Synthetic Source`). Production `vantagemovers` was not written.

Re-checked 2026-08-19 ~01:18 EDT via Mongo. The ambiguous case is still present and **not** blank:

- `_id`: `6a85348abb59311027d5660b`
- `normalized_job_no`: `U23PAMBIG1`
- `mode`: `create_missing_booking`, `state`: `open`, seq `1`
- `evidence`: one `booked` row
- `observed_context.contact.name`: `Synthetic Ambiguous`
- `estimate` / `payment` / `balance` / `granot_priority`: `1200` / `200` / `1000` / `5`

If Admin were projecting this document, the page would show a masked name, those values, and evidence count 1. It does not. So Admin is not rendering this Mongo row.

Server Preview is supposed to select that database because branch env has `TEST_MODE=true` (`getMongoDatabaseName()` → `testvantagemovers`).

## What went wrong (current understanding)

There are two stacked issues.

### 1. Admin never received a full case DTO in the browser

`GET /api/v1/admin/granot-lifecycle/cases/:id` on the intended server builds `official_current`, `observed_context`, `evidence`, and `timeline` in `src/services/granotLifecycle/projections.ts` (`getGranotLifecycleCaseDetail`). Tests and a local projection verify against these fixtures passed earlier.

The Owner UI is the output of `asGranotLifecycleCaseDetail(...)` in `vantage-admin/lib/api/granotLifecycle.ts` when the input is `undefined` or `{}`:

- `official_current` → `{}`
- `evidence` → `[]`
- `observed_context` → only the section label
- `contacts` → `{}`
- `timeline` → empty page

A 404 / `ok: false` would show the red “Unable to load lifecycle case” message. Owner is **not** seeing that. The proxy call is succeeding with a body the client treats as an empty case.

### 2. CLI Admin Previews may not be talking to the TEST_MODE server

Intended wiring:

| Piece | Intended value |
| --- | --- |
| Server Preview | `https://vantage-movers-main-server-qixyrlard-vantage-4d3db9ef.vercel.app` (`dpl_GBwe3bMhzjnTC5UZPU18TxLAqXdN`, `f6c8adf`) |
| Server branch env | `TEST_MODE=true` → Mongo `testvantagemovers` |
| Admin branch env | `VANTAGE_API_BASE_URL` = that server Preview (branch `granot-lead-lifecycle` only) |
| Older Production+Preview `VANTAGE_API_BASE_URL` | left untouched (78 days old; do not assume it points at the test server) |

Git-triggered deploys are disabled. Later Admin URLs were `vercel deploy` CLI Previews (`target` was `null` at create time). Those deploys may **not** inherit the branch-specific `VANTAGE_API_BASE_URL` and may instead use the old shared Preview/Production API host.

If that is true, Admin is asking a host that is not the Unit 23 TEST_MODE Preview for these case IDs. That would explain a 200 + empty/wrong envelope without implying the fixtures vanished.

Do not “fix” this by pointing Production Admin at the test server, and do not change Production env.

## Admin deploys in this incident (do not mix)

| When | Deployment | URL | Notes |
| --- | --- | --- | --- |
| First Unit 23 Admin Preview | `dpl_zaXPxTr8TykNx2R3icLxvqk4W6Hd` | `https://vantage-admin-9hzabj3zw-vantage-4d3db9ef.vercel.app` | Branch-linked; queue crash (`items.length`) |
| Later session (Owner) | `dpl_EpR8DHtzBjL9XnVuhXwbqLqSD4ee` | `https://vantage-admin-k5o6xtwei-vantage-4d3db9ef.vercel.app` | Queue maybe fixed; every case threw `official_current.booking` |
| After official_current guard | `dpl_8qDKmf71oLosAB4W9mj9S27pwURG` | `https://vantage-admin-8wmr9gxn8-vantage-4d3db9ef.vercel.app` | No crash; **blank defaults** (this report) |

Use one Admin origin at a time. The case/job IDs below are database IDs, not deploy IDs.

## Fixture IDs still in `testvantagemovers`

| Scenario | Job | Case / job path |
| --- | --- | --- |
| Default queue | — | `/ingestion/granot/lifecycle` |
| Create-missing / high / Bad+Duplicate exclusion | `U23PCREATE1` | `cases/6a853488bb59311027d565f0` |
| Review-existing / medium / official Booking+Cancellation | `U23PREVIEW1` | `cases/6a853489bb59311027d565f8` |
| Later open sequence (seq 2) | `U23PSEQ001` | `cases/6a853489bb59311027d56605` |
| Resolved earlier sequence (not in default open queue) | `U23PSEQ001` | `cases/6a853489bb59311027d56604` |
| Ambiguous / no suggestion | `U23PAMBIG1` | `cases/6a85348abb59311027d5660b` |
| Missing-Lead Employee link | `U23PDELEG1` | `cases/6a85348abb59311027d56617` |
| Priority-5 + existing Booking, no case | `U23PNOCASE1` | `jobs/U23PNOCASE1` |
| Booked + Release observations | `U23PBOTH01` | `jobs/U23PBOTH01` (also open case `6a85348abb59311027d56620`) |

Candidate browsing is only valid for 24 hours from each case `opened_at` (seeded ~2026-08-19 00:13–03:58 UTC). Reseed if that window expires; **IDs change on reseed**.

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/prototypes/granot-lead-lifecycle/seed-unit23-preview-fixtures.ts
```

Cleanup is scoped to `U23P` + `U23 Preview Synthetic Source` only.

## Ranked hypotheses for the next session

1. **CLI Admin Preview `VANTAGE_API_BASE_URL` is not the TEST_MODE server.** Inspect env on the *exact* Admin deployment, not the project default. If it is the old host, set branch/deployment env to `https://vantage-movers-main-server-qixyrlard-vantage-4d3db9ef.vercel.app` for that Preview only, or redeploy with that value explicit. Do not edit Production.

2. **Proxy returns `{ ok: true }` / `{ ok: true, data: null }` / a nested `{ ok: true }` without the case object.** `requestJson` + `asGranotLifecycleCaseDetail` then paint the blank page. Confirm in DevTools → Network → ` /api/proxy/api/v1/admin/granot-lifecycle/cases/6a85348abb59311027d5660b `. A real payload must include `case_id`, `job_no`, `observed_context.contact`, `evidence[0]`.

3. **Server Preview is not the one Admin calls, or is not on `TEST_MODE=true`.** Unsigned `GET /api/v1/admin/granot-lifecycle/cases` on the intended server must be `401`. Signed Owner GET of the ambiguous case must return the contact/evidence above. If Admin’s host returns `404 GRANOT_CASE_NOT_FOUND`, Admin is on the wrong database.

4. **The crash-guard normalizers hide a real DTO.** Keep the guards (Owner cannot review a white-screen), but do not treat empty defaults as a successful projection. Fail the query (or show a hard empty-state with `case_id` from the URL) when `case_id` is missing after fetch.

Hypothesis 1 + 2 are the ones to falsify first. The Mongo row already falsifies “fixtures were never seeded.”

## Feedback loop (do this before more UI guessing)

Red-capable checks, in order:

1. Browser Network on the blank case page: status, JSON keys of `/api/proxy/api/v1/admin/granot-lifecycle/cases/6a85348abb59311027d5660b`.
2. Vercel inspect of that Admin deployment: `VANTAGE_API_BASE_URL` value (host only; do not paste secrets).
3. Signed GET to `https://vantage-movers-main-server-qixyrlard-vantage-4d3db9ef.vercel.app/api/v1/admin/granot-lifecycle/cases/6a85348abb59311027d5660b` — expect `ok: true` and `data.observed_context.contact` / `data.evidence.length === 1`.
4. Same GET against whatever host Admin actually uses, if different.
5. Only then change client unwrap logic.

Do not keep adding `?? []` / `?? {}` without printing the raw proxy body. That is how this blank page was created.

## Code already changed (Admin, uncommitted unless another session committed)

- Queue: `items ?? []`, list envelope normalize, lifecycle `Suspense`.
- Detail: `official_current ?? {}` and the other defaults; `asGranotLifecycleCaseDetail` / `asGranotTimelinePage`.
- Tests in `vantage-admin/tests/granot-lifecycle-components.test.ts` and `lib/api/granotLifecycle.test.ts`.

Those changes stop Next.js global-error. They do **not** prove the API is wired to `testvantagemovers`.

## Safety / non-actions

- No Production deploy or Production env edit.
- All Booking/Lead/Release/Referral/email effect flags stay false.
- No real-database dry run.
- Unit 24 stays blocked until Owner can see these fixtures on a correctly wired Preview.

## Remaining work

1. Prove which API host the live Admin Preview calls.
2. Prove that host’s case GET returns the `testvantagemovers` projection.
3. If the host is wrong, fix Preview-only `VANTAGE_API_BASE_URL` and redeploy Admin.
4. If the host is right and the body is empty/nested, fix unwrap using the captured JSON (not more silent defaults).
5. Re-walk the fixture table. Only then record Owner acceptance for Unit 24.
