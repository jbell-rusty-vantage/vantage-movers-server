# Best Relocation Inbounds Call Leads Webhook

This webhook creates a Vantage Movers call lead from a Best Relocation Inbounds submission.

## Endpoint

Send an HTTPS `POST` request to:

```text
https://vantage-movers-main-server.vercel.app/api/v1/call-leads
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
  "source_company": "Best Relocation Inbounds",
  "phone_number": "5555551212",
  "pickup_zip": "10001",
  "delivery_zip": "33101",
  "first_name": "Jane",
  "last_name": "Customer",
  "email": "jane.customer@example.com"
}
```

### Required fields

| Field | Rules |
| --- | --- |
| `source_company` | Send exactly `Best Relocation Inbounds`. Other values are rejected for this webhook key. |
| `phone_number` | Required unless a Vantage job number is sent as `job_no`. Best Relocation should send `phone_number`. |

### Optional fields

| Field | Rules |
| --- | --- |
| `pickup_zip` | See [ZIP codes](#zip-codes). Strongly recommended. |
| `delivery_zip` | See [ZIP codes](#zip-codes). Strongly recommended. |
| `first_name` | Customer first name. Trimmed before storage. |
| `last_name` | Customer last name. Trimmed before storage. |
| `email` | See [Email](#email). |

Do not send `destination_zip`; the call-lead route expects `delivery_zip`.

Do not send `post_to_granot`, `crm_company_label`, `form_fill`, `duplicate`, `ringcentral`, `booked`, `cancelled`, or any other server-owned fields. The call-lead route does not post to Granot.

### ZIP codes

If sent, `pickup_zip` and `delivery_zip` must:

- Be strings, not numbers (preserve leading zeros).
- Contain **exactly 5 digits** after trimming whitespace.
- Use digits only - no dashes, spaces, or ZIP+4 extensions.

| Valid | Invalid |
| --- | --- |
| `"10001"` | `"100011"` (6 digits) |
| `"02108"` | `"2108"` (missing leading zero) |
| `"33101"` | `"33101-1234"` (ZIP+4) |
| `"90210"` | `90210` (JSON number - can drop leading zeros) |

### Phone number

- Required for Best Relocation Inbounds.
- Send as a string; leading and trailing spaces are trimmed.
- US numbers are preferred. Common formatted inputs are accepted and normalized on save for matching.
- Recommended: send 10 US digits with no formatting (for example `"5555551212"`).

Normalization behavior:

| You send | Stored matching value |
| --- | --- |
| `"5555551212"` | `"5555551212"` |
| `"(555) 555-1212"` | `"5555551212"` |
| `"+1 555 555 1212"` | `"5555551212"` |
| `"15555551212"` | `"5555551212"` |
| `"+44 20 7946 0958"` | `"+442079460958"` (international `+` prefix kept) |

Avoid sending placeholder values like `"0000000000"` when a real number is available.

### Email

- Optional.
- If sent, it must be a valid email address.
- Send as a plain string; leading and trailing spaces are trimmed.
- Vantage stores the value in lowercase.

Examples:

| Input | Stored as |
| --- | --- |
| `" jane.customer@example.com "` | `jane.customer@example.com` |
| `"JANE@EXAMPLE.COM"` | `jane@example.com` |

## cURL Example

```bash
curl -X POST "https://vantage-movers-main-server.vercel.app/api/v1/call-leads" \
  -H "Content-Type: application/json" \
  -H "x-api-secret: <provided webhook key>" \
  -d '{
    "source_company": "Best Relocation Inbounds",
    "phone_number": "5555551212",
    "pickup_zip": "10001",
    "delivery_zip": "33101",
    "first_name": "Jane",
    "last_name": "Customer",
    "email": "jane.customer@example.com"
  }'
```

## JavaScript Example

```javascript
const payload = {
  source_company: "Best Relocation Inbounds",
  phone_number: "5555551212",
  pickup_zip: "10001", // exactly 5 digits, string
  delivery_zip: "33101", // exactly 5 digits, string
  first_name: "Jane",
  last_name: "Customer",
  email: "jane.customer@example.com",
};

const response = await fetch(
  "https://vantage-movers-main-server.vercel.app/api/v1/call-leads",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-secret": process.env.BEST_RELOCATION_INBOUNDS_WEBHOOK_KEY,
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
    "_id": "created lead id",
    "source_company": "best_relocation_leads",
    "phone_number": "5555551212",
    "pickup_zip": "10001",
    "delivery_zip": "33101",
    "first_name": "Jane",
    "last_name": "Customer",
    "email": "jane.customer@example.com"
  }
}
```

The response includes the created call lead directly in `data`.

## Error Handling

- `400`: the JSON body is malformed, missing `phone_number`, has an invalid value, or includes an unsupported extra field. Common causes: using `destination_zip` instead of `delivery_zip`, ZIP not exactly 5 digits, malformed email, or extra JSON properties.
- `401`: the `x-api-secret` header is missing or incorrect.
- `403`: the key is valid but is not allowed for this endpoint or source company.
- `500`: server-side failure.

Retry only on network failures, timeouts, or `5xx` responses. Do not retry `400`, `401`, or `403` responses without fixing the request first.
