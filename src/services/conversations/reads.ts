import mongoose from "mongoose";
import {
  getLeadConversationModel,
  type LeadConversationDocument,
} from "../../models/LeadConversation";
import {
  extractSummarySection,
  hasCrmMismatch,
} from "./seedFromArtifacts";

export type ConversationListItem = {
  id: string;
  state: string;
  direction: string;
  started_at: string;
  duration_seconds: number;
  match_method: string;
  match_confidence: string;
  normalized_job_no: string | null;
  receiver_agent_name_snapshot: string | null;
  lead_ref: { model: string; id: string } | null;
  booking_ref: string | null;
  has_transcript: boolean;
  has_summary: boolean;
  has_mismatch: boolean;
  cost_cents: { stt: number; summary: number } | null;
};

export type ConversationDetail = ConversationListItem & {
  rc_result: string;
  telephony_session_id: string | null;
  call_log_id: string;
  from_phone_masked: string;
  to_phone_masked: string;
  match_evidence: LeadConversationDocument["match_evidence"];
  media: {
    blob_pathname: string | null;
    bytes: number | null;
    content_type: string | null;
    stored_at: string | null;
    purged_at: string | null;
  } | null;
  transcript: {
    text: string;
    model: string;
    chars: number;
    redactions: number;
    created_at: string;
  } | null;
  summary: {
    text: string;
    model: string;
    prompt_version: string;
    created_at: string;
    sections: {
      overview: string | null;
      customer_wanted: string | null;
      money_dates: string | null;
      outcome: string | null;
      promised: string | null;
      mismatch: string | null;
    };
  } | null;
};

const FORBIDDEN_LIST_KEYS = ["transcript", "summary"] as const;

export function toConversationListItem(
  document: LeadConversationDocument,
): ConversationListItem {
  const summaryText = document.summary?.text ?? "";
  return {
    id: String(document._id),
    state: document.state,
    direction: document.direction,
    started_at: document.started_at.toISOString(),
    duration_seconds: document.duration_seconds,
    match_method: document.match_method,
    match_confidence: document.match_confidence,
    normalized_job_no: document.normalized_job_no ?? null,
    receiver_agent_name_snapshot: document.receiver_agent_name_snapshot ?? null,
    lead_ref: document.lead_ref
      ? { model: document.lead_ref.model, id: String(document.lead_ref.id) }
      : null,
    booking_ref: document.booking_ref ? String(document.booking_ref) : null,
    has_transcript: Boolean(document.transcript?.text),
    has_summary: Boolean(document.summary?.text),
    has_mismatch: hasCrmMismatch(summaryText),
    cost_cents: document.cost_cents
      ? { stt: document.cost_cents.stt, summary: document.cost_cents.summary }
      : null,
  };
}

export function assertListProjectionSafe(item: ConversationListItem): void {
  for (const key of FORBIDDEN_LIST_KEYS) {
    if (Object.hasOwn(item, key)) {
      throw new Error(`Conversation list projection leaked ${key}`);
    }
  }
}

export function toConversationDetail(
  document: LeadConversationDocument,
): ConversationDetail {
  const summaryText = document.summary?.text ?? "";
  return {
    ...toConversationListItem(document),
    rc_result: document.rc_result,
    telephony_session_id: document.telephony_session_id ?? null,
    call_log_id: document.call_log_id,
    from_phone_masked: document.from_phone_masked,
    to_phone_masked: document.to_phone_masked,
    match_evidence: document.match_evidence,
    media: document.media
      ? {
          blob_pathname: document.media.blob_pathname ?? null,
          bytes: document.media.bytes ?? null,
          content_type: document.media.content_type ?? null,
          stored_at: document.media.stored_at
            ? document.media.stored_at.toISOString()
            : null,
          purged_at: document.media.purged_at
            ? document.media.purged_at.toISOString()
            : null,
        }
      : null,
    transcript: document.transcript
      ? {
          text: document.transcript.text,
          model: document.transcript.model,
          chars: document.transcript.chars,
          redactions: document.transcript.redactions,
          created_at: document.transcript.created_at.toISOString(),
        }
      : null,
    summary: document.summary
      ? {
          text: document.summary.text,
          model: document.summary.model,
          prompt_version: document.summary.prompt_version,
          created_at: document.summary.created_at.toISOString(),
          sections: {
            overview: extractSummarySection(summaryText, "Conversation overview"),
            customer_wanted: extractSummarySection(
              summaryText,
              "What the customer wanted",
            ),
            money_dates: extractSummarySection(
              summaryText,
              "Quote / money / dates discussed",
            ),
            outcome: extractSummarySection(summaryText, "Outcome and next steps"),
            promised: extractSummarySection(
              summaryText,
              "Anything the agent promised or still needs",
            ),
            mismatch: hasCrmMismatch(summaryText)
              ? extractSummarySection(summaryText, "Mismatch vs CRM")
              : null,
          },
        }
      : null,
  };
}

export async function listConversations(): Promise<ConversationListItem[]> {
  const Model = getLeadConversationModel();
  const rows = await Model.find({}).sort({ started_at: -1, _id: -1 }).limit(50);
  return rows.map((row) => {
    const item = toConversationListItem(row);
    assertListProjectionSafe(item);
    return item;
  });
}

export async function listConversationsByLead(input: {
  model: "FormLead" | "CallLead";
  id: string;
}): Promise<ConversationListItem[]> {
  if (!mongoose.isValidObjectId(input.id)) {
    return [];
  }
  const Model = getLeadConversationModel();
  const rows = await Model.find({
    "lead_ref.model": input.model,
    "lead_ref.id": new mongoose.Types.ObjectId(input.id),
  }).sort({ started_at: -1 });
  return rows.map((row) => {
    const item = toConversationListItem(row);
    assertListProjectionSafe(item);
    return item;
  });
}

export async function getConversationById(
  id: string,
): Promise<LeadConversationDocument | null> {
  if (!mongoose.isValidObjectId(id)) return null;
  const Model = getLeadConversationModel();
  return Model.findById(id);
}
