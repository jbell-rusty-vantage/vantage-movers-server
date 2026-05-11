IMPORTANT:

THe main sheet id is MAIN_GOOGLE_SHEET_ID

The sheet inside that is important is called Leads

The columns are

Time Stamp
Name
Pickup Zip
Destination Zip
Move Size
Move Date
Phone
Lead ID
Ref No
Booked (Can be empty for now)  
Source Company Label
Source Company Site

You must write into these values with the mongo collection fields correctly. Obviously the Mongo collection fields can be named differently but keep a map.

Remember that you must also create a Source Company Site specific Sheet titled something like <Source Company Site or Label> Leads and this must be created and derived from the mongo collection.

Yes. Use a simple shared secret first. Do not overbuild auth yet.

Architecture: Lead Intake Server
Goal

Receive unvalidated lead data from a webhook/frontend, validate it server-side, persist it to MongoDB, then sync it to:

Main Google Sheet: Leads
Company-specific Google Sheet tab based on sourceCompanySite

MongoDB remains the source of truth. Google Sheets is the reporting layer.

1. Initial Authentication

Use a private API key in the request header.

Environment variable
LEAD_WEBHOOK_SECRET=some-long-random-secret
Incoming request header
x-webhook-secret: some-long-random-secret
Express middleware
import { Request, Response, NextFunction } from "express";

export function requireWebhookSecret(
req: Request,
res: Response,
next: NextFunction
) {
const providedSecret = req.header("x-webhook-secret");

if (!providedSecret || providedSecret !== process.env.LEAD_WEBHOOK_SECRET) {
return res.status(401).json({
ok: false,
error: "Unauthorized",
});
}

next();
}

This is good enough for now. Later you can upgrade to HMAC signatures.

2. Collections

Start with:

leads
calls

For now, implement only leads.

Recommended extra collection:

sheet_tabs

This tracks company-specific tab creation so you do not repeatedly scan Google Sheets.

3. Lead Fields

Canonical normalized lead shape:

{
leadId: string;
timestamp: Date;
name: string;
pickupZip: string;
destinationZip: string;
moveSize: "Studio" | "2 Bedrooms" | "3 Bedrooms" | "4 Bedrooms" | "5+ Bedrooms" | "Office";
moveDate: Date;
phoneNumber: string;
refNo?: string;
booked: boolean;
email: string;
sourceCompanySite: string;
sourceCompanyLabel: string;
cancelled: boolean;
}

For timestamp: yes, use server receive time. It is more reliable than trusting the client.

4. Suggested Folder Structure
   src/
   app.ts
   server.ts

config/
env.ts
mongo.ts
googleSheets.ts

middleware/
requireWebhookSecret.ts

models/
Lead.ts
SheetTab.ts

routes/
lead.routes.ts

services/
lead.service.ts
googleSheets.service.ts

validation/
lead.validation.ts

utils/
ids.ts
sheetNames.ts 5. Validation Schema

Use zod.

npm install zod
import { z } from "zod";

const moveSizeEnum = z.enum([
"Studio",
"2 Bedrooms",
"3 Bedrooms",
"4 Bedrooms",
"5+ Bedrooms",
"Office",
]);

const zipSchema = z
.string()
.regex(/^\d{5}$/, "Zip code must be exactly 5 digits");

const phoneSchema = z
.string()
.regex(/^\d{10}$/, "Phone number must be exactly 10 digits");

export const createLeadSchema = z.object({
name: z.string().min(1).max(120),

pickupZip: zipSchema,
destinationZip: zipSchema,

moveSize: moveSizeEnum,

moveDate: z.coerce.date(),

phoneNumber: phoneSchema,

refNo: z.string().optional(),

booked: z.coerce.boolean().default(false),

email: z.string().email(),

sourceCompanySite: z.string().min(1),

sourceCompanyLabel: z.string().min(1),

cancelled: z.coerce.boolean().default(false),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

Later, replace sourceCompanySite and sourceCompanyLabel with enums once you have the final list.

6. Lead ID Generation

Your example:

LID66d7c15977e9a

Use a short Mongo ObjectId-style suffix.

import { Types } from "mongoose";

export function generateLeadId() {
return `LID${new Types.ObjectId().toString().slice(0, 13)}`;
} 7. Mongoose Lead Model
import mongoose, { Schema } from "mongoose";

const LeadSchema = new Schema(
{
leadId: {
type: String,
required: true,
unique: true,
index: true,
},

    timestamp: {
      type: Date,
      required: true,
      default: Date.now,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    pickupZip: {
      type: String,
      required: true,
    },

    destinationZip: {
      type: String,
      required: true,
    },

    moveSize: {
      type: String,
      required: true,
      enum: [
        "Studio",
        "2 Bedrooms",
        "3 Bedrooms",
        "4 Bedrooms",
        "5+ Bedrooms",
        "Office",
      ],
    },

    moveDate: {
      type: Date,
      required: true,
    },

    phoneNumber: {
      type: String,
      required: true,
    },

    refNo: {
      type: String,
    },

    booked: {
      type: Boolean,
      required: true,
      default: false,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    sourceCompanySite: {
      type: String,
      required: true,
      index: true,
    },

    sourceCompanyLabel: {
      type: String,
      required: true,
    },

    cancelled: {
      type: Boolean,
      required: true,
      default: false,
    },

},
{
timestamps: true,
}
);

export const Lead = mongoose.model("Lead", LeadSchema); 8. Sheet Tab Model
import mongoose, { Schema } from "mongoose";

const SheetTabSchema = new Schema(
{
spreadsheetId: {
type: String,
required: true,
index: true,
},

    companySite: {
      type: String,
      required: true,
      index: true,
    },

    tabName: {
      type: String,
      required: true,
    },

    tabType: {
      type: String,
      required: true,
      enum: ["LEADS", "CALLS"],
    },

    googleSheetId: {
      type: Number,
    },

},
{
timestamps: true,
}
);

SheetTabSchema.index(
{ spreadsheetId: 1, companySite: 1, tabType: 1 },
{ unique: true }
);

export const SheetTab = mongoose.model("SheetTab", SheetTabSchema); 9. Route
import { Router } from "express";
import { requireWebhookSecret } from "../middleware/requireWebhookSecret";
import { createLeadSchema } from "../validation/lead.validation";
import { createLead } from "../services/lead.service";

const router = Router();

router.post("/webhooks/leads", requireWebhookSecret, async (req, res) => {
try {
const parsed = createLeadSchema.parse(req.body);

    const lead = await createLead(parsed);

    return res.status(201).json({
      ok: true,
      leadId: lead.leadId,
    });

} catch (error: any) {
return res.status(400).json({
ok: false,
error: error.message,
});
}
});

export default router; 10. Lead Service
import { Lead } from "../models/Lead";
import { CreateLeadInput } from "../validation/lead.validation";
import { generateLeadId } from "../utils/ids";
import { syncLeadToSheets } from "./googleSheets.service";

export async function createLead(input: CreateLeadInput) {
const lead = await Lead.create({
...input,
leadId: generateLeadId(),
timestamp: new Date(),
});

await syncLeadToSheets(lead);

return lead;
}

Eventually, you may want to make Sheets sync async/retryable, but this is fine for v1.

11. Google Sheet Columns

Use one canonical order everywhere.

export const LEAD_HEADERS = [
"Timestamp",
"LeadID",
"Name",
"Pickup Zip",
"Destination Zip",
"Move Size",
"Move Date",
"Phone Number",
"Ref No",
"Booked",
"Email",
"Source Company Site",
"Source Company Label",
"Cancelled",
];

Convert lead to row:

export function leadToSheetRow(lead: any) {
return [
lead.timestamp.toISOString(),
lead.leadId,
lead.name,
lead.pickupZip,
lead.destinationZip,
lead.moveSize,
lead.moveDate.toISOString().slice(0, 10),
lead.phoneNumber,
lead.refNo ?? "",
lead.booked,
lead.email,
lead.sourceCompanySite,
lead.sourceCompanyLabel,
lead.cancelled,
];
} 12. Sheet Naming

Use sourceCompanySite.

export function sanitizeSheetName(value: string) {
return value
.replace(/[\\/?\*[\]:]/g, "")
.trim()
.slice(0, 80);
}

export function getCompanyLeadSheetName(sourceCompanySite: string) {
return `${sanitizeSheetName(sourceCompanySite)} - Leads`;
} 13. Sheets Sync Logic

On every lead:

1. Append to main Leads tab.
2. Get or create company-specific Leads tab.
3. Append to company-specific Leads tab.

Pseudo-service:

import { google } from "googleapis";
import { SheetTab } from "../models/SheetTab";
import { LEAD_HEADERS } from "../constants/sheetHeaders";
import { leadToSheetRow } from "../utils/leadToSheetRow";
import { getCompanyLeadSheetName } from "../utils/sheetNames";

const spreadsheetId = process.env.MAIN_GOOGLE_SHEET_ID!;

export async function syncLeadToSheets(lead: any) {
const sheets = getSheetsClient();

const row = leadToSheetRow(lead);

await appendRow(sheets, "Leads", row);

const companyTabName = await getOrCreateCompanyLeadTab(
sheets,
lead.sourceCompanySite
);

await appendRow(sheets, companyTabName, row);
}

async function appendRow(sheets: any, tabName: string, row: any[]) {
await sheets.spreadsheets.values.append({
spreadsheetId,
range: `${tabName}!A:Z`,
valueInputOption: "USER_ENTERED",
requestBody: {
values: [row],
},
});
} 14. Create Company Tab If Missing
async function getOrCreateCompanyLeadTab(
sheets: any,
sourceCompanySite: string
) {
const tabName = getCompanyLeadSheetName(sourceCompanySite);

const existing = await SheetTab.findOne({
spreadsheetId,
companySite: sourceCompanySite,
tabType: "LEADS",
});

if (existing) {
return existing.tabName;
}

const response = await sheets.spreadsheets.batchUpdate({
spreadsheetId,
requestBody: {
requests: [
{
addSheet: {
properties: {
title: tabName,
},
},
},
],
},
});

const googleSheetId =
response.data.replies?.[0]?.addSheet?.properties?.sheetId;

await sheets.spreadsheets.values.update({
spreadsheetId,
range: `${tabName}!A1:Z1`,
valueInputOption: "USER_ENTERED",
requestBody: {
values: [LEAD_HEADERS],
},
});

await SheetTab.create({
spreadsheetId,
companySite: sourceCompanySite,
tabName,
tabType: "LEADS",
googleSheetId,
});

return tabName;
} 15. Main Sheet Initialization

Manually create these tabs first:

Leads
Calls

Put headers into Leads.

Or let your backend bootstrap them later. For v1, manual is simpler.

16. Request Payload Example
    {
    "name": "John Smith",
    "pickupZip": "10001",
    "destinationZip": "33101",
    "moveSize": "2 Bedrooms",
    "moveDate": "9/20/2024",
    "phoneNumber": "5551234567",
    "refNo": "ABC123",
    "booked": false,
    "email": "john@example.com",
    "sourceCompanySite": "Acme Moving Ads",
    "sourceCompanyLabel": "Google Ads - Acme",
    "cancelled": false
    }

Do not accept leadId from the client.
Do not trust client timestamp for now.

17. Important V1 Decisions

Use this:

MongoDB first.
Sheets second.

If Mongo write fails: return error.
If Sheets write fails: you have a choice.

For v1, I would return an error so you notice sync problems immediately.

For v2, better architecture:

Create Lead in Mongo
Mark sheetSyncStatus = "pending"
Background job syncs to Sheets
Mark sheetSyncStatus = "synced"

But for now, synchronous sync is acceptable.

18. Final Flow
    POST /webhooks/leads
    ↓
    Check x-webhook-secret
    ↓
    Validate body with Zod
    ↓
    Generate LeadID
    ↓
    Create server timestamp
    ↓
    Insert into MongoDB leads collection
    ↓
    Append row to main Leads sheet
    ↓
    Find/create `${sourceCompanySite} - Leads`
    ↓
    Append row to company Leads sheet
    ↓
    Return { ok: true, leadId }

## This is the correct v1 shape. Keep the owner-facing spreadsheet organized, but let MongoDB remain the real database.

SYNC JOBS STEP 2

Yes. For v1, add sync state fields to Mongo. That gives you reliability without needing complex MongoDB transactions yet.

Use this pattern:

MongoDB = source of truth
Google Sheets = derived view
Sync job = repair/retry mechanism

Add fields to Lead:

sheetSyncStatus: "pending" | "synced" | "failed";
sheetSyncedAt?: Date;
sheetSyncError?: string;

mainSheetRowNumber?: number;
companySheetName?: string;
companySheetRowNumber?: number;

updatedSinceLastSheetSync: boolean;

Recommended write flow:

1. Validate lead
2. Insert lead into Mongo with sheetSyncStatus = "pending"
3. Try to sync to Sheets immediately
4. If success:
   sheetSyncStatus = "synced"
   sheetSyncedAt = now
5. If failure:
   sheetSyncStatus = "failed"
   sheetSyncError = error message

Then have a repair endpoint or cron job:

Every 5-15 minutes:
find leads where:
sheetSyncStatus in ["pending", "failed"]
OR updatedSinceLastSheetSync = true
sync them to Sheets

On Vercel, use Vercel Cron Jobs for this.

Example endpoint:

POST /api/cron/sync-leads-to-sheets

Protected with another secret:

Authorization: Bearer CRON_SECRET

For updates, you need row tracking. When you first append to Sheets, store:

mainSheetRowNumber
companySheetRowNumber
companySheetName

Then later updates can target exact ranges:

Leads!A42:N42
Acme - Leads!A17:N17

So the correct evolution is:

V1:
insert Mongo
append to Sheets
mark synced / failed

V1.5:
cron retries failed/pending syncs

V2:
store row numbers
support updates to existing rows

V3:
use an outbox collection for sheet sync events

The most robust version is an outbox pattern:

Lead created/updated in Mongo
↓
Create SheetSyncEvent in Mongo:
{
entityType: "lead",
entityId: lead.\_id,
eventType: "created" | "updated",
status: "pending"
}
↓
Worker/cron processes pending events
↓
Writes to Sheets
↓
Marks event as processed

You probably do not need MongoDB multi-document transactions right away unless you use the outbox pattern and want stronger guarantees.

For your current build, I’d do:

Lead model includes sheetSyncStatus
Immediate sync after insert
Cron repair job for failed/pending records
Store sheet row numbers once appended

That is simple and resilient.
