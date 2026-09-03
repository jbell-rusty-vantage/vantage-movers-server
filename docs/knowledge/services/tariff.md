---
type: Service
title: Tariff Service
description: Append-only tariff adjustment rows to TARIFF_SHEET_ID. No customer or job identifiers.
tags: [tariff, google-sheets]
status: active
stale_after: 2026-12-01
resource: src/services/tariff/append.ts
applies_to:
  - src/services/tariff/append.ts
  - src/routes/tariff-adjustments.routes.ts
  - src/validation/v1/tariffAdjustments.validation.ts
  - src/middleware/requireApiSecret.ts
  - src/config/domain/tariff.ts
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
  at: 2026-09-01T15:40:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Official spec:** [`../../../../docs/tariff-adjustment/tariff-adjustment-specification.md`](../../../../docs/tariff-adjustment/tariff-adjustment-specification.md)  
**Primary code:** `src/services/tariff/append.ts`  
**Domain terms used:** [Tariff Adjustment](../../../../CONTEXT.md), [Tariff Adjustment Submit](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md)

# Tariff Service

**Role:** Append two tariff adjustment rows per Granot Forms View parse to `TARIFF_SHEET_ID` / `TARIFFS`. **Append-only.** Does not upsert. Does not write customer name, phone, email, job number, or ref.

**Not Sheet Sync.** This is a separate owner spreadsheet. It does not use the lead/booking outbox or Mongo IDs.

## Row shape

`Effective Date`, `Pickup Zone`, `Delivery Zone`, `Service`, `Rule`, `New Rule`, `Carrier`.

`Service` is `Linehaul` or `Additional Services`. The two rows share date, zones, and carrier.

`Carrier` is the Granot Forms View Agent text today. A Granot Agent → Moving Carrier name+DOT map will be added later.

## Public API

`POST /api/v1/tariff-adjustments` accepts Owner or Customer Service Bearer (this route only). Legacy Employee Bearer is still allowed on this route. Sales Bearer is 403. The body is two snake_case rows. The server owns the spreadsheet id, `TARIFFS` tab, and headers. Response `data` is `{ appended, tab_name, updated_range, rows }` and never includes the spreadsheet id.

`appendTariffAdjustmentRows(rows, options?)` ensures the tab and header row, then `values.append`s. Inject `sheets` / `spreadsheetId` in tests. The route does not use Sheet Sync or Mongo.

Non-owner Extension Users stay 403 on every other `/api/v1` data route.

Proof runner: `pnpm prove:tariff-append`.
