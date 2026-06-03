# RingCentral inbound numbers, queues, and extensions

Reference for the call-lead integration. Owner notes used informal labels; this doc aligns them with RingCentral queue names, extension numbers, and the mappings in [`call-lead-sources.ts`](./call-lead-sources.ts).

**Candidate rule (current phase):** inbound calls must hit one of these numbers (`to.phoneNumber` on an inbound party), match a row below, and pass qualification in [ringcentral-call-lead-candidates](../../../.cursor/rules/ringcentral-call-lead-candidates.mdc). Code keys are E.164-like strings without spaces.

## Inbound lines

| Display (owner)    | Toll-free      | E.164 (code key) | RingCentral queue / landing name | Ext | `sourceLabel` in code | `sourceCompany`   |
| ------------------ | -------------- | ---------------- | -------------------------------- | --: | --------------------- | ----------------- |
| 10best Inbounds    | (888) 316-4387 | `+18883164387`   | 10BEST LANDING                   | 514 | `10best Inbounds`     | `top10_leads`     |
| TBM Prime Inbounds | (888) 308-3612 | `+18883083612`   | TBM Prime Inbounds               | 516 | `TBM Prime Inbounds`  | `tbm_prime_leads` |
| Top10 Inbounds     | (888) 724-0625 | `+18887240625`   | TOP 10 INBOUNDS                  | 529 | `Top10 Inbounds`      | `top10_leads`     |
| Main Site Inbounds | (888) 477-9232 | `+18884779232`   | Main Site Inbounds               | 519 | `Main Site Inbounds`  | `main_site`       |

## Label mismatches (owner vs RingCentral)

Use the **RingCentral queue / landing name** and **ext** when searching the admin UI or call-log parties. Use **`sourceLabel`** when matching Vantage domain config (`SOURCE_LABEL_TO_COMPANY` in [`api/config/domain/sources.ts`](../../config/domain/sources.ts)).

| Owner / Vantage label | RingCentral name on account |
| --------------------- | --------------------------- |
| 10best Inbounds       | 10BEST LANDING              |
| Top10 Inbounds        | TOP 10 INBOUNDS             |
| TBM Prime Inbounds    | TBM Prime Inbounds (same)   |
| Main Site Inbounds    | Main Site Inbounds (same)   |

## Integration notes

- **Phone → source:** `resolveRingCentralInboundSource()` in `call-lead-sources.ts` only looks up the **toll-free number** (normalized to E.164-like). Extensions are not used in that map yet; keep ext here for webhook/call-log debugging and future extension-based routing.
- **Two Top10 lines:** `10best Inbounds` and `Top10 Inbounds` both map to `top10_leads` but are different numbers and queues (514 vs 529).
- **Party direction:** on inbound candidate events, caller is `from.phoneNumber`, called line/queue is `to.phoneNumber`.

## Raw owner notes (verbatim)

```
( (888)-316-4387 is the to number , the number that gets called.  "10BEST LANDING" I believe is the Queue Name. The ext 514 is that extension number. )
(888) 316-4387 - 10best Inbounds = 10BEST LANDING ext 514
(888) 308-3612 - TBM Prime Inbounds = TBM Prime Inbounds ext 516
(888) 724-0625 - Top10 Inbounds = TOP 10 INBOUNDS ext 529
(888) 477-9232 - Main Site Inbounds = Main Site Inbounds ext 519
```
