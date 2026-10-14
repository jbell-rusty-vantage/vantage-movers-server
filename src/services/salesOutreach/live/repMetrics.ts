import mongoose from "mongoose";
import { BookedLead } from "../../../models/BookedLead";
import { getFormLeadModel } from "../../../models/FormLead";
import { getCallLeadModel } from "../../../models/CallLead";
import type { SalesOutreachLiveChange } from "../../../validation/v1/salesOutreachReads";
import type { LiveScope } from "./stream";

/** This read adapter turns committed EntityChange inserts into ids-only metric hints. */
const METRIC_PATHS = ["agent_allocations", "total_binder_amount", "book_date", "booked", "booked_lead", "cancelled", "receiver_agent", "granot_priority", "duplicate", "bad_lead", "created_on_unmatched", "normalized_job_no", "lead_ref", "lead_model", "is_referral_booking", "is_leadless_booking", "booking_origin", "$deleted"];
export const METRIC_ENTITY_MODELS = ["FormLead", "CallLead", "BookedLead", "CancelledLead"];
const id = (value: unknown): string | null => value != null && /^[a-f\d]{24}$/.test(String(value)) ? String(value) : null;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" ? value as Record<string, unknown> : null;

export function isMetricEntityChange(change: unknown): boolean {
  const doc = record(record(change)?.fullDocument);
  const entity = record(doc?.entity);
  return Boolean(entity && METRIC_ENTITY_MODELS.includes(String(entity.model)) && Array.isArray(doc?.changed_paths) && doc.changed_paths.some((path) => typeof path === "string" && METRIC_PATHS.some((metric) => path === metric || path.startsWith(`${metric}.`))));
}

export type MetricAgentReader = (model: string, entityId: string) => Promise<readonly string[]>;
export const readMetricChangeAgents: MetricAgentReader = async (model, entityId) => {
  const oid = new mongoose.Types.ObjectId(entityId);
  if (model === "FormLead" || model === "CallLead") {
    const Model = model === "FormLead" ? getFormLeadModel() : getCallLeadModel();
    const lead = await Model.collection.findOne({ _id: oid }, { projection: { receiver_agent: 1 } });
    const receiver = id(lead?.receiver_agent);
    return receiver ? [receiver] : [];
  }
  // Allocation credit and current assignment can belong to different Agents. Both must refresh.
  const booking = model === "BookedLead" ? await BookedLead.collection.findOne({ _id: oid }, { projection: { agent_allocations: 1 } }) : null;
  const agents = Array.isArray(booking?.agent_allocations) ? booking.agent_allocations.flatMap((allocation) => {
    const agent = id(record(allocation)?.agent); return agent ? [agent] : [];
  }) : [];
  if (model === "BookedLead") {
    const [forms, calls] = await Promise.all([
      getFormLeadModel().collection.find({ booked: oid }, { projection: { receiver_agent: 1 } }).toArray(),
      getCallLeadModel().collection.find({ booked: oid }, { projection: { receiver_agent: 1 } }).toArray(),
    ]);
    for (const lead of [...forms, ...calls]) { const receiver = id(lead.receiver_agent); if (receiver) agents.push(receiver); }
  }
  return agents;
};

export async function metricEntityChangeHint(change: unknown, scope: LiveScope, readAgents: MetricAgentReader = readMetricChangeAgents): Promise<SalesOutreachLiveChange | null> {
  if (!isMetricEntityChange(change)) return null;
  const doc = record(record(change)?.fullDocument)!;
  const entity = record(doc.entity)!;
  const entityId = id(entity.id);
  if (!entityId) return null;
  const deleted = Array.isArray(doc.changed_paths) && doc.changed_paths.includes("$deleted");
  const agents = new Set<string>();
  const fields = Array.isArray(doc.fields) ? doc.fields : [];
  for (const value of fields) {
    const field = record(value);
    if (!field || field.value_mode !== "stored") continue;
    for (const side of [field.before, field.after]) {
      if (field.path === "receiver_agent") { const agent = id(side); if (agent) agents.add(agent); }
      if (field.path === "agent_allocations" && Array.isArray(side)) for (const allocation of side) {
        const agent = id(record(allocation)?.agent); if (agent) agents.add(agent);
      }
    }
  }
  // Deletes intentionally store no old values. A safe topic-only refresh reaches each viewer's own
  // read; no deleted entity id, foreign Agent id, amount or cross-Rep metadata is forwarded.
  const broadcast = deleted || entity.model === "CancelledLead";
  if (!broadcast) for (const agent of await readAgents(String(entity.model), entityId)) agents.add(agent);
  if (scope.role === "rep" && !broadcast && (!scope.agent_id || !agents.has(scope.agent_id))) return null;
  return {
    topic: "outreach_rep_metrics", subject_ids: [], agent_ids: scope.role === "rep" ? (scope.agent_id ? [scope.agent_id] : []) : [...agents].slice(0, 10),
    business_day: null, revision: null,
  };
}
