# Operations Registry backfill seed report

Captured from live `vantagemovers` via MongoDB MCP on 2026-07-29, plus static
RingCentral queue mappings from
`src/services/ringcentral/call-lead-sources.ts`.

Machine-readable twin:
[`operations-registry-backfill-seed-report.json`](./operations-registry-backfill-seed-report.json)

Generate a fresh redacted candidate with mongoose. The command writes under
`scripts/output/` and does not overwrite this reviewed snapshot:

```text
pnpm migrations:dump-operations-registry-seed-surface -- --confirm-production-db=vantagemovers
# or with full JSON on stdout:
pnpm migrations:dump-operations-registry-seed-surface -- --confirm-production-db=vantagemovers --print-full
```

## Counts

| Surface | Total | Active | Inactive |
| --- | ---: | ---: | ---: |
| Agents | 20 | 14 | 6 |
| Merchants | 7 | 7 | 0 |
| LeadSourceCompany | 6 | 6 | 0 |
| Embedded granularities | 13 | — | — |
| RingCentral queue numbers | 5 | — | — |

## RingCentral Call Log queue numbers

Call Log sync fetches account-wide inbound detailed records, then matches
`to.phoneNumber` against these queue / company numbers (Operations Registry
snapshot after M5; legacy seed below).

| Phone | Source label | Company slug | Embedded on |
| --- | --- | --- | --- |
| `+18883164387` | 10best Inbounds | `tbm_leads` | `tbm_leads_call` |
| `+18883083612` | TBM Prime Inbounds | `tbm_prime_leads` | `tbm_prime_leads_call` |
| `+18887240625` | Top10 Inbounds | `top10_leads` | `top10_leads_call` |
| `+18884779232` | Main Site Inbounds | `main_site` | `main_site_call` |
| `+18883971005` | GetMovers Inbounds | `get_movers_leads` | `get_movers_leads_call` |

Parity: static map and embedded `inbound_phone_numbers` are an exact match.

Call granularity without a number (not in M5 static seed):

- `best_relocation_leads` / `best_relocation_leads_call` / Best Relocation Inbounds

## Agents (`agents`)

| Name | normalized_name | active | granot_crm_username | created_from |
| --- | --- | --- | --- | --- |
| Austin | austin | yes | AUSTIN | booked_lead |
| Brian | brian | yes | BRIAN | booked_lead |
| Chris | chris | no | — | best_relocation_sheet |
| Dylan | dylan | yes | DYLAN | booked_lead |
| House | house | yes | — | seed |
| Jacob | jacob | yes | JACOB | seed |
| Jason | jason | yes | JASON | seed |
| Jenna | jenna | yes | JENNA | admin |
| John V | john v | no | — | best_relocation_sheet |
| Josh | josh | yes | JOSH | booked_lead |
| JV | jv | no | — | best_relocation_sheet |
| Manny | manny | no | — | best_relocation_sheet |
| Mike | mike | yes | MIKEM | booked_lead |
| Nick | nick | yes | NICK | admin |
| Patrick | patrick | yes | PATRICKO | seed |
| Pierre | pierre | no | — | best_relocation_sheet |
| Roys | roys | yes | ROY | booked_lead |
| Sean | sean | yes | SEAN | admin |
| Sil | sil | yes | SIL | booked_lead |
| Ted | ted | no | — | best_relocation_sheet |

Notes for M2: no `name_aliases` or `granot_identity` populated in this capture.
`House` and inactive Best Relocation sheet agents have no CRM username.

## Merchants (`merchants`)

| Name | normalized_name | active | created_from |
| --- | --- | --- | --- |
| Cardpointe | cardpointe | yes | seed |
| Elavon | elavon | yes | seed |
| EMS | ems | yes | seed |
| Maverick | maverick | yes | seed |
| Paper Check | paper check | yes | seed |
| Seamless | seamless | yes | seed |
| Wire Transfer ACH | wire transfer ach | yes | seed |

All merchants have empty `name_aliases`.

## LeadSourceCompany (`lead_source_companies`)

Static `SOURCE_COMPANIES` also includes `not_provided`; it is **not** present
in the database.

### best_relocation_leads

- Defaults: form `best_relocation_leads_form_long_distance`, call `best_relocation_leads_call`
- Granularities:
  - form / Best Relocation Forms / CPL 195 / local=long_distance
  - form / Best Relocation Locals / CPL 40 / local=local
  - call / Best Relocation Inbounds / CPL 195 / **no inbound numbers**

### get_movers_leads

- Defaults: form `get_movers_leads_form`, call `get_movers_leads_call`
- Granularities:
  - form / GetMovers Forms / CPL 0
  - call / GetMovers Inbounds / CPL 0 / `+18883971005`

### main_site

- Defaults: form `main_site_form`, call `main_site_call`
- Granularities:
  - form / Main Site Forms / CPL 0
  - call / Main Site Inbounds / CPL 0 / `+18884779232`

### tbm_leads

- Defaults: form `tbm_leads_form`, call `tbm_leads_call`
- Granularities:
  - form / TBM Forms / CPL 190
  - call / 10best Inbounds / CPL 190 / `+18883164387`

### tbm_prime_leads

- Defaults: form `tbm_prime_leads_form`, call `tbm_prime_leads_call`
- Granularities:
  - form / TBM Prime Forms / CPL 190
  - call / TBM Prime Inbounds / CPL 190 / `+18883083612`

### top10_leads

- Defaults: form `top10_leads_form`, call `top10_leads_call`
- Granularities:
  - form / Top10 Forms / CPL 190
  - call / Top10 Inbounds / CPL 190 / `+18887240625`

Full aliases, ObjectIds, timestamps, and sheet_config live in the JSON twin.
