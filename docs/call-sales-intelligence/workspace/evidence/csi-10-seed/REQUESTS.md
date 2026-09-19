# CSI-10 production seed requests

All routes use `/api/v1/admin/sales-intelligence` on the local seed API (`:3010`) with signed Owner headers. POST requires `Idempotency-Key`. Account `62948571023`. Snapshot `6aaea089984b82cb35a76522`.

`POST /reps/propose` paged with `limit:50` and `after_extension_id` from `next_cursor`, new idempotency key each page:

```json
{"expected_revision":1,"rc_account_id":"62948571023","directory_snapshot_id":"6aaea089984b82cb35a76522","reason":"CSI-10 production seed: unique directory proposals only","limit":50}
```

`POST /reps/:id/review` for each unique proposed row, `status:"reviewed"`, `role_kind:"sales_rep"`, `nudge_channels_allowed:["pager","sms_to_rep"]` when the stored snapshot has exactly one DID, otherwise `["pager"]`. No `rc_team_messaging_person_id`.

`GET /reps?rc_account_id=62948571023&limit=50` is the proof read. Directory Users paginate with `directory_cursor` independently.
