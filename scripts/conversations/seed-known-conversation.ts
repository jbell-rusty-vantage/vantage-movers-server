/**
 * Seed one Lead Conversation from already-paid artifacts.
 * Does not call STT or the summarizer.
 *
 *   pnpm ops:seed-conversation
 *   pnpm ops:seed-conversation -- --confirm-write --confirm-production=vantagemovers
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import { connectMongo } from "../../src/db.js";
import { getMongoDatabaseName, isTestMode } from "../../src/config/domain/runtime.js";
import { getCallLeadModel } from "../../src/models/CallLead.js";
import { getLeadConversationModel } from "../../src/models/LeadConversation.js";
import { maskPhoneForLog } from "../../src/utils/logging/sanitizeFormLeadForLog.js";
import { uploadConversationMp3 } from "../../src/services/conversations/media.js";
import {
  CHRIS_HUGHES_SEED,
  buildSeededMedia,
  buildSeededSummary,
  buildSeededTranscript,
  parseConversationArtifact,
} from "../../src/services/conversations/seedFromArtifacts.js";
import {
  assertGranotLifecycleApplyAuthorized,
  assertGranotLifecycleDatabaseAllowed,
} from "../migrations/granot-lifecycle-migration.lib.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--all") || args.some((arg) => arg.startsWith("--limit"))) {
    throw new Error("Refusing batch flags. This script seeds one conversation.");
  }
  const confirmWrite = args.includes("--confirm-write");
  const seed = CHRIS_HUGHES_SEED;

  await connectMongo();
  const databaseName = getMongoDatabaseName();
  assertGranotLifecycleDatabaseAllowed(databaseName);
  console.log(`Database ${databaseName}  TEST_MODE=${isTestMode()}`);
  console.log(`Lead ${seed.lead_model} ${seed.lead_id}  call_log ${seed.call_log_id}`);

  const CallLead = getCallLeadModel();
  const lead = await CallLead.findById(seed.lead_id);
  if (!lead) {
    throw new Error(`Call Lead ${seed.lead_id} was not found in ${databaseName}.`);
  }

  const markdownPath = path.resolve(seed.sample_markdown);
  const audioPath = path.resolve(seed.sample_audio);
  const markdown = await readFile(markdownPath, "utf8");
  const parsed = parseConversationArtifact(markdown);
  const startedAt =
    lead.ringcentral?.start_time ?? lead.start_time ?? lead.timestamp ?? new Date();

  const plan = {
    database: databaseName,
    lead_id: String(lead._id),
    booked_lead_id: lead.booked ? String(lead.booked) : seed.booked_lead_id,
    recording_id: seed.provider_recording_id,
    audio: seed.sample_audio,
    artifact: seed.sample_markdown,
    stt_model: "gpt-4o-mini-transcribe (replay, no new call)",
    summary_model: "gpt-4.1-nano (replay, no new call)",
  };
  console.log(JSON.stringify(plan, null, 2));

  if (!confirmWrite) {
    console.log("Dry run. Pass --confirm-write to upload the mp3 and write Mongo.");
    return;
  }

  assertGranotLifecycleApplyAuthorized({ args, databaseName });

  const uploaded = await uploadConversationMp3({
    providerRecordingId: seed.provider_recording_id,
    filePath: audioPath,
  });
  const now = new Date();
  const transcript = buildSeededTranscript(parsed.transcript, now);
  if (transcript.text.includes("@") && !transcript.text.includes("[REDACTED:EMAIL]")) {
    throw new Error("Refusing to persist an unredacted email.");
  }
  if (/\b(?:\d[\s-]*){13,19}\b/.test(transcript.text)) {
    throw new Error("Refusing to persist a long digit run that looks like a card.");
  }

  const Conversation = getLeadConversationModel();
  const document = await Conversation.findOneAndUpdate(
    {
      provider: "ringcentral",
      provider_recording_id: seed.provider_recording_id,
    },
    {
      $set: {
        provider: "ringcentral",
        provider_recording_id: seed.provider_recording_id,
        call_log_id: seed.call_log_id,
        telephony_session_id: seed.telephony_session_id,
        lead_ref: { model: seed.lead_model, id: lead._id },
        booking_ref: lead.booked ?? new mongoose.Types.ObjectId(seed.booked_lead_id),
        normalized_job_no: seed.normalized_job_no,
        lead_source_company: lead.lead_source_company ?? null,
        source_granularity_id: lead.source_granularity_id ?? null,
        receiver_agent: lead.receiver_agent ?? null,
        receiver_agent_name_snapshot: lead.receiver_agent_name_snapshot ?? null,
        match_method: seed.match_method,
        match_confidence: seed.match_confidence,
        match_evidence: {
          queried_phone_national: null,
          window_from: null,
          window_to: null,
          candidate_count: 1,
          chosen_reason: "owner_seeded",
        },
        direction: seed.direction,
        rc_result: seed.rc_result,
        started_at: startedAt,
        duration_seconds: seed.duration_seconds,
        from_phone_masked: maskPhoneForLog(lead.phone_number ?? "0000"),
        to_phone_masked: maskPhoneForLog(
          lead.ringcentral?.target_phone_number ?? "0000",
        ),
        media: buildSeededMedia({
          providerRecordingId: seed.provider_recording_id,
          blobUrl: uploaded.url,
          bytes: uploaded.bytes,
          storedAt: now,
        }),
        transcript,
        summary: buildSeededSummary(parsed.summary_markdown, now),
        state: "complete",
        attempts: 0,
        next_attempt_at: null,
        claimed_by: null,
        claim_expires_at: null,
        last_error: null,
        cost_cents: { stt: 3, summary: 0 },
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  console.log(
    JSON.stringify(
      {
        document_id: String(document?._id),
        blob_pathname: uploaded.pathname,
        blob_bytes: uploaded.bytes,
        redactions: transcript.redactions,
        cost_cents: { stt: 3, summary: 0 },
        replay: true,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
