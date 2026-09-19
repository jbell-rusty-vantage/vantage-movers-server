# Named-subject seed checks — September 19, 2026

Not CSI-15. No Vercel / `.env` flag writes. No `migration:csi:indexes --apply`. No capture, media fetch, STT, or live send.

## Indexes

`pnpm migration:csi:indexes -- --verify` on `vantagemovers`: **ready true**, unresolved 0, no missing/incompatible/conflicts. Artifact stayed local/gitignored.

## What already existed

| Subject | Call Lead | Booking | Conversation / Number Activity |
| --- | --- | --- | --- |
| P5562014 | `6a761d3d7ceae445794c57bd`, official Booked | `6a7d4e3529d500054c6b5be5` | Conversation `6a905b5cf7dda52cfacb721e` complete, Blob `conversations/3750152612023.mp3` present. Not re-fetched. |
| 5564480 | `6aaaf552ca2df3ab6f396b5d`, official Booked | `6aac3c5c825e5bfbdddaa34b` | No `lead_conversations` row. Recording unproven in Vantage. Not fetched. |

Production `contact_numbers` 0, `call_interactions` 0, `number_lead_attachments` 0. CSI-05 attach was not run.

## What this session wrote

Official `outreach_ensure` / `ensureLead` only (`outreach-lead:CallLead:<id>`). Both created then official-closed `booked`. `first_action_due_at` null. Open followups 0.

| Job | Outreach | Ensure job | Close side effect |
| --- | --- | --- | --- |
| P5562014 | `6aaf051bec271d561ab295c7` closed / booked / official | `6aaf051a0c843378499fd0bf` completed | pending `number_refresh` `6aaf051c0c843378499fd0c0` (not drained) |
| 5564480 | `6aaf051dec271d561ab295cb` closed / booked / official | `6aaf051c0c843378499fd0c1` completed | pending `number_refresh` `6aaf051d0c843378499fd0c2` (not drained) |

## HTTP

Signed Owner GET `/api/v1/admin/sales-intelligence/outreach/by-lead/CallLead/<id>`:

| Origin | P5562014 | 5564480 | Absent id |
| --- | --- | --- | --- |
| Existing local seed API `:3010` (production Mongo, process `ENABLED` only) | **200** closed booked, no number, overdue false, reasons [] | **200** same | **404** |
| Deployed production API | **404** `FEATURE_DISABLED` | **404** `FEATURE_DISABLED` | 404 |

Browser Lead Actions walk was not finished after Owner pause. No phones copied.
