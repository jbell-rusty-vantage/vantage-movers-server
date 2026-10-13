---
okf_version: "0.2"
type: Reference
title: Granot priorities, Estimates in Process, and the rep desk
description: Owner instructions recorded 13 October 2026. Granot priority meanings 0–8, the decision to stop call-inferred assignment, the rep-desk move date and binder presentation, and the proved Estimates in Process / Follow-Up Estimates read. Not a description of the running desk.
tags: [sales-outreach-desk, granot-lifecycle]
status: draft
stale_after: 2027-01-13
resource: src/services/salesOutreach/
applies_to:
  - src/services/salesOutreach/contacts/receiverFill.ts
  - src/services/salesOutreach/engine/evaluate.ts
  - src/services/salesOutreach/reads/queue.ts
  - src/services/granotHttpCollector/index.ts
  - src/services/granotHttpCollector/runWorkflow.ts
owners: [team:main-server]
sources:
  - id: lifecycle
    resource: sales-outreach-lifecycle.md
    title: What the desk does today
  - id: collector
    resource: services/granot-http-collector.md
    title: The HTTP collector the running automation still uses
generated:
  by: process:owner-instructions
  at: 2026-10-13T17:50:00Z
---

# Granot priorities, Estimates in Process, and the rep desk

Owner instructions recorded **13 October 2026**. This page is the knowledge. It is not what the desk does today. The running lifecycle is [sales-outreach-lifecycle.md](sales-outreach-lifecycle.md). The HTTP collector the automation still runs is [granot-http-collector.md](services/granot-http-collector.md). Nothing on this page turns on a write, a cron, or a desk change by itself.

## Priority meanings

These are the sales meanings of Granot’s priority codes. A rep changes the code in Granot. The desk does not move a lead from one priority to another.

| Code | Meaning |
| --- | --- |
| 0 | Newly assigned. Call, text, and email regularly, with the intention to connect. After 3 consecutive days with no connection, move the lead to Priority 2. |
| 1 | Working, quoted, in contact, and able to close. Highest priority. Update the notes and the contact every day. Make contact regularly, or keep it scheduled. Stay in contact until the sales process is finished. |
| 2 | The rep lost the lead or never made contact. A Priority 0 prospect who has not answered any correspondence after 3 days is placed here. A Priority 1 or Priority 3 prospect who has stopped responding for 3 days is placed here. Call cadence is one call a day. There is wiggle room: the move date may still be in the future. |
| 3 | The rep’s own category. Follow these leads up appropriately and do not forget them. Call cadence is one call a day, at the rep’s discretion. |
| 4 | Booked jobs only, before they are dispatched. A job booked and then placed on hold by customer service can still show here as follow-up. The file notes say when it is on hold. Operations and dispatch only. |
| 5 | Booked jobs only, after they are dispatched. No sales rep adds or removes any file from this priority. Operations and dispatch only. |
| 6 | Booked jobs that have been delivered and completed. Operations and dispatch only. |
| 7 | Bad email, bad phone, wrong number, or wrong person. The submitted contact information cannot reach the person. Vantage runs text and email campaigns on these leads to re-engage them if the contact information is updated or they engage with the campaign. |
| 8 | Booked elsewhere, said no, or passed the originally submitted move date without making contact. |

The Estimates in Process priority filter also offers **9 Pool**. The owner list above stops at 8. Do not invent a meaning for 9.

### What the desk still does

The running priority map is the approved P05d map, not this table.

- 0 is New. 1 is Quoted, one call each working day.
- 2 is unmapped: no routine cadence, “No policy configured.”
- 3 is discretion: routine cadence ends, and the lead stays visible.
- 5, 7, and 8 close the desk subject. 5 does not create an official Booking.
- 4 and 6 are unmapped.

Call cadence for 2 and 3, and the three-day moves into Priority 2, are not built.

## Assignment

Stop assigning a rep because that rep made an outbound call to an unassigned number-lead. The only assignment sources from here forward are:

- the Granot user, written onto the lead as the receiver when it maps to one Agent;
- an optional manual assignment by the Owner.

A lead with no Granot user and no Owner assignment stays unassigned. An outbound call still counts as that rep’s work. It does not take the lead.

### What the code still does

`receiverFill.ts`, applied from `applyContactSources`, still fills an empty `receiver_agent` when the desk subject is unassigned. The candidate is the latest reviewed-rep call on that one subject: kind `outbound_attempt` or `inbound_answered`, verification `confirmed` or `awaiting_confirmation`. The write source is `ringcentral_rep_call`. The subject feed then assigns the lead to that rep. A later call does not move it. A matching Granot user replaces it. An Owner or Manager desk assignment (`manual`) replaces it and Granot does not override `manual`.

The owner named the outbound case. The same function also fills from an answered inbound. Removing the outbound fill means changing this function; leaving the inbound half in place would keep a call-inferred assignment. `ringcentral_answered` is a different write: the reviewed rep who answered the call that created a Call Lead, and only into an empty receiver.

## Rep desk

Seen on the rep’s My view (`/outreach-desk?view=my`). An Owner or Manager sees the same tiles when they open that rep’s view. A rep does not see another rep. The queue is a table of rows. The lead panel shows the same move-date and last-interaction lines as the row.

These presentation rules are not built, except where the “already on the desk” notes say otherwise.

### Move date

`display.move_date` is already on the queue row as `YYYY-MM-DD`, or null. Compare it to the New York business date.

| Move date | Row reads |
| --- | --- |
| In the future | “in 12 days” |
| Today | “today” |
| In the past | “12 days ago” |
| Null | “No move date” |

Call Leads are null on the desk even when a raw document has a date. Do not add a new response field.

**Filter.** Label the existing presets Future and Past. Future is today and later (`move_date_from` = today). Past is through yesterday (`move_date_to` = yesterday). Today counts as future. Unknown dates stay hidden unless the rep picks Unknown. Those presets already exist. Team “Leads needing attention” ignores a move filter until a filter turns the full queue on.

**Sort.** Add server sort `move_date`, soonest first, nulls last, with an index on the projection. Mirror it in the admin client, the URL, and both sort menus. Do not sort the loaded page in the browser. Sorts today are urgency, lead received, and last interaction, applied in Mongo before the page (default 25 rows).

### Last interaction

`last_interaction_at` is already the latest confirmed `outbound_attempt`, `inbound_answered`, `inbound_missed`, `sms_sent`, or `sms_inbound` (`engine/evaluate.ts`). Failed texts, unconfirmed texts, automation texts, Granot notes, and dashboard actions are not in it. The column is labeled Last outreach. Rename it to Last interaction. Do not change which events count. The sort menu already says Last interaction.

### Binder

Two figures on My view. Both use the New York calendar. Refresh them from the outreach live stream the desk already opens. Do not open a second live connection, and do not copy Daily Operations metric touches.

**Booked binder.** Sum that agent’s own `agent_allocations[].binder_amount`. The first allocation is primary. A split gives the secondary agent half the cents, rounded down, and the primary the rest. Credit the signed-in agent their own slice. `book_date` is the New York calendar day. Cancelled bookings stay in the sum, matching Insights.

| Window | `book_date` |
| --- | --- |
| Today | today |
| This week | Monday through today |
| This month | the 1st through today |
| All time | no date bound, summed by Agent id |

All-time agent performance today groups by name snapshot and stops at 50 rows. This read sums by Agent id with no cap. A rep asking for another agent stays forbidden.

**Current binder on assigned leads.** The owner asked for the binder amount of the leads assigned to the rep and not yet booked. An unbooked lead has no binder dollars. `quoted` is a boolean. Cubic feet, estimated cubic feet, and move size are not money. Show this as a count of open assigned leads until a rate exists: projections with `assigned_agent_id` for that agent and `subject_status` active or review. Official booking, cancellation, a bad lead, and priority closures 5, 7, and 8 take a lead off the count. Do not invent a dollar rate.

## Estimates in Process

Proved 13 October 2026 against `https://eagle.hellomoving.com`. This is a different page from the collector’s Leads & Advertising report. The collector still logs in and walks source-company reports. This section is the read that reaches every source in one Follow-Up Estimates query.

Customer names, phones, emails, and street addresses from that proof are not stored here.

### Sign in

Two pages, in order. Env names and which field they fill are in [environment.md](environment.md) and [granot-http-collector.md](services/granot-http-collector.md). `GRANOT_*` wins when it is set. The older names are used only when the matching `GRANOT_*` value is empty.

1. **Network Login.** `GET /wc.dll?mp~NetLogonWc~VANTAGE`. `/vantage/admin.htm` is the unsigned frame that loads this page. Post `LOGON_USER` and `PASSWORD`. Do not post `SAVEPASS`.
2. **User Login.** Shown only after the network POST. Post `USERNAME`, `PASSWORD`, and `LOGON=Login`.

The user POST opens the main menu, `mv~mainmenuwc~{session}~LOGIN`. Later paths need that session id and the cookie jar. A copied `wc.dll` URL without the cookies returns Granot’s cookie security alert.

### Open Follow-Up Estimates

1. On the main menu, Estimates in Process runs `submitFunction(2)`, which opens `mv~estprocesswc~{session}`.
2. The form title is Estimates in Process. Post it to `mv~estprocessret~{session}`.
3. Set the controls below. The preset list (Today, Yesterday, This Week, and the rest) has no field name. The dates Granot keeps are `DATE1` and `DATE2`.

| Control | Proven value | What it is |
| --- | --- | --- |
| `STATUS` | `V9` | Follow-Up Estimates. The checked default, `V15`, is Today’s Recent 50 Estimates Priority 0. That default is a different query and was not the one proved. |
| `TYPEDTE` | `OPEN` | Date factor. `OPEN` is Open Date. `MOVE` is Move Date. |
| `DATE1` | `10/12/2026` | From Date. |
| `DATE2` | `10/13/2026` | To Date. |
| `FUSTATUS` | `10` | Priority. `10` is ALL. `0`–`8` are those codes. `9` is Pool. |
| `USER` | empty | One Granot user, or all users when empty. |
| `DEPT` | `ALL` | Department. `P` is one of AT, CB, CN, OH, P, QA, RF. |
| `TYPE` | `V1` | All move types. Also Local, Long Distance, International, Auto Transport. |
| `SORT` | `V6` | Priority. Also job number, move date, volume, estimate amount, follow-up date. |

That post returned **Follow-Up Estimates, Total of: 99 Transactions**, for Open Date 12–13 October 2026, every user, every priority. It was not capped at 50. The result URL was `mv~estprocessret`, not the `mv~topestprocess` URL on the Recent 50 sample.

### Columns

`job_no`, `open_date`, `type`, `follow_up`, `user`, `customer`, `email`, `phone1`, `phone2`, `from_city`, `from_state`, `from_zip`, `to_city`, `to_state`, `to_zip`, `miles`, `move_date`, `cf`, `lbs`, `rate`, `estimate`, `ref_no`, `source`.

On those 99 transactions, phone 1, email, customer, user, and source were filled on every row. Phone 2 was empty. `ref_no` was filled on 49. Cubic feet is `cf`. Priority is not its own column. It is inside `follow_up`, written `prior:` plus the digit. That window contained priorities 0, 1, 2, 3, 7, and 8.

Users in the rows: AUSTIN, BRIAN, DYLAN, GEVANS, JOSH, NICK, PATRICKO, RUSTY, SIL.

Sources in the rows: 10best Inbounds, Best Relocation Forms, BestRelocation Inbounds, Main Site Forms, Paid Overflow, TBM Forms, TBM Forms Prime, Top10 Forms, Top10 Inbounds.

Paid Overflow is a source value on this page. It is not one of the nine labels the collector’s seeded source catalog walks.

### Date window for three runs a day

Recommendation, not a scheduled job.

| Run (America/New_York) | Open Date | Other filters |
| --- | --- | --- |
| 8:00 | Yesterday through today | Follow-Up Estimates, all users, all priorities |
| 13:00 | Yesterday through today, and one wider Open Date window still to measure | Same |
| 18:00 | Yesterday through today | Same |

Open Date is the column `open_date`. Move Date would skip a lead opened today whose move is later. Neither factor means “edited today,” so a priority or user change on an older open is missed by yesterday–today. The wider midday window is how that catch-up would work. It was not measured. The two-day query returned 99 rows and was not the Recent 50 cap. Do not automate `STATUS=V15`.

The collector’s own report is still Leads & Advertising, one source label at a time, with `DATE1` / `DATE2` / `TYPEDTE` on that other form. Its Follow Up Estimates table is parsed for job, source, customer, phone, email, from, to, estimated cubic feet, and rep. Priority on that path is the booked-jobs column, not the follow-up cell on Estimates in Process.

## Not built

- Priority meanings and the three-day moves into Priority 2.
- One call a day for Priority 2 and Priority 3.
- Stopping `ringcentral_rep_call`.
- “in N days” / “N days ago”, the Future and Past labels, and move-date sort.
- Renaming Last outreach to Last interaction.
- Booked binder for today, this week, this month, and all time on My view.
- The count of open assigned leads next to that binder.
- A three-times-a-day Estimates in Process cron.
