# Handoff: Referral form flag + missing Best Relocation FormLead

Date: 2026-08-20  
Repo: `vantage-main-server`  
Production API: `https://vantage-movers-main-server.vercel.app`  
Mongo: `vantagemovers`

Start a **new agent session**. This file is the source of truth for the two owner follow-ups below.

Do **not** put `VANTAGE_API_SECRET` in chat, commits, or this file. Read it from `vantage-main-server/.env` at run time.

---

## 1. Referral case 5562538 — form hidden

Admin case: `6a87839e81c59bffb67fdf0e`  
Mode: `create_referral_booking` (no Lead, no `source_scope`, no `suggested_lead`). That part is correct.

The official Referral form renders only when case detail `capabilities.commands` is true. For this mode the server requires **both**:

| Env var (Vercel **production**, `vantage-movers-main-server`) | Why |
| --- | --- |
| `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=true` | Owner command surface |
| `GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=true` | Extra gate for Referral-only |

Code: `src/services/granotLifecycle/projections.ts` (`capabilities.commands`). Admin hides `ReferralBookingForm` when `commands` is false and shows: “The official form appears here when owner booking work is enabled.”

Standard `create_missing_booking` cases (Grossinger, Feltz, Jackson) only need `BOOKING_COMMANDS`. That is why those forms appeared and this one did not.

Local `.env` already has `GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=true`. Production Vercel is what Admin calls. Set the var on the **server** project, Production scope, then redeploy. Confirm on `GET /api/v1/admin/granot-lifecycle/operations/health` → `flags.GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED`.

The Referral command does **not** attach a Lead. After the flag is on, the form is binder / deposit / agents / merchant only.

### This specific case may still refuse submit

Observation `6a8744e4eac3718160f4dab1` was captured **2:18 PM ET**, before activation **2:52:50 PM ET**. `createReferralBooking` requires `execution_mode === "live"` and `captured_at >= activated_at`. This evidence is pre-cutoff. Enabling the flag shows the form; submit can still `409 IDENTITY_CONFLICT` (“Accepted Referral Observation is incompatible with the case”).

For **this** job, use the existing owner Referral booking path in operational bookings if the lifecycle command refuses. Future post-activation Referral webhooks should finalize on the intake form once the Vercel flag is true.

Do not fake `captured_at` or delete the activation row.

---

## 2. Create the missing Best Relocation FormLead for job 5562824

### Why

Granot Booked webhook for Shannon Jackson is real. Case `6a87839f81c59bffb67fdf12` (`create_missing_booking`) has **no** `suggested_lead`. Identity was `pending_source_scoped_match`. Admin auto-selected leftover mock FormLead `6a29ad1fa4657a3144549b34` (`Mock BRF Webhook Test`) because source-scope browse is oldest-first. **Do not confirm on that mock.**

No FormLead exists for:

- `ref_no` `07e2c83c-dd55-442f-a732-7821e82f2f73`
- phone `2295604001`
- email `saavybydesign@gmail.com`

### Granot facts to copy onto the Lead

| Field | Value |
| --- | --- |
| Name | Shannon Jackson |
| Phone | 2295604001 |
| Email | saavybydesign@gmail.com |
| Granot job | 5562824 |
| Form ref (`ref_no`) | `07e2c83c-dd55-442f-a732-7821e82f2f73` |
| Source | Best Relocation Forms |
| Agent (Granot user/rep) | JOSH |
| Move date | 2026-09-11 |
| CF | 300 |
| From | Tampa, FL 33607 |
| To | Clinton Township, MI 48036 |
| Estimate / payment / balance | 2164.00 / 864.00 / 1300.00 (reference only; do not copy into official binder/deposit) |

Registry targets the case already uses:

- Source company: `6a4d240f3117eacd97823868` (`best_relocation_leads`)
- Granularity: `6a4d240f04c6e063cb6621f1` (`best_relocation_leads_form_long_distance`, Best Relocation Forms, long_distance)

### Create the Lead

`POST https://vantage-movers-main-server.vercel.app/api/v1/form-leads`

Headers:

- `content-type: application/json`
- `x-api-secret: <VANTAGE_API_SECRET from vantage-main-server/.env>`

`post_to_granot` **must stay false** — the job already exists in Granot.

```json
{
  "source_company": "best_relocation_leads",
  "company_slug": "best_relocation_leads",
  "source_granularity_key": "best_relocation_leads_form_long_distance",
  "crm_company_label": "Best Relocation Forms",
  "name": "Shannon Jackson",
  "first_name": "Shannon",
  "last_name": "Jackson",
  "phone_number": "2295604001",
  "email": "saavybydesign@gmail.com",
  "ref_no": "07e2c83c-dd55-442f-a732-7821e82f2f73",
  "pickup_city": "TAMPA",
  "pickup_state": "FL",
  "pickup_zip": "33607",
  "delivery_city": "CLINTON TOWNSHIP",
  "delivery_state": "MI",
  "destination_zip": "48036",
  "move_date": "2026-09-11",
  "move_size": "Studio",
  "cubic_feet": 300,
  "quoted": true,
  "post_to_granot": false
}
```

`move_size` is required on this route. 300 CF is sent as `Studio` so Zod accepts it. Identity match uses `ref_no` + phone/email + source scope, not bedroom size.

Example (secret stays in the shell env):

```bash
cd vantage-main-server
set -a && source .env && set +a
curl -sS -X POST "https://vantage-movers-main-server.vercel.app/api/v1/form-leads" \
  -H "content-type: application/json" \
  -H "x-api-secret: $VANTAGE_API_SECRET" \
  -d @- <<'EOF'
{ ...payload above... }
EOF
```

On Windows Git Bash the same `curl` works if `VANTAGE_API_SECRET` is exported from `.env`.

### After the Lead exists — auto match

1. Confirm `form_leads` has the new `_id`, `ref_no` exact, `lead_source_company` `6a4d240f3117eacd97823868`, `source_granularity_id` `6a4d240f04c6e063cb6621f1`.
2. Reload intake case `6a87839f81c59bffb67fdf12`. Candidate search is eligible for 24 hours after `opened_at` (2026-08-20T22:45:51.237Z).
3. Identity should now `linked` via `form_ref_no_exact` (high). That ranked match is pinned ahead of the mock browse row.
4. Confirm official binder / deposit / agents / merchant on **Shannon Jackson**, not the mock.
5. Do not mint a second Lead if the first create succeeded.

If the new Lead lands on the wrong granularity, do not confirm. Fix source assignment before owner confirm.

Creating the Lead does **not** write official `booked_leads`. Only the owner confirm command does that.

---

## Do not

- Confirm 5562824 against `Mock BRF Webhook Test`
- Set `post_to_granot: true`
- Put API secrets in the handoff or a commit
- Delete or rewrite the activation row to make Referral 5562538 look live
- Expect the Referral lifecycle command to accept this pre-cutoff Observation without a later operator exception
