import { Schema } from "mongoose";
import {
  defineCsiModel,
  text,
  oid,
  ref,
  date,
  revision,
  enumeration,
  actor,
  index,
} from "./common";
/**
 * Retained human facts of Sales Intelligence: the Owner's contact restrictions
 * (server-admin slimming SPECIFICATION §7.3). The Owner instructions and review
 * items that used to sit beside them were retired handoff notes of the removed AI
 * pipeline with no writer or reader; the disk trim (2026-10-07) dropped both
 * collections. `run_id` and `finding_id` below are retired provenance that may
 * name dropped documents: no reader joins them.
 */
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
