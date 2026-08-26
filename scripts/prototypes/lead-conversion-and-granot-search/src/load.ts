import type { Db, Document } from "mongodb";
import mongoose from "mongoose";
import {
  equivalentNormalizedJobFilter,
  normalizeJobNo,
} from "../../../../src/services/bookings/bookingIdentity.js";
import type {
  GranotSearchCatalog,
  ReceivedLeadRow,
  SearchCommandRow,
  SearchDecisionRow,
  SearchObservationRow,
  SuccessfulSmsLeadRow,
} from "./types.js";
import { SUCCESSFUL_LEAD_MESSAGE_STATUSES } from "./types.js";

export const PROTOTYPE_DATABASE = "vantagemovers";

function asId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "toHexString" in value) {
    return String((value as { toHexString: () => string }).toHexString());
  }
  return String(value);
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return "";
}

function isSet(value: unknown): boolean {
  return value != null && value !== "";
}

export function equivalentObservationJobFilter(
  normalizedJobNo: string,
): Document {
  const filter = equivalentNormalizedJobFilter(normalizedJobNo);
  if ("normalized_job_no" in filter && typeof filter.normalized_job_no === "string") {
    return { "identity.normalized_job_no": filter.normalized_job_no };
  }
  const clauses = "$or" in filter ? filter.$or : [];
  return {
    $or: clauses.map((clause) => ({
      "identity.normalized_job_no": clause.normalized_job_no,
    })),
  };
}

export async function productionDatabase(connection: typeof mongoose): Promise<Db> {
  const client = connection.connection.getClient();
  const db = client.db(PROTOTYPE_DATABASE);
  const name = db.databaseName;
  if (name !== PROTOTYPE_DATABASE) {
    throw new Error(`Refusing read against ${name}. This prototype uses ${PROTOTYPE_DATABASE}.`);
  }
  return db;
}

export async function loadSuccessfulSmsLeads(
  db: Db,
): Promise<SuccessfulSmsLeadRow[]> {
  const rows = await db.collection("lead_messages").aggregate<Document>([
    { $match: { status: { $in: [...SUCCESSFUL_LEAD_MESSAGE_STATUSES] } } },
    {
      $lookup: {
        from: "form_leads",
        localField: "lead_ref.id",
        foreignField: "_id",
        as: "form",
      },
    },
    {
      $lookup: {
        from: "call_leads",
        localField: "lead_ref.id",
        foreignField: "_id",
        as: "call",
      },
    },
    {
      $addFields: {
        lead: {
          $ifNull: [
            { $arrayElemAt: ["$form", 0] },
            { $arrayElemAt: ["$call", 0] },
          ],
        },
      },
    },
    { $match: { lead: { $ne: null } } },
    {
      $project: {
        origin: 1,
        lead_id: "$lead._id",
        booked: "$lead.booked",
        cancelled: "$lead.cancelled",
      },
    },
  ]).toArray();

  return rows.map((row) => ({
    lead_id: asId(row.lead_id),
    origin: typeof row.origin === "string" ? row.origin : "unknown",
    booked: isSet(row.booked),
    cancelled: isSet(row.cancelled),
  }));
}

async function loadAssignedLeads(
  db: Db,
  collection: "form_leads" | "call_leads",
  leadModel: ReceivedLeadRow["lead_model"],
): Promise<ReceivedLeadRow[]> {
  const rows = await db
    .collection(collection)
    .find(
      { receiver_agent: { $ne: null } },
      { projection: { booked: 1, cancelled: 1 } },
    )
    .toArray();
  return rows.map((row) => ({
    lead_id: asId(row._id),
    lead_model: leadModel,
    booked: isSet(row.booked),
    cancelled: isSet(row.cancelled),
  }));
}

export async function loadReceivedLeads(db: Db): Promise<ReceivedLeadRow[]> {
  const [form, call] = await Promise.all([
    loadAssignedLeads(db, "form_leads", "FormLead"),
    loadAssignedLeads(db, "call_leads", "CallLead"),
  ]);
  return [...form, ...call];
}

export async function countUnassignedOfficialCancellations(db: Db): Promise<number> {
  const rows = await db.collection("cancelled_leads").aggregate<Document>([
    {
      $lookup: {
        from: "booked_leads",
        localField: "booked_lead",
        foreignField: "_id",
        as: "booking",
      },
    },
    {
      $set: {
        joined_lead_ref: {
          $ifNull: ["$lead_ref", { $arrayElemAt: ["$booking.lead_ref", 0] }],
        },
      },
    },
    {
      $lookup: {
        from: "form_leads",
        localField: "joined_lead_ref",
        foreignField: "_id",
        as: "form",
      },
    },
    {
      $lookup: {
        from: "call_leads",
        localField: "joined_lead_ref",
        foreignField: "_id",
        as: "call",
      },
    },
    {
      $set: {
        lead: {
          $ifNull: [
            { $arrayElemAt: ["$form", 0] },
            { $arrayElemAt: ["$call", 0] },
          ],
        },
      },
    },
    {
      $match: {
        $or: [{ lead: null }, { "lead.receiver_agent": null }],
      },
    },
    { $count: "n" },
  ]).toArray();
  return typeof rows[0]?.n === "number" ? rows[0].n : 0;
}

export async function loadGranotSearchCatalog(
  db: Db,
  rawJobNo: string,
): Promise<GranotSearchCatalog> {
  const normalized = normalizeJobNo(rawJobNo);
  if (!normalized) {
    return { observations: [], decisions: [], commands: [] };
  }

  const observationDocs = await db
    .collection("granot_observations")
    .find(equivalentObservationJobFilter(normalized), {
      projection: {
        captured_at: 1,
        "identity.normalized_job_no": 1,
        route_event_class: 1,
        payload_event_type_raw: 1,
        "booking_action.raw": 1,
        "booking_action.normalized": 1,
        "priority.canonical": 1,
        normalization_result: 1,
      },
    })
    .toArray();

  const observations: SearchObservationRow[] = observationDocs.map((row) => {
    const identity =
      row.identity && typeof row.identity === "object"
        ? (row.identity as { normalized_job_no?: string })
        : {};
    const bookingAction =
      row.booking_action && typeof row.booking_action === "object"
        ? (row.booking_action as { raw?: string; normalized?: string })
        : {};
    const priority =
      row.priority && typeof row.priority === "object"
        ? (row.priority as { canonical?: string })
        : {};
    return {
      id: asId(row._id),
      captured_at: asIso(row.captured_at),
      normalized_job_no: identity.normalized_job_no,
      route_event_class:
        typeof row.route_event_class === "string" ? row.route_event_class : undefined,
      payload_event_type_raw:
        typeof row.payload_event_type_raw === "string"
          ? row.payload_event_type_raw
          : undefined,
      booking_action_raw: bookingAction.raw,
      booking_action_normalized: bookingAction.normalized,
      priority_canonical: priority.canonical,
      normalization_result:
        typeof row.normalization_result === "string"
          ? row.normalization_result
          : undefined,
    };
  });

  const observationIds = observations.map((row) => row.id);
  if (observationIds.length === 0) {
    return { observations, decisions: [], commands: [] };
  }

  const objectIds = observationIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const [decisionDocs, commandDocs] = await Promise.all([
    db
      .collection("synchronization_decisions")
      .find(
        { observation_id: { $in: objectIds } },
        {
          projection: {
            observation_id: 1,
            attempt: 1,
            outcome: 1,
            reason_code: 1,
            execution_mode: 1,
            decided_at: 1,
          },
        },
      )
      .toArray(),
    db
      .collection("domain_command_executions")
      .find(
        { "provenance.observation_id": { $in: observationIds } },
        {
          projection: {
            command_name: 1,
            "provenance.observation_id": 1,
            applied_at: 1,
            entity_refs: 1,
          },
        },
      )
      .toArray(),
  ]);

  const decisions: SearchDecisionRow[] = decisionDocs.map((row) => ({
    id: asId(row._id),
    observation_id: asId(row.observation_id),
    attempt: typeof row.attempt === "number" ? row.attempt : 0,
    outcome: typeof row.outcome === "string" ? row.outcome : "",
    reason_code: typeof row.reason_code === "string" ? row.reason_code : "",
    execution_mode:
      typeof row.execution_mode === "string" ? row.execution_mode : "",
    decided_at: asIso(row.decided_at),
  }));

  const commands: SearchCommandRow[] = commandDocs.map((row) => {
    const provenance =
      row.provenance && typeof row.provenance === "object"
        ? (row.provenance as { observation_id?: unknown })
        : {};
    const entityRefs = Array.isArray(row.entity_refs) ? row.entity_refs : [];
    return {
      id: asId(row._id),
      command_name: typeof row.command_name === "string" ? row.command_name : "",
      observation_id: asId(provenance.observation_id),
      applied_at: asIso(row.applied_at),
      entity_models: entityRefs
        .map((entry) =>
          entry && typeof entry === "object" && "model" in entry
            ? String((entry as { model: unknown }).model)
            : "",
        )
        .filter(Boolean),
    };
  });

  return { observations, decisions, commands };
}
