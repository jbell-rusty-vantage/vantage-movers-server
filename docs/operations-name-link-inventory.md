# Operations name link inventory

Generated from live MongoDB via mongoose. This is a spelling and mapping inventory so source companies, granularities, agents, merchants, RingCentral inbound queues, Granot CRM labels, and webhook receipt `source` / `user` / `rep` values can be lined up exactly.

| Field | Value |
| --- | --- |
| Captured at | 2026-08-13T16:11:22.360Z |
| Database | vantagemovers |
| Confirmation | --confirm-production-db=vantagemovers |
| Source companies | 6 |
| Granularities | 13 |
| Agents | 20 |
| Merchants | 7 |
| RingCentral inbound routes | 5 |
| RingCentral assignments | 5 |
| GranotCrmSource rows | 4 |
| Granot automation source labels | 9 |
| Distinct webhook payload.source values | 10 |

## 1. Source companies and granularities

Canonical registry is `lead_source_companies`. Each company has embedded granularities. Form/call ingest, RingCentral routing, and Granot label mapping should all resolve to a `company_slug` + `granularity_key`.

### `best_relocation_leads` — Best Relocation Leads

| Field | Value |
| --- | --- |
| _id | 6a4d240f3117eacd97823868 |
| name | Best Relocation Leads |
| owner_label | Best Relocation Leads |
| aliases | Best Relocation Leads \| Best Relocation \| BestRelocation.com \| Best Relocation Forms \| Best Relocation Locals \| Best Relocation Inbounds \| BestRelocation Forms \| BestRelocation Locals \| BestRelocation Inbounds |
| active | yes |
| default_form_granularity_key | best_relocation_leads_form_long_distance |
| default_call_granularity_key | best_relocation_leads_call |
| created_from | legacy_seed |
| static config label | Best Relocation Leads |
| static config aliases | Best Relocation Leads \| Best Relocation \| BestRelocation.com |

| granularity_key | channel | owner_label | crm_label | aliases | inbound_phone_numbers | source_sites | active | cpl | sheet_tab_name |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| best_relocation_leads_form_long_distance | form | Best Relocation Forms | Best Relocation Forms | Best Relocation Forms \| BestRelocation Forms | — | — | yes | 195 | — |
| best_relocation_leads_form_local | form | Best Relocation Locals | Best Relocation Locals | Best Relocation Locals \| BestRelocation Locals | — | — | yes | 40 | — |
| best_relocation_leads_call | call | Best Relocation Inbounds | Best Relocation Inbounds | Best Relocation Inbounds \| BestRelocation Inbounds | — | — | yes | 195 | — |

### `get_movers_leads` — GetMovers Leads

| Field | Value |
| --- | --- |
| _id | 6a4d240f3117eacd9782386a |
| name | GetMovers Leads |
| owner_label | GetMovers Leads |
| aliases | GetMovers Leads \| Get Movers Leads \| Get Movers \| GetMovers \| get_movers_leads \| GetMovers Forms \| Get Movers Forms \| GetMovers Inbounds \| Get Movers Inbounds |
| active | yes |
| default_form_granularity_key | get_movers_leads_form |
| default_call_granularity_key | get_movers_leads_call |
| created_from | legacy_seed |
| static config label | GetMovers Leads |
| static config aliases | GetMovers Leads \| Get Movers Leads \| Get Movers \| GetMovers \| get_movers_leads |

| granularity_key | channel | owner_label | crm_label | aliases | inbound_phone_numbers | source_sites | active | cpl | sheet_tab_name |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| get_movers_leads_form | form | GetMovers Forms | GetMovers Forms | GetMovers Forms \| Get Movers \| Get Movers Forms | — | — | yes | 0 | — |
| get_movers_leads_call | call | GetMovers Inbounds | GetMovers Inbounds | GetMovers Inbounds \| Get Movers Inbounds | +18883971005 | — | yes | 0 | — |

### `main_site` — main site

| Field | Value |
| --- | --- |
| _id | 6a4d240f3117eacd97823869 |
| name | main site |
| owner_label | main site |
| aliases | main site \| main_site \| mainsite \| Vantage Movers \| vantage_movers \| vantagemovers.com \| Main Site Forms \| Main Site Inbounds |
| active | yes |
| default_form_granularity_key | main_site_form |
| default_call_granularity_key | main_site_call |
| created_from | legacy_seed |
| static config label | main site |
| static config aliases | main site \| main_site \| mainsite \| Vantage Movers \| vantage_movers \| vantagemovers.com |

| granularity_key | channel | owner_label | crm_label | aliases | inbound_phone_numbers | source_sites | active | cpl | sheet_tab_name |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| main_site_form | form | Main Site Forms | Main Site Forms | Main Site Forms | — | — | yes | 0 | — |
| main_site_call | call | Main Site Inbounds | Main Site Inbounds | Main Site Inbounds | +18884779232 | — | yes | 0 | — |

### `tbm_leads` — TBM Leads

| Field | Value |
| --- | --- |
| _id | 6a4d240f3117eacd97823866 |
| name | TBM Leads |
| owner_label | TBM Leads |
| aliases | TBM Leads \| tbm \| 10best \| 10best Leads \| 10 Best Leads \| 10bestmovingcompanies.com \| TBM Forms \| 10 Best Inbounds \| 10Best Inbounds \| 10best Inbounds |
| active | yes |
| default_form_granularity_key | tbm_leads_form |
| default_call_granularity_key | tbm_leads_call |
| created_from | legacy_seed |
| static config label | TBM Leads |
| static config aliases | TBM Leads \| tbm \| 10best \| 10best Leads \| 10 Best Leads \| 10bestmovingcompanies.com |

| granularity_key | channel | owner_label | crm_label | aliases | inbound_phone_numbers | source_sites | active | cpl | sheet_tab_name |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tbm_leads_form | form | TBM Forms | TBM Forms | TBM Forms | — | — | yes | 190 | — |
| tbm_leads_call | call | 10best Inbounds | 10best Inbounds | 10best Inbounds \| 10 Best Inbounds \| 10Best Inbounds | +18883164387 | — | yes | 190 | — |

### `tbm_prime_leads` — TBM Prime Leads

| Field | Value |
| --- | --- |
| _id | 6a4d240f3117eacd97823867 |
| name | TBM Prime Leads |
| owner_label | TBM Prime Leads |
| aliases | TBM Prime Leads \| TBM Prime \| Topmovingexperts.com \| TBM Forms Prime \| TBM Prime Forms \| TBM Prime Inbounds |
| active | yes |
| default_form_granularity_key | tbm_prime_leads_form |
| default_call_granularity_key | tbm_prime_leads_call |
| created_from | legacy_seed |
| static config label | TBM Prime Leads |
| static config aliases | TBM Prime Leads \| TBM Prime \| Topmovingexperts.com |

| granularity_key | channel | owner_label | crm_label | aliases | inbound_phone_numbers | source_sites | active | cpl | sheet_tab_name |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tbm_prime_leads_form | form | TBM Prime Forms | TBM Prime Forms | TBM Prime Forms \| TBM Forms Prime | — | — | yes | 190 | — |
| tbm_prime_leads_call | call | TBM Prime Inbounds | TBM Prime Inbounds | TBM Prime Inbounds | +18883083612 | — | yes | 190 | — |

### `top10_leads` — Top 10 Forms

| Field | Value |
| --- | --- |
| _id | 6a4d240f3117eacd9782386b |
| name | Top 10 Forms |
| owner_label | Top 10 Forms |
| aliases | Top 10 Leads \| Top10 Leads \| Top 10 \| Top10 Forms \| Top10 Inbounds |
| active | yes |
| default_form_granularity_key | top10_leads_form |
| default_call_granularity_key | top10_leads_call |
| created_from | legacy_seed |
| static config label | Top 10 Forms |
| static config aliases | Top 10 Leads \| Top10 Leads \| Top 10 |

| granularity_key | channel | owner_label | crm_label | aliases | inbound_phone_numbers | source_sites | active | cpl | sheet_tab_name |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| top10_leads_form | form | Top10 Forms | Top10 Forms | Top10 Forms | — | — | yes | 190 | — |
| top10_leads_call | call | Top10 Inbounds | Top10 Inbounds | Top10 Inbounds | +18887240625 | — | yes | 190 | — |

## 2. Agents

Webhook `payload.user` and `payload.rep` must map to `granot_crm_username` or `granot_identity.username` (both stored uppercase). `name` / `name_aliases` are the Vantage-facing spellings.

| name | normalized_name | aliases | granot_crm_username | granot_identity.username | identity verified | active | role |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Austin | austin | — | AUSTIN | AUSTIN | yes | yes | agent |
| Brian | brian | — | BRIAN | BRIAN | yes | yes | agent |
| Chris | chris | — | — | — | — | no | agent |
| Dylan | dylan | — | DYLAN | DYLAN | yes | yes | agent |
| House | house | — | — | — | — | yes | agent |
| Jacob | jacob | — | JACOB | JACOB | yes | yes | agent |
| Jason | jason | — | JASON | JASON | yes | yes | agent |
| Jenna | jenna | — | JENNA | JENNA | yes | yes | agent |
| John V | john v | — | — | — | — | no | agent |
| Josh | josh | — | JOSH | JOSH | yes | yes | agent |
| JV | jv | — | — | — | — | no | agent |
| Manny | manny | — | — | — | — | no | agent |
| Mike | mike | — | MIKEM | MIKEM | yes | yes | agent |
| Nick | nick | — | NICK | NICK | yes | yes | agent |
| Patrick | patrick | — | PATRICKO | PATRICKO | yes | yes | agent |
| Pierre | pierre | — | — | — | — | no | agent |
| Roys | roys | — | ROY | ROY | yes | yes | agent |
| Sean | sean | — | SEAN | SEAN | yes | yes | agent |
| Sil | sil | — | SIL | SIL | yes | yes | agent |
| Ted | ted | — | — | — | — | no | agent |

## 3. Merchants

| name | normalized_name | aliases | active | created_from |
| --- | --- | --- | --- | --- |
| Cardpointe | cardpointe | — | yes | seed |
| Elavon | elavon | — | yes | seed |
| EMS | ems | — | yes | seed |
| Maverick | maverick | — | yes | seed |
| Paper Check | paper check | — | yes | seed |
| Seamless | seamless | — | yes | seed |
| Wire Transfer ACH | wire transfer ach | — | yes | seed |

## 4. RingCentral inbound queue numbers

A route's live source mapping is the **active assignment** on `ringcentral_inbound_route_assignments`, which points at a source company + embedded granularity `_id`. The same E.164 number should also appear on that granularity's `inbound_phone_numbers`. The static `RINGCENTRAL_INBOUND_NUMBER_TO_SOURCE` map is a legacy fallback only.

| phone_number | display_label | active | validation | queue_name | assigned company_slug | assigned granularity_key | assigned crm_label | listed on granularity inbound numbers | static fallback map | observed_target_names |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| +18883083612 | TBM Prime Inbounds | yes | valid | Inbound ONLY | tbm_prime_leads | tbm_prime_leads_call | TBM Prime Inbounds | yes | TBM Prime Inbounds → tbm_prime_leads | Inbound ONLY \| TBM Prime Inbounds |
| +18883164387 | 10best Inbounds | yes | valid | Inbound ONLY | tbm_leads | tbm_leads_call | 10best Inbounds | yes | 10best Inbounds → tbm_leads | Inbound ONLY \| 10BEST LANDING |
| +18883971005 | GetMovers Inbounds | yes | valid | Inbound ONLY | get_movers_leads | get_movers_leads_call | GetMovers Inbounds | yes | GetMovers Inbounds → get_movers_leads | Inbound ONLY |
| +18884779232 | Main Site Inbounds | yes | valid | Inbound ONLY | main_site | main_site_call | Main Site Inbounds | yes | Main Site Inbounds → main_site | Inbound ONLY \| Main Site Inbounds |
| +18887240625 | Top10 Inbounds | yes | valid | Inbound ONLY | top10_leads | top10_leads_call | Top10 Inbounds | yes | Top10 Inbounds → top10_leads | Inbound ONLY \| TOP 10 INBOUNDS |

### Call granularities and inbound numbers

| company_slug | granularity_key | crm_label | inbound_phone_numbers | matching RC route |
| --- | --- | --- | --- | --- |
| best_relocation_leads | best_relocation_leads_call | Best Relocation Inbounds | NONE | — |
| get_movers_leads | get_movers_leads_call | GetMovers Inbounds | +18883971005 | +18883971005 → GetMovers Inbounds |
| main_site | main_site_call | Main Site Inbounds | +18884779232 | +18884779232 → Main Site Inbounds |
| tbm_leads | tbm_leads_call | 10best Inbounds | +18883164387 | +18883164387 → 10best Inbounds |
| tbm_prime_leads | tbm_prime_leads_call | TBM Prime Inbounds | +18883083612 | +18883083612 → TBM Prime Inbounds |
| top10_leads | top10_leads_call | Top10 Inbounds | +18887240625 | +18887240625 → Top10 Inbounds |

## 5. GranotCrmSource

These are the Granot-side labels. Incoming webhook `payload.source` must match `granot_label` (or a granularity `crm_label` / alias). `source_company` on this collection is the Vantage slug string.

| granot_label | crm_origin | workspace_slug | source_company (slug) | default_channel | enabled | matches granularity crm_label | notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| unmapped/book_advr1628 | https://eagle.hellomoving.com | unmapped/book-advr1628 | not_provided | unknown | no | NO | NO granularity crm_label/alias; UNKNOWN slug not_provided; Auto-created from Granot CSV upload; source mapping needs review. |
| unmapped/book_advr4878 | https://eagle.hellomoving.com | unmapped/book-advr4878 | not_provided | unknown | no | NO | NO granularity crm_label/alias; UNKNOWN slug not_provided; Auto-created from Granot CSV upload; source mapping needs review. |
| unmapped/follow_advr1628 | https://eagle.hellomoving.com | unmapped/follow-advr1628 | not_provided | unknown | no | NO | NO granularity crm_label/alias; UNKNOWN slug not_provided; Auto-created from Granot CSV upload; source mapping needs review. |
| unmapped/follow_advr4894 | https://eagle.hellomoving.com | unmapped/follow-advr4894 | not_provided | unknown | no | NO | NO granularity crm_label/alias; UNKNOWN slug not_provided; Auto-created from Granot CSV upload; source mapping needs review. |

### Granot automation source catalog (separate collection)

Labels the HTTP/extension automation picker uses. These should stay in lockstep with `GranotCrmSource.granot_label` and granularity `crm_label`.

| label | active | supported_operations | created_from | matches GranotCrmSource | matches crm_label |
| --- | --- | --- | --- | --- | --- |
| 10best Inbounds | yes | call_leads | seed | NO | exact |
| Best Relocation Forms | yes | form_leads | seed | NO | exact |
| BestRelocation Inbounds | yes | call_leads | seed | NO | NO |
| Main Site Forms | yes | form_leads | seed | NO | exact |
| TBM Forms | yes | form_leads | seed | NO | exact |
| TBM Forms Prime | yes | form_leads | seed | NO | NO |
| TBM Prime Inbounds | yes | call_leads | seed | NO | exact |
| Top10 Forms | yes | form_leads | seed | NO | exact |
| Top10 Inbounds | yes | call_leads | seed | NO | exact |

## 6. Live Granot webhook receipt sources

Distinct `payload.source` (or legacy `payload.Source`) values currently in `granot_webhook_receipts`. This is the spelling Granot is actually sending.

| webhook source | receipts | GranotCrmSource.granot_label | granularity crm_label | granularity alias | SOURCE_LABEL_TO_COMPANY | automation catalog | resolved company_slug |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Paid Overflow | 33 | MISSING | MISSING | — | MISSING | MISSING | UNRESOLVED |
| TBM Forms | 26 | MISSING | exact | — | tbm_leads | exact | tbm_leads |
| Best Relocation Forms | 21 | MISSING | exact | — | best_relocation_leads | exact | best_relocation_leads |
| Top10 Forms | 19 | MISSING | exact | — | top10_leads | exact | top10_leads |
| 10best Inbounds | 11 | MISSING | exact | — | tbm_leads | exact | tbm_leads |
| Top10 Inbounds | 8 | MISSING | exact | — | top10_leads | exact | top10_leads |
| TBM Forms Prime | 8 | MISSING | MISSING | exact → TBM Forms Prime | tbm_prime_leads | exact | tbm_prime_leads |
| BestRelocation Inbounds | 4 | MISSING | MISSING | exact → BestRelocation Inbounds | best_relocation_leads | exact | best_relocation_leads |
| Main Site Forms | 2 | MISSING | exact | — | main_site | exact | main_site |
| Referral | 2 | MISSING | MISSING | — | MISSING | MISSING | UNRESOLVED |

## 7. Webhook user / rep → agents

Distinct non-empty `payload.user` and `payload.rep` values from live receipts, matched to agent Granot usernames.

| webhook user/rep | receipts mentioning it | agent name | granot_crm_username | identity.username | agent active |
| --- | --- | --- | --- | --- | --- |
| AUSTIN | 21 | Austin | AUSTIN | AUSTIN | yes |
| BRIAN | 2 | Brian | BRIAN | BRIAN | yes |
| DYLAN | 13 | Dylan | DYLAN | DYLAN | yes |
| GEVANS | 1 | UNMAPPED | — | — | — |
| JACOB | 2 | Jacob | JACOB | JACOB | yes |
| JOSH | 12 | Josh | JOSH | JOSH | yes |
| MIKEM | 11 | Mike | MIKEM | MIKEM | yes |
| NICK | 10 | Nick | NICK | NICK | yes |
| PATRICKO | 6 | Patrick | PATRICKO | PATRICKO | yes |
| ROY | 12 | Roys | ROY | ROY | yes |
| SIL | 4 | Sil | SIL | SIL | yes |

## 8. Stored lead source spellings

Distinct `source_company` and `crm_source_label_snapshot` already persisted on Form Leads and Call Leads. These show what ingest actually wrote, not customer data.

### FormLead.source_company
`best_relocation_leads`, `main_site`, `tbm_leads`, `tbm_prime_leads`, `top10_leads`

### FormLead.crm_source_label_snapshot
`Best Relocation Forms`, `Best Relocation Locals`, `Main Site Forms`, `TBM Forms`, `TBM Prime Forms`, `Top10 Forms`

### CallLead.source_company
`best_relocation_leads`, `main_site`, `tbm_leads`, `tbm_prime_leads`, `top10_leads`

### CallLead.crm_source_label_snapshot
`10best Inbounds`, `Best Relocation Inbounds`, `Main Site Inbounds`, `TBM Prime Inbounds`, `Top10 Inbounds`

## 9. Static code maps (for comparison)

### CRM_SOURCE_LABELS
`TBM Forms`, `10best Inbounds`, `TBM Prime Forms`, `TBM Prime Inbounds`, `Top10 Forms`, `Top10 Inbounds`, `Best Relocation Forms`, `Best Relocation Locals`, `Best Relocation Inbounds`, `GetMovers Forms`, `GetMovers Inbounds`, `Main Site Forms`, `Main Site Inbounds`

### SOURCE_LABEL_TO_COMPANY

| label | company_slug |
| --- | --- |
| Main Site Forms | main_site |
| Main Site Inbounds | main_site |
| Get Movers | get_movers_leads |
| GetMovers Forms | get_movers_leads |
| Get Movers Forms | get_movers_leads |
| GetMovers Inbounds | get_movers_leads |
| Get Movers Inbounds | get_movers_leads |
| TBM Forms | tbm_leads |
| TBM Prime Forms | tbm_prime_leads |
| TBM Forms Prime | tbm_prime_leads |
| TBM Prime Inbounds | tbm_prime_leads |
| Top10 Forms | top10_leads |
| Top10 Inbounds | top10_leads |
| 10 Best Inbounds | tbm_leads |
| 10Best Inbounds | tbm_leads |
| 10best Inbounds | tbm_leads |
| Best Relocation Forms | best_relocation_leads |
| Best Relocation Locals | best_relocation_leads |
| Best Relocation Inbounds | best_relocation_leads |
| BestRelocation Forms | best_relocation_leads |
| BestRelocation Locals | best_relocation_leads |
| BestRelocation Inbounds | best_relocation_leads |

## 10. Gaps that will break linking

| Gap | Count | Values |
| --- | --- | --- |
| Webhook payload.source with no GranotCrmSource.granot_label | 10 | Paid Overflow \| TBM Forms \| Best Relocation Forms \| Top10 Forms \| 10best Inbounds \| Top10 Inbounds \| TBM Forms Prime \| BestRelocation Inbounds \| Main Site Forms \| Referral |
| Webhook payload.source with no granularity crm_label or alias | 2 | Paid Overflow \| Referral |
| GranotCrmSource.granot_label with no matching granularity crm_label/alias | 4 | unmapped/book_advr1628 \| unmapped/book_advr4878 \| unmapped/follow_advr1628 \| unmapped/follow_advr4894 |
| GranotCrmSource.source_company slug not in lead_source_companies | 4 | unmapped/book_advr1628 → not_provided \| unmapped/book_advr4878 → not_provided \| unmapped/follow_advr1628 → not_provided \| unmapped/follow_advr4894 → not_provided |
| Webhook user/rep with no matching agent Granot username | 1 | GEVANS |
| Active agents with no Granot username at all | 1 | House |
| RingCentral routes with no active assignment | 0 | none |
| Assigned RC number missing from that granularity inbound_phone_numbers | 0 | none |

## 11. Master source-spelling index

Every distinct source-related string across registry, Granot catalogs, static maps, webhook receipts, and stored leads. Use this to catch `BestRelocation` vs `Best Relocation`, `TBM Forms Prime` vs `TBM Prime Forms`, `Paid Overflow`, etc.

| exact spelling | seen in |
| --- | --- |
| 10 Best Inbounds | SOURCE_LABEL_TO_COMPANY key · granularity.aliases (tbm_leads_call) · lead_source_companies.aliases (tbm_leads) |
| 10 Best Leads | lead_source_companies.aliases (tbm_leads) |
| 10best | lead_source_companies.aliases (tbm_leads) |
| 10best Inbounds | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granot_automation_sources.label · granot_webhook_receipts.payload.source · granularity.aliases (tbm_leads_call) · granularity.crm_label · granularity.owner_label · lead.crm_source_label_snapshot · lead_source_companies.aliases (tbm_leads) |
| 10Best Inbounds | SOURCE_LABEL_TO_COMPANY key · granularity.aliases (tbm_leads_call) · lead_source_companies.aliases (tbm_leads) |
| 10best Leads | lead_source_companies.aliases (tbm_leads) |
| 10bestmovingcompanies.com | lead_source_companies.aliases (tbm_leads) |
| Best Relocation | lead_source_companies.aliases (best_relocation_leads) |
| Best Relocation Forms | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granot_automation_sources.label · granot_webhook_receipts.payload.source · granularity.aliases (best_relocation_leads_form_long_distance) · granularity.crm_label · granularity.owner_label · lead.crm_source_label_snapshot · lead_source_companies.aliases (best_relocation_leads) |
| Best Relocation Inbounds | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granularity.aliases (best_relocation_leads_call) · granularity.crm_label · granularity.owner_label · lead.crm_source_label_snapshot · lead_source_companies.aliases (best_relocation_leads) |
| Best Relocation Leads | lead_source_companies.aliases (best_relocation_leads) · lead_source_companies.name · lead_source_companies.owner_label |
| Best Relocation Locals | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granularity.aliases (best_relocation_leads_form_local) · granularity.crm_label · granularity.owner_label · lead.crm_source_label_snapshot · lead_source_companies.aliases (best_relocation_leads) |
| best_relocation_leads | SOURCE_LABEL_TO_COMPANY value · lead.source_company · lead_source_companies.company_slug |
| best_relocation_leads_call | granularity_key |
| best_relocation_leads_form_local | granularity_key |
| best_relocation_leads_form_long_distance | granularity_key |
| BestRelocation Forms | SOURCE_LABEL_TO_COMPANY key · granularity.aliases (best_relocation_leads_form_long_distance) · lead_source_companies.aliases (best_relocation_leads) |
| BestRelocation Inbounds | SOURCE_LABEL_TO_COMPANY key · granot_automation_sources.label · granot_webhook_receipts.payload.source · granularity.aliases (best_relocation_leads_call) · lead_source_companies.aliases (best_relocation_leads) |
| BestRelocation Locals | SOURCE_LABEL_TO_COMPANY key · granularity.aliases (best_relocation_leads_form_local) · lead_source_companies.aliases (best_relocation_leads) |
| BestRelocation.com | lead_source_companies.aliases (best_relocation_leads) |
| Get Movers | SOURCE_LABEL_TO_COMPANY key · granularity.aliases (get_movers_leads_form) · lead_source_companies.aliases (get_movers_leads) |
| Get Movers Forms | SOURCE_LABEL_TO_COMPANY key · granularity.aliases (get_movers_leads_form) · lead_source_companies.aliases (get_movers_leads) |
| Get Movers Inbounds | SOURCE_LABEL_TO_COMPANY key · granularity.aliases (get_movers_leads_call) · lead_source_companies.aliases (get_movers_leads) |
| Get Movers Leads | lead_source_companies.aliases (get_movers_leads) |
| get_movers_leads | SOURCE_LABEL_TO_COMPANY value · lead_source_companies.aliases (get_movers_leads) · lead_source_companies.company_slug |
| get_movers_leads_call | granularity_key |
| get_movers_leads_form | granularity_key |
| GetMovers | lead_source_companies.aliases (get_movers_leads) |
| GetMovers Forms | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granularity.aliases (get_movers_leads_form) · granularity.crm_label · granularity.owner_label · lead_source_companies.aliases (get_movers_leads) |
| GetMovers Inbounds | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granularity.aliases (get_movers_leads_call) · granularity.crm_label · granularity.owner_label · lead_source_companies.aliases (get_movers_leads) |
| GetMovers Leads | lead_source_companies.aliases (get_movers_leads) · lead_source_companies.name · lead_source_companies.owner_label |
| main site | lead_source_companies.aliases (main_site) · lead_source_companies.name · lead_source_companies.owner_label |
| Main Site Forms | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granot_automation_sources.label · granot_webhook_receipts.payload.source · granularity.aliases (main_site_form) · granularity.crm_label · granularity.owner_label · lead.crm_source_label_snapshot · lead_source_companies.aliases (main_site) |
| Main Site Inbounds | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granularity.aliases (main_site_call) · granularity.crm_label · granularity.owner_label · lead.crm_source_label_snapshot · lead_source_companies.aliases (main_site) |
| main_site | SOURCE_LABEL_TO_COMPANY value · lead.source_company · lead_source_companies.aliases (main_site) · lead_source_companies.company_slug |
| main_site_call | granularity_key |
| main_site_form | granularity_key |
| mainsite | lead_source_companies.aliases (main_site) |
| not_provided | granot_crm_sources.source_company |
| Paid Overflow | granot_webhook_receipts.payload.source |
| Referral | granot_webhook_receipts.payload.source |
| tbm | lead_source_companies.aliases (tbm_leads) |
| TBM Forms | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granot_automation_sources.label · granot_webhook_receipts.payload.source · granularity.aliases (tbm_leads_form) · granularity.crm_label · granularity.owner_label · lead.crm_source_label_snapshot · lead_source_companies.aliases (tbm_leads) |
| TBM Forms Prime | SOURCE_LABEL_TO_COMPANY key · granot_automation_sources.label · granot_webhook_receipts.payload.source · granularity.aliases (tbm_prime_leads_form) · lead_source_companies.aliases (tbm_prime_leads) |
| TBM Leads | lead_source_companies.aliases (tbm_leads) · lead_source_companies.name · lead_source_companies.owner_label |
| TBM Prime | lead_source_companies.aliases (tbm_prime_leads) |
| TBM Prime Forms | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granularity.aliases (tbm_prime_leads_form) · granularity.crm_label · granularity.owner_label · lead.crm_source_label_snapshot · lead_source_companies.aliases (tbm_prime_leads) |
| TBM Prime Inbounds | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granot_automation_sources.label · granularity.aliases (tbm_prime_leads_call) · granularity.crm_label · granularity.owner_label · lead.crm_source_label_snapshot · lead_source_companies.aliases (tbm_prime_leads) |
| TBM Prime Leads | lead_source_companies.aliases (tbm_prime_leads) · lead_source_companies.name · lead_source_companies.owner_label |
| tbm_leads | SOURCE_LABEL_TO_COMPANY value · lead.source_company · lead_source_companies.company_slug |
| tbm_leads_call | granularity_key |
| tbm_leads_form | granularity_key |
| tbm_prime_leads | SOURCE_LABEL_TO_COMPANY value · lead.source_company · lead_source_companies.company_slug |
| tbm_prime_leads_call | granularity_key |
| tbm_prime_leads_form | granularity_key |
| Top 10 | lead_source_companies.aliases (top10_leads) |
| Top 10 Forms | lead_source_companies.name · lead_source_companies.owner_label |
| Top 10 Leads | lead_source_companies.aliases (top10_leads) |
| Top10 Forms | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granot_automation_sources.label · granot_webhook_receipts.payload.source · granularity.aliases (top10_leads_form) · granularity.crm_label · granularity.owner_label · lead.crm_source_label_snapshot · lead_source_companies.aliases (top10_leads) |
| Top10 Inbounds | CRM_SOURCE_LABELS · SOURCE_LABEL_TO_COMPANY key · granot_automation_sources.label · granot_webhook_receipts.payload.source · granularity.aliases (top10_leads_call) · granularity.crm_label · granularity.owner_label · lead.crm_source_label_snapshot · lead_source_companies.aliases (top10_leads) |
| Top10 Leads | lead_source_companies.aliases (top10_leads) |
| top10_leads | SOURCE_LABEL_TO_COMPANY value · lead.source_company · lead_source_companies.company_slug |
| top10_leads_call | granularity_key |
| top10_leads_form | granularity_key |
| Topmovingexperts.com | lead_source_companies.aliases (tbm_prime_leads) |
| unmapped/book_advr1628 | granot_crm_sources.granot_label |
| unmapped/book_advr4878 | granot_crm_sources.granot_label |
| unmapped/follow_advr1628 | granot_crm_sources.granot_label |
| unmapped/follow_advr4894 | granot_crm_sources.granot_label |
| Vantage Movers | lead_source_companies.aliases (main_site) |
| vantage_movers | lead_source_companies.aliases (main_site) |
| vantagemovers.com | lead_source_companies.aliases (main_site) |
