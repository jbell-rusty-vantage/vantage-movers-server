---
type: Service
title: Tariff Service
description: Append-only tariff adjustment rows to TARIFF_SHEET_ID. No customer or job identifiers.
tags: [tariff, google-sheets]
status: draft
stale_after: 2026-12-01
resource: src/services/tariff/append.ts
applies_to:
  - src/services/tariff/append.ts
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

`appendTariffAdjustmentRows(rows, options?)` ensures the tab and header row, then `values.append`s. Inject `sheets` / `spreadsheetId` in tests.

Proof runner: `pnpm prove:tariff-append`.
