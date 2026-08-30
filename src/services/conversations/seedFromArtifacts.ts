import {
  CONVERSATION_PROMPT_VERSION,
  CONVERSATION_STT_MODEL,
  CONVERSATION_SUMMARY_MODEL,
  conversationBlobPathname,
  type LeadConversationDirection,
  type LeadConversationLeadModel,
  type LeadConversationMatchConfidence,
  type LeadConversationMatchMethod,
} from "../../config/domain/conversations";
import { redactTranscript } from "./redaction";

export const CHRIS_HUGHES_SEED = {
  lead_model: "CallLead" as LeadConversationLeadModel,
  lead_id: "6a761d3d7ceae445794c57bd",
  booked_lead_id: "6a7d4e3529d500054c6b5be5",
  normalized_job_no: "P5562014",
  call_log_id: "AL0AaWD26IINT41A",
  telephony_session_id: "s-a785c6807b6bbz19fdcf48b62z11970cf60000",
  provider_recording_id: "3750152612023",
  direction: "Inbound" as LeadConversationDirection,
  rc_result: "Accepted",
  duration_seconds: 482,
  match_method: "call_lead_telephony_session" as LeadConversationMatchMethod,
  match_confidence: "high" as LeadConversationMatchConfidence,
  sample_markdown: "ringcentral-recording-samples/booked-lead-matches/04-call-p5562014-chris-hughes-inbound-482s-3750152612023.md",
  sample_audio: "ringcentral-recording-samples/booked-lead-matches/04-call-p5562014-chris-hughes-inbound-482s-3750152612023.mp3",
} as const;

export type ParsedConversationArtifact = {
  summary_markdown: string;
  transcript: string;
};

const SUMMARY_HEADINGS = [
  "Conversation overview",
  "What the customer wanted",
  "Quote / money / dates discussed",
  "Outcome and next steps",
  "Anything the agent promised or still needs",
  "Mismatch vs CRM",
] as const;

export function parseConversationArtifact(markdown: string): ParsedConversationArtifact {
  const summaryStart = markdown.search(/^## Summary\s*$/m);
  const transcriptStart = markdown.search(/^## Transcript\s*$/m);
  if (summaryStart < 0 || transcriptStart < 0 || transcriptStart <= summaryStart) {
    throw new Error("Artifact is missing ## Summary or ## Transcript.");
  }
  const summaryBody = markdown.slice(summaryStart + "## Summary".length, transcriptStart).trim();
  const transcript = markdown.slice(transcriptStart + "## Transcript".length).trim();
  if (!summaryBody || !transcript) {
    throw new Error("Artifact summary or transcript is empty.");
  }
  return {
    summary_markdown: normalizeSummaryMarkdown(summaryBody),
    transcript,
  };
}

export function normalizeSummaryMarkdown(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").replace(/\*\*/g, "").trim();
  text = text.replace(/^\d+\.\s+/gm, "");
  return text;
}

export function hasCrmMismatch(summaryMarkdown: string): boolean {
  const mismatch = extractSummarySection(summaryMarkdown, "Mismatch vs CRM");
  if (!mismatch) return false;
  return !/no contradiction|no mismatch|does not conflict|align with the crm/i.test(
    mismatch,
  );
}

export function extractSummarySection(
  summaryMarkdown: string,
  heading: (typeof SUMMARY_HEADINGS)[number],
): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|\\n)${escaped}\\s*:?\\s*\\n([\\s\\S]*?)(?=\\n(?:${SUMMARY_HEADINGS.map((item) =>
      item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).join("|")})\\s*:?\\s*$|$)`,
    "i",
  );
  const match = summaryMarkdown.match(pattern);
  const value = match?.[1]?.trim() ?? "";
  return value.length > 0 ? value : null;
}

export function buildSeededTranscript(rawTranscript: string, createdAt: Date) {
  const redacted = redactTranscript(rawTranscript);
  return {
    text: redacted.text,
    model: CONVERSATION_STT_MODEL,
    chars: redacted.text.length,
    redactions: redacted.redactions,
    created_at: createdAt,
  };
}

export function buildSeededSummary(summaryMarkdown: string, createdAt: Date) {
  return {
    text: summaryMarkdown,
    model: CONVERSATION_SUMMARY_MODEL,
    prompt_version: CONVERSATION_PROMPT_VERSION,
    created_at: createdAt,
  };
}

export function buildSeededMedia(input: {
  providerRecordingId: string;
  blobUrl: string | null;
  bytes: number;
  storedAt: Date;
}) {
  return {
    blob_pathname: conversationBlobPathname(input.providerRecordingId),
    blob_url: input.blobUrl,
    bytes: input.bytes,
    content_type: "audio/mpeg" as const,
    stored_at: input.storedAt,
    purged_at: null,
  };
}
