/**
 * S4-TIMELINE replica seed: inserts the deterministic documents of
 * `src/services/salesIntelligence/story/timeline.fixtures.ts` (the same ones the pure tests read through the
 * in-memory fake) into the connected test database. The caller drops the database and builds the indexes.
 */
import mongoose from "mongoose";
import { buildS4TimelineDocs, S4_AS_OF, S4_E164, S4_IDS, type S4Collection } from "../../../src/services/salesIntelligence/story/timeline.fixtures";

export { S4_AS_OF, S4_E164, S4_IDS };
export const S4_TIMELINE_DATABASE = "testvantagemovers_s4timeline";
export const S4_REPLICA = "mongodb://127.0.0.1:27189/?replicaSet=csi01";

type AnyCollection = { insertMany(docs: never[]): Promise<unknown> };
/** Real collection for each logical key: modeled collections through their model, the rest by name. */
export async function s4Collections(db: mongoose.mongo.Db): Promise<Record<S4Collection, AnyCollection>> {
  const [cn, ci, lc, lm, go, nla, orr, of, ae, maa, oi, ril] = await Promise.all([
    import("../../../src/models/ContactNumber"), import("../../../src/models/CallInteraction"), import("../../../src/models/LeadConversation"),
    import("../../../src/models/LeadMessage"), import("../../../src/models/GranotObservation"), import("../../../src/models/NumberLeadAttachment"),
    import("../../../src/models/OutreachRecord"), import("../../../src/models/OutreachFollowup"), import("../../../src/models/SalesIntelligenceAuditEvent"),
    import("../../../src/models/MoveAssessmentArtifact"), import("../../../src/models/SalesIntelligenceOwnerInstruction"), import("../../../src/models/RepIdentityLink"),
  ]);
  return {
    contactNumbers: cn.getContactNumberModel().collection, calls: ci.getCallInteractionModel().collection, conversations: lc.getLeadConversationModel().collection,
    messages: lm.getLeadMessageModel().collection, observations: go.getGranotObservationModel().collection, attachments: nla.getNumberLeadAttachmentModel().collection,
    records: orr.getOutreachRecordModel().collection, followups: of.getOutreachFollowupModel().collection, audits: ae.getSalesIntelligenceAuditEventModel().collection,
    artifacts: maa.getMoveAssessmentArtifactModel().collection, instructions: oi.getSalesIntelligenceOwnerInstructionModel().collection, repLinks: ril.getRepIdentityLinkModel().collection,
    form_leads: db.collection("form_leads"), call_leads: db.collection("call_leads"), entity_changes: db.collection("entity_changes"),
    booked_leads: db.collection("booked_leads"), cancelled_leads: db.collection("cancelled_leads"),
  } as unknown as Record<S4Collection, AnyCollection>;
}

/** Inserts every fixture document; returns the count per logical collection. */
export async function seedS4Timeline(db: mongoose.mongo.Db): Promise<Record<string, number>> {
  const docs = buildS4TimelineDocs();
  const collections = await s4Collections(db);
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(docs) as Array<[S4Collection, Record<string, unknown>[]]>) {
    if (rows.length) await collections[name].insertMany(rows as never[]);
    counts[name] = rows.length;
  }
  return counts;
}
