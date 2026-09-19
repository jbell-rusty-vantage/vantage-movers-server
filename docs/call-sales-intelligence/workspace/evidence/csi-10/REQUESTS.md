# Synthetic CSI-10 requests

All routes use `/api/v1/admin/sales-intelligence`, signed Registry Owner authentication and existing current-record scope; POST additionally requires `Idempotency-Key`. Existing deployment flags default off. These examples do not authorize a production call.

GET returns only stored proposal evidence from prior Owner propose command responses for the current directory snapshot. A User without that evidence is `not_proposed`; GET never invokes proposal matching. Strict schemas: `repLinkDtoSchema`, `repProposalDtoSchema`, `repDirectoryEvidenceSchema`, `repListDtoSchema`, `repDetailDtoSchema` in `repIdentity/reads.ts`.

HTTP GET envelope follows `{ok:true,as_of,coverage,data}`; list `data` contains `items`, `next_cursor`, `directory`, and detail `data` contains `link`. Service read DTOs expose the same metadata and fields before the transport wraps `data`.

GET `/reps?rc_account_id=synthetic&limit=50` returns link `items`, `_id` `next_cursor`, and a separate directory User evidence page with `directory.next_cursor`. Use `cursor` and `directory_cursor` independently. GET `/reps/:id` returns `as_of` and `link`, including history and `{status:"unknown",reason:"rep_metrics_not_available",interactions_total:null}`. GET never proposes or repairs.

POST `/reps`:

```json
{"expected_revision":1,"reason":"Owner-authored proposal","link":{"agent_id":"aaaaaaaaaaaaaaaaaaaaaaaa","rc_account_id":"synthetic","rc_extension_id":"101","role_kind":"sales_rep","effective_from":"2026-09-01T12:00:00Z","effective_to":null,"nudge_channels_allowed":[]}}
```

Response is `{ok:true,data:{response:{link:RepLinkDto},replayed:false}}`; supplying an Agent never implies review. For creation `expected_revision` is 1. No separate create status is accepted.

POST `/reps/propose`:

```json
{"expected_revision":1,"rc_account_id":"synthetic","directory_snapshot_id":"bbbbbbbbbbbbbbbbbbbbbbbb","reason":"Review stored directory evidence","limit":50}
```

Pin the latest stored snapshot id returned by GET. A changed snapshot conflicts. Page with returned `next_cursor` as `after_extension_id` using a new idempotency key. Maximum page size 100. Unique matches create proposed links; ambiguous/unmatched User results have no fabricated link. Any existing extension history is preserved, including retirement. Exact names are never reviewed automatically.

POST `/reps/:id/review` uses the full `link` shape above, `expected_revision` from GET, required `reason`, and `status:"reviewed"` or `"retired"`. Reviewed successors must start strictly after the old start, no later than its existing end. The response contains the new link id/revision and `reevaluation_job_id`. At the exact successor boundary, the new Agent resolves. Retirement supplies the same identity/role/channels/start with a finite end no later than command time; it cannot extend an already closed interval. A retired proposal stays unreviewed historically. Channel metadata grants no send permission.

Automatic review-change recovery scans [earliest affected start,command time] in pages of 25 interactions, ordered by event time/id. `scheduleRepIdentityReevaluation` also accepts explicit bounded windows inside an existing trusted server transaction; it is not a production CLI or public unaudited command. Jobs and stage flags remain durable when consumers are disabled. No live provider work runs in the identity worker.
