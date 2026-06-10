# Best Relocation Forms Webhook

This webhook creates a Vantage Movers form lead from a Best Relocation Forms submission.

## Endpoint

Send an HTTPS `POST` request to:

```text
https://vantage-movers-main-server.vercel.app/api/v1/form-leads
```

Required headers:

```http
Content-Type: application/json
x-api-secret: <provided webhook secret>
```

The webhook key will be provided separately. Treat it like a password and do not expose it in browser-side code, public repositories, logs, or screenshots.

## Request Body

Send JSON only. The API validates the body strictly, so do not include extra fields.

Example payload:

```json
{
  "source_company": "Best Relocation Forms",
  "first_name": "Jane",
  "last_name": "Customer",
  "pickup_zip": "10001",
  "destination_zip": "33101",
  "move_size": "2 Bedrooms",
  "move_date": "2026-07-15",
  "ref_no": "BRF-10001",
  "email": "jane.customer@example.com",
  "phone_number": "5555551212"
}
```

Required fields:

- `source_company`: send exactly `Best Relocation Forms`.
- `first_name`: customer's first name.
- `last_name`: customer's last name.
- `pickup_zip`: 5-digit pickup ZIP code.
- `destination_zip`: 5-digit destination ZIP code.
- `move_size`: one of `Studio`, `2 Bedrooms`, `3 Bedrooms`, `4 Bedrooms`, `5+ Bedrooms`, or `Office`.
- `move_date`: preferred format is `YYYY-MM-DD`.
- `ref_no`: your unique reference ID for this submission.
- `email`: customer's email address.
- `phone_number`: customer's phone number.

Do not send `sms_consent` or `post_to_granot`.

## cURL Example

```bash
curl -X POST "https://vantage-movers-main-server.vercel.app/api/v1/form-leads" \
  -H "Content-Type: application/json" \
  -H "x-api-secret: <provided webhook key>" \
  -d '{
    "source_company": "Best Relocation Forms",
    "first_name": "Jane",
    "last_name": "Customer",
    "pickup_zip": "10001",
    "destination_zip": "33101",
    "move_size": "2 Bedrooms",
    "move_date": "2026-07-15",
    "ref_no": "BRF-10001",
    "email": "jane.customer@example.com",
    "phone_number": "5555551212"
  }'
```

## JavaScript Example

```javascript
const response = await fetch(
  "https://vantage-movers-main-server.vercel.app/api/v1/form-leads",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-secret": process.env.BEST_RELOCATION_FORMS_WEBHOOK_KEY,
    },
    body: JSON.stringify({
      source_company: "Best Relocation Forms",
      first_name: "Jane",
      last_name: "Customer",
      pickup_zip: "10001",
      destination_zip: "33101",
      move_size: "2 Bedrooms",
      move_date: "2026-07-15",
      ref_no: "BRF-10001",
      email: "jane.customer@example.com",
      phone_number: "5555551212",
    }),
  },
);

const body = await response.json();

if (!response.ok) {
  throw new Error(`Webhook failed: ${response.status} ${JSON.stringify(body)}`);
}

console.log(body);
```

## Success Response

A successful request returns HTTP `201`:

```json
{
  "ok": true,
  "data": {
    "lead": {
      "_id": "created lead id"
    },
    "sheet_sync_status": "pending",
    "crm_sync_status": "skipped"
  }
}
```

The response includes the created lead in `data.lead`.

## Error Handling

- `400`: the JSON body is malformed, missing a required field, has an invalid value, or includes an unsupported extra field.
- `401`: the `x-api-secret` header is missing or incorrect.
- `403`: the key is valid but is not allowed for this endpoint or source company.
- `500`: server-side failure.

Retry only on network failures, timeouts, or `5xx` responses. Do not retry `400`, `401`, or `403` responses without fixing the request first.
