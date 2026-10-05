import { Schema } from "mongoose";
import {
  defineCsiModel,
  str,
  text,
  oid,
  ref,
  date,
  at,
  revision,
  refs,
  enumeration,
  actor,
  validatedJson,
  unique,
  index,
} from "./common";
/**
 * Retained human and provider facts of Sales Intelligence (server-admin slimming SPECIFICATION
 * §7.3): Owner instructions, review items and contact restrictions. Most were opened by the
 * retired AI pipeline; they stay as minimal history and enforceable restrictions. `followup_id`,
 * `finding_id` and `run_id` are retired provenance that may name dropped documents: no reader
 * joins them.
 */
export const SALES_INTELLIGENCE_OWNER_INSTRUCTION_INDEXES = [
  unique("csi_instruction_revision_unique", { instruction_id: 1, revision: 1 }),
  index("csi_instruction_subject", { subject_key: 1, state: 1 }),
];
export const SalesIntelligenceOwnerInstructionSchema = new Schema(
  {
    instruction_id: oid,
    subject_key: str,
    followup_id: ref,
    finding_id: ref,
    field: enumeration([
      "assignment",
      "due_at",
      "description",
      "kind",
      "status",
      "contact_type",
      "restriction",
      "assertion",
      "closure",
    ]),
    prior: validatedJson(),
    current: validatedJson(),
    actor: { type: actor, required: true },
    happened_at: at,
    revision,
    state: enumeration(["active", "retracted", "satisfied"]),
  },
  { collection: "sales_intelligence_owner_instructions" },
);
export const getSalesIntelligenceOwnerInstructionModel = defineCsiModel(
  "SalesIntelligenceOwnerInstruction",
  SalesIntelligenceOwnerInstructionSchema,
  SALES_INTELLIGENCE_OWNER_INSTRUCTION_INDEXES,
  true,
);
export const SALES_INTELLIGENCE_REVIEW_ITEM_INDEXES = [
  unique("csi_review_cause_unique", {
    subject_key: 1,
    cause_kind: 1,
    cause_key: 1,
  }),
];
export const SalesIntelligenceReviewItemSchema = new Schema(
  {
    subject_key: str,
    cause_kind: enumeration([
      "missing_date",
      "identity",
      "completion_target",
      "restriction",
      "official_mismatch",
      "owner_conflict",
      "closed_work_request",
      "missing_responsibility",
      "unclear_commitment",
      // LP-01: a later nonterminal Priority on CRM-closed work; a terminal
      // Priority whose provenance is unresolved.
      "disposition_reopen",
      "disposition_review",
      // Context provenance §6.3: prior-finding relations and story discrepancies the server surfaces.
      "prior_fulfilled_unclaimed",
      "prior_contradiction",
      "record_disputed_on_call",
    ]),
    cause_key: str,
    state: enumeration(["open", "resolved", "dismissed"], "open"),
    evidence_ids: refs,
    resolution_actor: { type: actor, default: null },
    resolved_at: date,
    resolution_reason: text,
    opened_at: at,
    revision,
  },
  { collection: "sales_intelligence_review_items" },
);
export const getSalesIntelligenceReviewItemModel = defineCsiModel(
  "SalesIntelligenceReviewItem",
  SalesIntelligenceReviewItemSchema,
  SALES_INTELLIGENCE_REVIEW_ITEM_INDEXES,
);
export const SALES_INTELLIGENCE_CONTACT_RESTRICTION_INDEXES = [
  index("csi_restriction_number", { contact_number_id: 1, state: 1, until: 1 }),
];
export const SalesIntelligenceContactRestrictionSchema = new Schema(
  {
    contact_number_id: oid,
    source_interaction_id: { ...ref, immutable: true },
    channels: {
      type: [String],
      enum: ["call", "text"],
      required: true,
      validate: (v: string[]) => v.length > 0 && v.length === new Set(v).size,
    },
    until: date,
    origin: enumeration(["owner", "intelligence"]),
    actor: { type: actor, required: true },
    run_id: ref,
    finding_id: ref,
    // Sales Outreach Desk (P06c, IMPLEMENTATION-PLAN §4.9): the Owner's reason for an added restriction,
    // and the Owner's review of an existing row. Confirming keeps it active and blocking; only an
    // explicit lift releases it. Rows written before the desk carry none of these (null).
    reason: text,
    confirmed_at: date,
    confirmation_actor: { type: actor, default: null },
    resolution_actor: { type: actor, default: null },
    resolved_at: date,
    resolution_reason: text,
    state: enumeration(["active", "expired", "resolved"], "active"),
    revision,
  },
  { collection: "sales_intelligence_contact_restrictions" },
);
export const getSalesIntelligenceContactRestrictionModel = defineCsiModel(
  "SalesIntelligenceContactRestriction",
  SalesIntelligenceContactRestrictionSchema,
  SALES_INTELLIGENCE_CONTACT_RESTRICTION_INDEXES,
);
