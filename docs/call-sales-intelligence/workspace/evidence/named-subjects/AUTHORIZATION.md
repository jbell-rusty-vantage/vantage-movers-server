# Named 1–2 number-lead subjects — Owner authorization

**Date:** 2026-09-19  
**Owner named:** Job `P5562014` and Job `5564480`.  
**This is not CSI-15 fleet backfill.** Recording grant must still be re-probed. Official `migration:csi:indexes` was applied September 19 after Owner review of company account `62948571023` on conversation `6a905b5cf7dda52cfacb721e`. Do not activate historical Outreach obligations from a UI walkthrough. Do not re-apply.

Look up by job number / Mongo ids. Do not treat last-four as a unique key.

## Subject A — stored conversation audio

| Field | Value |
| --- | --- |
| Job | `P5562014` |
| Last four | `5590` |
| Display | Chris H |
| Kind | Call Lead |
| Call Lead `_id` | `6a761d3d7ceae445794c57bd` |
| Booking `_id` | `6a7d4e3529d500054c6b5be5` |
| Book date | 2026-08-12 |
| Conversation `_id` | `6a905b5cf7dda52cfacb721e` |
| Provider recording id | `3750152612023` |
| Conversation state | `complete` |
| Blob | `conversations/3750152612023.mp3` (present, not purged, 1 665 549 bytes) |
| Qualified inbound duration | 482 s |
| Received by (snapshot) | Patrick |
| Source | Top10 inbound |

Use this subject when the walkthrough needs Play / existing media without a new RingCentral grant.

## Subject B — recent booked inbound, no Vantage audio

| Field | Value |
| --- | --- |
| Job | `5564480` |
| Last four | `2422` |
| Kind | Call Lead |
| Call Lead `_id` | `6aaaf552ca2df3ab6f396b5d` |
| Booking `_id` | `6aac3c5c825e5bfbdddaa34b` |
| Book date | 2026-09-17 |
| Lane | Yucca Valley → Pueblo |
| Received by (snapshot) | Nick |
| Source | Top10 inbound |
| RingCentral session id | `8205746055` |
| Call log id | `AK3DcEGCAYGvjUA` |
| Qualified inbound duration | 1214 s |
| Form Lead on this phone | none found |
| `lead_conversations` row | none |

A recording is likely at RingCentral and **unproven** in Vantage. Do not claim stored media. Do not fetch production recordings until the grant is re-probed.

## Still forbidden

- CSI-15 windows / `BACKFILL_DAYS`
- Enabling `NUDGE_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`, media/capture flags in Vercel
- Official CSI index migration
- Inventing attachments, Outreach reopen, or missed-call episodes from history
- Writing Rep Identity Links for Josh, Roy, Jason, either Tyler, Russell, QA, or unmatched Users
- Live send
