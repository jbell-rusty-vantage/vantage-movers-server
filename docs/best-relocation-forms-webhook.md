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

### Required fields

| Field | Rules |
| --- | --- |
| `source_company` | Send exactly `Best Relocation Forms`. Other values are rejected for this webhook key. |
| `first_name` | Customer first name. Trimmed; must not be empty when combined with `last_name`. |
| `last_name` | Customer last name. Trimmed; must not be empty when combined with `first_name`. |
| `pickup_zip` | See [ZIP codes](#zip-codes). |
| `destination_zip` | See [ZIP codes](#zip-codes). |
| `move_size` | See [Move size](#move-size). |
| `move_date` | See [Move date](#move-date). |
| `ref_no` | Your unique reference ID for this submission. Trimmed; must not be empty. |
| `email` | See [Email](#email). |
| `phone_number` | See [Phone number](#phone-number). |

At least one of `first_name` or `last_name` must be present. Best Relocation should send both.

Do not send `sms_consent` or `post_to_granot`.

### Move size

`move_size` must match one of these values **exactly** (case-sensitive):

| Value | Notes |
| --- | --- |
| `Studio` | |
| `1 Bedroom` | Singular `Bedroom`. |
| `2 Bedrooms` | Use the plural `Bedrooms`, not `2 Bedroom`. |
| `3 Bedrooms` | |
| `4 Bedrooms` | |
| `5+ Bedrooms` | Include the `+` character. |
| `Office` | |

Any other string (for example `2BR` or `2 Bedroom`) returns HTTP `400`.

### Move date

- Preferred format: `YYYY-MM-DD` (for example `2026-07-15`).
- ISO 8601 date strings are also accepted (for example `2026-07-15T00:00:00.000Z`).
- If omitted, Vantage stores the submission time as the move date.
- There is no minimum or maximum date check; past and future dates are accepted.
- Send the customer's requested move date, not the form submission timestamp.

### ZIP codes

Both `pickup_zip` and `destination_zip` must:

- Be strings, not numbers (preserve leading zeros).
- Contain **exactly 5 digits** after trimming whitespace.
- Use digits only — no dashes, spaces, or ZIP+4 extensions.

| Valid | Invalid |
| --- | --- |
| `"10001"` | `"100011"` (6 digits) |
| `"02108"` | `"2108"` (missing leading zero) |
| `"33101"` | `"33101-1234"` (ZIP+4) |
| `"90210"` | `90210` (JSON number — can drop leading zeros) |

### Email

- Required for Best Relocation submissions.
- Send as a plain string; leading and trailing spaces are trimmed.
- Vantage stores the value in lowercase but does **not** reject malformed addresses at the API layer.
- Still send a real, deliverable email whenever possible so agents can contact the customer.

Examples:

| Input | Stored as |
| --- | --- |
| `" jane.customer@example.com "` | `jane.customer@example.com` |
| `"JANE@EXAMPLE.COM"` | `jane@example.com` |

### Phone number

- Required; must not be empty after trimming.
- US numbers are preferred. Common formatted inputs are accepted and normalized on save.
- Recommended: send 10 US digits with no formatting (for example `"5555551212"`).

Normalization behavior:

| You send | Stored as |
| --- | --- |
| `"5555551212"` | `"5555551212"` |
| `"(555) 555-1212"` | `"5555551212"` |
| `"+1 555 555 1212"` | `"5555551212"` |
| `"15555551212"` | `"5555551212"` |
| `"+44 20 7946 0958"` | `"+442079460958"` (international `+` prefix kept) |

Avoid sending placeholder values like `"0000000000"` when a real number is available.

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

See `scripts/dev_ops/examples/best-relocation-forms-webhook.js` for a runnable Node.js script.

```javascript
/** Allowed move_size values — must match exactly. */
const MOVE_SIZES = [
  "Studio",
  "1 Bedroom",
  "2 Bedrooms",
  "3 Bedrooms",
  "4 Bedrooms",
  "5+ Bedrooms",
  "Office",
];

const payload = {
  source_company: "Best Relocation Forms",
  first_name: "Jane",
  last_name: "Customer",
  pickup_zip: "10001", // exactly 5 digits, string
  destination_zip: "33101", // exactly 5 digits, string
  move_size: "2 Bedrooms", // must be one of MOVE_SIZES
  move_date: "2026-07-15", // YYYY-MM-DD preferred
  ref_no: "BRF-10001",
  email: "jane.customer@example.com",
  phone_number: "5555551212", // 10-digit US recommended
};

const response = await fetch(
  "https://vantage-movers-main-server.vercel.app/api/v1/form-leads",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-secret": process.env.BEST_RELOCATION_FORMS_WEBHOOK_KEY,
    },
    body: JSON.stringify(payload),
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

- `400`: the JSON body is malformed, missing a required field, has an invalid value, or includes an unsupported extra field. Common causes: wrong `move_size` spelling, ZIP not exactly 5 digits, or extra JSON properties.
- `401`: the `x-api-secret` header is missing or incorrect.
- `403`: the key is valid but is not allowed for this endpoint or source company.
- `500`: server-side failure.

Retry only on network failures, timeouts, or `5xx` responses. Do not retry `400`, `401`, or `403` responses without fixing the request first.
