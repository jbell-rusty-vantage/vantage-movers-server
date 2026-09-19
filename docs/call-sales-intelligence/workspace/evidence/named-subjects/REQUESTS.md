# Named-subject seed requests

Writes used CSI-06 `outreach_ensure` for `outreach-lead:CallLead:<id>` only. No attach, no `ensureInteraction`, no Call Log reconcile, no `POST /backfill`.

Proof reads (signed Owner, no body):

```
GET /api/v1/admin/sales-intelligence/outreach/by-lead/CallLead/6a761d3d7ceae445794c57bd
GET /api/v1/admin/sales-intelligence/outreach/by-lead/CallLead/6aaaf552ca2df3ab6f396b5d
```

Lead-entry SI URLs (ids only):

```
/sales-intelligence?view=attention&lead=6a761d3d7ceae445794c57bd&lead_model=CallLead
/sales-intelligence?view=attention&lead=6aaaf552ca2df3ab6f396b5d&lead_model=CallLead
```
