---
okf_version: "0.2"
type: Service
title: Number↔Lead attachment
description: Retired 2026-10 by All Numbers phase B. The event-time Number↔Lead attachment edges, their refresh job, sole-match automatic attach, Owner attach/reject/detach commands and reads were replaced by the number's own lead link (`contact_numbers.lead`, `other_leads`, `lead_link`).
status: retired
tags: [sales-intelligence, attachment]
---

# Number↔Lead attachment — retired

**Retired 2026-10 by All Numbers phase B** (workspace `all-numbers/CONTRACT.md` §2–§5). Do not build on it.

**What was removed:** `src/services/salesIntelligence/attachment/` (`suggest.ts`, `sources.ts`, `matchSet.ts`, `store.ts`, `refresh.ts`, `leadTrigger.ts`, `commands.ts`, `reads.ts`), the `NumberLeadAttachment` model and its `number_lead_attachments` collection (dropped by `ops/numbers-v2/cleanup.ts`), the `attachment_refresh` job stage (now retired: late rows are terminalized by job recovery), the `/api/cron/sales-intelligence-attachment-refresh` cron, the Owner routes `GET /attachments`, `POST /attachments/attach`, `POST /attachments/:id/reject` and `POST /attachments/:id/detach`, the `attachment` live topic, and the flags `SALES_INTELLIGENCE_ATTACHMENT_REFRESH` and `SALES_INTELLIGENCE_AUTO_ATTACH`.

**What replaced it:** the All Numbers lead link on the Contact Number itself — `lead`, `other_leads` and `lead_link` (`src/services/numberActivity/leadLink.ts`, `leadLinkJobs.ts`). Candidates are the Leads whose phone is exactly the number (the same indexed phone paths, plus a Call Lead's RingCentral telephony session); the newest wins unless the Owner pinned one, and the Owner's Unlink excludes a Lead for good. See [number-activity-reads.md](./number-activity-reads.md) (lead link, Owner command) and [number-activity-capture.md](./number-activity-capture.md) (triggers). The Sales Outreach Desk credits a call to the number's current `lead` ([sales-outreach-desk.md](./sales-outreach-desk.md), IMPL-07).

**What remains:** Form Lead Contact Numbers (`numberActivity/formLeadNumber.ts`, still behind `SALES_INTELLIGENCE_FORM_LEAD_NUMBERS`), now minted by the Lead's `lead_link` job. The phone-path indexes in `src/models/leadContactPhoneIndexes.ts` serve the lead link.

**Migration:** `ops/numbers-v2/migrate.ts` seeded each number's link from its edges before they were dropped: the newest Owner-confirmed attached Lead became an Owner pin at its decision time, and Owner-rejected Leads became `lead_link.excluded`.

**Last live body:** git history before the All Numbers phase B commit on `feat/all-numbers` (the phase A commit `503b9a99` still has it).
