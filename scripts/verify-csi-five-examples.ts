/** Read-only verification of the five reviewed examples; no customer text or media URLs. */
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { head } from "@vercel/blob";
import { connectMongo } from "../src/db";
import { getFormLeadModel } from "../src/models/FormLead";
import { getCallLeadModel } from "../src/models/CallLead";
import { getNumberLeadAttachmentModel } from "../src/models/NumberLeadAttachment";
import { getLeadConversationModel } from "../src/models/LeadConversation";
import { getIntelligenceRunModel } from "../src/models/IntelligenceRun";
import { getContactNumberModel } from "../src/models/ContactNumber";

async function main() {
  await connectMongo();
  let bookedCount = 0;
  for (const [job, model] of [["5563953", "FormLead"], ["5564267", "FormLead"], ["5564618", "FormLead"], ["5564791", "CallLead"], ["5564716", "CallLead"]] as const) {
    const lead = model === "FormLead" ? await getFormLeadModel().findOne({ job_no: job }).lean() : await getCallLeadModel().findOne({ job_no: job }).lean();
    assert.ok(lead);
    if (lead.booked) bookedCount++;
    const edges = await getNumberLeadAttachmentModel().find({ "lead_ref.id": lead._id, "lead_ref.model": model, state: "attached" }).lean();
    const conversation = await getLeadConversationModel().findOne({ contact_number_id: { $in: edges.map(e => e.contact_number_id) }, "media.blob_pathname": { $type: "string" }, "media.purged_at": null, latest_transcript_version: { $ne: null }, "analysis_eligibility.status": "eligible" }).sort({ duration_seconds: -1 }).lean();
    assert.ok(conversation, `${job} requires real media and transcript`);
    const media = await head(conversation.media!.blob_pathname!, { token: process.env.BLOB_READ_WRITE_TOKEN, storeId: process.env.BLOB_STORE_ID });
    assert.ok(media.size > 0);
    const run = await getIntelligenceRunModel().findOne({ conversation_id: conversation._id, status: "completed", mode: { $ne: "number_refresh" } }).sort({ _id: -1 }).lean();
    const number = await getContactNumberModel().findById(conversation.contact_number_id).select({ running_summary: 1 }).lean();
    console.log(JSON.stringify({ job, model, booked: Boolean(lead.booked), seconds: conversation.duration_seconds, audio_bytes: media.size, transcript: Boolean(conversation.latest_transcript_version), analysis: run?.status ?? "not_completed", model_version: run?.model_version, cents: run?.usage?.actual_cents, running_summary: Boolean(number?.running_summary?.text), number_id: String(conversation.contact_number_id) }));
    if (!run) process.exitCode = 1;
  }
  assert.ok(bookedCount > 0 && bookedCount < 5, "Examples must include both booked and unbooked leads");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
