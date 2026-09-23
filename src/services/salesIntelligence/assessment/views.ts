import { FORM_LEAD_UNKNOWN_STATE } from "../../../models/FormLead";

/** Three labelled move views (MA-01 §5). Pure: the server supplies these; the model never copies them. */
export type MoveEndpoint = { city: string | null; state: string | null; zip: string | null };
export type MoveView = {
  pickup: MoveEndpoint; delivery: MoveEndpoint;
  /** YYYY-MM-DD: Lead move dates are calendar dates stored at UTC midnight. */
  move_date: string | null; move_size: string | null; granot_move_size: string | null; cubic_feet: number | null;
  provenance: { source_system: string; changed_at: string | null; observation_id: string | null } | null;
};
export type OriginalIngestionLabel = "original_form_submission" | "legacy_baseline" | "granot_created" | "unknown";
export type OriginalIngestionView = MoveView & {
  captured_at: string | null; evidence_status: string; ingestion_origin: string | null; label: OriginalIngestionLabel;
};
export type MoveViews = { original_ingestion: OriginalIngestionView | null; canonical_current: MoveView };

type Text = string | null | undefined;
type MoveFields = {
  pickup_city?: Text; pickup_state?: Text; pickup_zip?: Text;
  delivery_city?: Text; delivery_state?: Text; destination_zip?: Text; delivery_zip?: Text;
  move_date?: Date | null; move_size?: Text;
};
/** Structural subset of a lean FormLead/CallLead row. */
export type LeadMoveSource = MoveFields & {
  granot_move_size?: Text; cubic_feet?: number | null; ingestion_origin?: Text;
  current_move_provenance?: { source_system: string; changed_at?: Date | null; observation_id?: unknown } | null;
  ingested_move_snapshot?: (MoveFields & { captured_at?: Date | null; evidence_status: string }) | null;
};

/** Customer-submitted origins. Granot-created, sheet, admin and legacy rows are not proof of a form submission. */
const FORM_SUBMISSION_ORIGINS = new Set(["wordpress_form"]);
// Raw-driver reads can hold a non-string (a numeric zip); coerce so one odd Lead never throws inside the Attention walk.
const clean = (value: Text | number) => value == null ? null : String(value).trim() || null;
const state = (value: Text) => { const v = clean(value); return v === FORM_LEAD_UNKNOWN_STATE ? null : v; };
const day = (value: Date | null | undefined) => value instanceof Date && !Number.isNaN(+value) ? value.toISOString().slice(0, 10) : null;

function moveView(fields: MoveFields, model: "FormLead" | "CallLead"): Omit<MoveView, "granot_move_size" | "cubic_feet" | "provenance"> {
  return {
    pickup: { city: clean(fields.pickup_city), state: state(fields.pickup_state), zip: clean(fields.pickup_zip) },
    // Form Lead `destination_zip` and Call Lead `delivery_zip` are the same assessment destination field.
    delivery: { city: clean(fields.delivery_city), state: state(fields.delivery_state),
      zip: clean(model === "FormLead" ? fields.destination_zip : fields.delivery_zip) },
    move_date: model === "FormLead" ? day(fields.move_date) : null,
    move_size: model === "FormLead" ? clean(fields.move_size) : null,
  };
}

export function moveViewsForLead(lead: LeadMoveSource, model: "FormLead" | "CallLead"): MoveViews {
  const provenance = lead.current_move_provenance;
  const canonical_current: MoveView = { ...moveView(lead, model), granot_move_size: clean(lead.granot_move_size),
    cubic_feet: typeof lead.cubic_feet === "number" && Number.isFinite(lead.cubic_feet) ? lead.cubic_feet : null,
    provenance: provenance ? { source_system: provenance.source_system, changed_at: provenance.changed_at?.toISOString() ?? null,
      observation_id: provenance.observation_id ? String(provenance.observation_id) : null } : null };
  const snapshot = model === "FormLead" ? lead.ingested_move_snapshot : null;
  if (!snapshot) return { original_ingestion: null, canonical_current };
  const origin = clean(lead.ingestion_origin);
  const label: OriginalIngestionLabel = snapshot.evidence_status === "legacy_baseline" ? "legacy_baseline"
    : snapshot.evidence_status !== "captured_at_ingestion" ? "unknown"
      : origin && FORM_SUBMISSION_ORIGINS.has(origin) ? "original_form_submission"
        : origin === "granot_lead_created" ? "granot_created" : "unknown";
  return { canonical_current, original_ingestion: { ...moveView(snapshot, "FormLead"), granot_move_size: null, cubic_feet: null,
    provenance: null, captured_at: snapshot.captured_at?.toISOString() ?? null, evidence_status: snapshot.evidence_status,
    ingestion_origin: origin, label } };
}
