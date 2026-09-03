---
type: Service
title: Tariff Service
description: Append-only tariff adjustment rows to TARIFF_SHEET_ID / Master. Carrier is the resolved Moving Carrier name and DOT.
tags: [tariff, google-sheets]
status: active
stale_after: 2026-12-01
resource: src/services/tariff/append.ts
applies_to:
  - src/services/tariff/append.ts
  - src/services/tariff/resolveCarrier.ts
  - src/routes/tariff-adjustments.routes.ts
  - src/validation/v1/tariffAdjustments.validation.ts
  - src/middleware/requireApiSecret.ts
  - src/config/domain/tariff.ts
  - src/config/domain/granotCarrierCodes.ts
  - scripts/prove-tariff-append.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/tariff/append.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: process:manual
  at: 2026-09-03T19:50:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Official spec:** [`../../../../docs/tariff-adjustment/tariff-adjustment-specification.md`](../../../../docs/tariff-adjustment/tariff-adjustment-specification.md)  
**Primary code:** `src/services/tariff/append.ts`  
**Domain terms used:** [Tariff Adjustment](../../../../CONTEXT.md), [Tariff Adjustment Submit](../../../../CONTEXT.md), [Moving Carrier](../../../../CONTEXT.md), [Granot Carrier Code](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md)

# Tariff Service

**Role:** Append two tariff adjustment rows per Granot Forms View parse to `TARIFF_SHEET_ID` / `Master`. **Append-only.** Does not upsert. Does not write customer name, phone, email, job number, or ref.

**Not Sheet Sync.** This is a separate owner spreadsheet. It does not use the lead/booking outbox or Mongo IDs.

## Row shape

`Timestamp`, `Effective Date`, `Pickup Zone`, `Delivery Zone`, `Service`, `Rule ` (live header has a trailing space), `New Rule`, `Carrier`.

`Service` is `Linehaul` or `Additional Services`. The two rows share date, zones, and carrier. `Timestamp` is stamped by the server at append time.

`Carrier` is the Moving Carrier legal name and DOT for the Granot Carrier Code the extension sent. Lookup is `moving_carriers.granot_carrier_code`. Unknown codes are 400.

## Public API

`POST /api/v1/tariff-adjustments` accepts Owner or Customer Service Bearer (this route only). Legacy Employee Bearer is still allowed on this route. Sales Bearer is 403. The body is two snake_case rows. The server owns the spreadsheet id, `Master` tab, and headers. Response `data` is `{ appended, tab_name, updated_range, rows }` and never includes the spreadsheet id.

`appendTariffAdjustmentRows(rows, options?)` resolves Carrier, ensures the tab and header row, then `values.append`s. Inject `sheets` / `spreadsheetId` / `resolveCarrier` in tests. The route does not use Sheet Sync.

Non-owner Extension Users stay 403 on every other `/api/v1` data route.

Proof runner: `pnpm prove:tariff-append`. Seed Granot Carrier Codes: `pnpm db:seed-granot-carrier-codes -- --apply`.
