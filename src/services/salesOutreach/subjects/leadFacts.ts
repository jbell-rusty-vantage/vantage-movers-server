import type { SalesOutreachLeadModel } from "../../../config/domain/salesOutreach";

/** A canonical Lead reference (IMPL-04: the desk subject key). */
export type DeskLeadRef = Readonly<{ model: SalesOutreachLeadModel; id: string }>;

export const deskLeadKey = (ref: DeskLeadRef) => `${ref.model}:${ref.id}`;

/**
 * The current facts of one Form/Call Lead that the desk reads (IMPLEMENTATION-PLAN §2). The Lead stays
 * the system of record; these are read, never written. Everything the subject builder, the P05h
 * eligibility seam and the P05d/P05e priority mapping need is here, so those stay pure.
 */
export type DeskLeadFacts = Readonly<{
  ref: DeskLeadRef;
  ingestion_origin: string | null;
  /** Stored `timestamp` (mixed conventions; read only through `leadInstant`). */
  timestamp: Date | null;
  created_at: Date | null;
  domain_revision: number;
  last_changed_at: Date | null;
  /** Accepted Granot priority (`granotLifecycle/leadDesiredState.ts` writes only valid canonical codes). */
  granot_priority: string | null;
  accepted_observation: Readonly<{ observation_id: string; captured_at: Date }> | null;
  booked_id: string | null;
  cancelled_id: string | null;
  duplicate: boolean;
  /** Form Lead Bad Lead reason (Call Leads have none). */
  bad_lead: string | null;
  /** Reporting scope only; never a desk closure (P05h). */
  no_sync: boolean;
  /** Call Lead created only to anchor a Booking (P05h: no automatic cadence). */
  created_on_unmatched: boolean;
  /** Call Lead Form Fill flag: neither excludes nor merges (P05h). */
  form_fill: boolean;
  receiver_agent_id: string | null;
  job_no: string | null;
  normalized_job_no: string | null;
  phone: string | null;
  normalized_phone: string | null;
  /** Call Leads only: the caller of the call that created the Lead (`ringcentral.original_caller`); olr C2c phone fallback. */
  original_caller_phone?: string | null;
  /** The phone the Lead arrived with (`ingested_contact_snapshot`); olr CW1, the mint's phone rule. */
  ingested_phone?: string | null;
  /** The phone Granot last reported (`granot_contact_snapshot`); olr CW1, the mint's phone rule. */
  granot_phone?: string | null;
  name: string | null;
  /** Canonical move date `YYYY-MM-DD` (Form Lead `move_date`, stored as UTC midnight); null when unknown. */
  move_date: string | null;
}>;

/** The Lead fields the desk reads (one projection for both models; absent paths are simply missing). */
export const DESK_LEAD_PROJECTION = {
  _id: 1,
  ingestion_origin: 1,
  timestamp: 1,
  createdAt: 1,
  domain_revision: 1,
  last_changed_at: 1,
  granot_priority: 1,
  last_accepted_granot_observation: 1,
  booked: 1,
  cancelled: 1,
  duplicate: 1,
  bad_lead: 1,
  no_sync: 1,
  created_on_unmatched: 1,
  form_fill: 1,
  receiver_agent: 1,
  job_no: 1,
  normalized_job_no: 1,
  phone_number: 1,
  normalized_phone_number: 1,
  "ringcentral.original_caller.normalized_phone_number": 1,
  "ingested_contact_snapshot.normalized_phone_number": 1,
  "granot_contact_snapshot.normalized_phone_number": 1,
  name: 1,
  first_name: 1,
  last_name: 1,
  move_date: 1,
} as const;

type RawLead = Record<string, unknown> & { _id: unknown };

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const id = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const validDate = (value: unknown): Date | null => (value instanceof Date && Number.isFinite(+value) ? value : null);

/** UTC calendar date of a stored move date (Form Leads store it at UTC midnight). */
export function moveDateOf(value: unknown): string | null {
  const date = validDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
}

/** Converts one lean Lead document (projected with `DESK_LEAD_PROJECTION`) into desk facts. */
export function toDeskLeadFacts(model: SalesOutreachLeadModel, raw: RawLead): DeskLeadFacts {
  const observation = raw.last_accepted_granot_observation as { observation_id?: unknown; captured_at?: unknown } | null | undefined;
  const observedAt = validDate(observation?.captured_at);
  const name = str(raw.name) ?? ([str(raw.first_name), str(raw.last_name)].filter(Boolean).join(" ") || null);
  return {
    ref: { model, id: String(raw._id) },
    ingestion_origin: str(raw.ingestion_origin),
    timestamp: validDate(raw.timestamp),
    created_at: validDate(raw.createdAt),
    domain_revision: typeof raw.domain_revision === "number" && Number.isSafeInteger(raw.domain_revision) ? raw.domain_revision : 0,
    last_changed_at: validDate(raw.last_changed_at),
    granot_priority: str(raw.granot_priority),
    accepted_observation: observation?.observation_id && observedAt ? { observation_id: String(observation.observation_id), captured_at: observedAt } : null,
    booked_id: id(raw.booked),
    cancelled_id: id(raw.cancelled),
    duplicate: raw.duplicate === true,
    bad_lead: str(raw.bad_lead),
    no_sync: raw.no_sync === true,
    created_on_unmatched: raw.created_on_unmatched === true,
    form_fill: raw.form_fill === true,
    receiver_agent_id: id(raw.receiver_agent),
    job_no: str(raw.job_no),
    normalized_job_no: str(raw.normalized_job_no),
    phone: str(raw.phone_number),
    normalized_phone: str(raw.normalized_phone_number),
    original_caller_phone: model === "CallLead" ? str((raw.ringcentral as { original_caller?: { normalized_phone_number?: unknown } } | null | undefined)?.original_caller?.normalized_phone_number) : null,
    ingested_phone: str((raw.ingested_contact_snapshot as { normalized_phone_number?: unknown } | null | undefined)?.normalized_phone_number),
    granot_phone: str((raw.granot_contact_snapshot as { normalized_phone_number?: unknown } | null | undefined)?.normalized_phone_number),
    name,
    move_date: model === "FormLead" ? moveDateOf(raw.move_date) : null,
  };
}
