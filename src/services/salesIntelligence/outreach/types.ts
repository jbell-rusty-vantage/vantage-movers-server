import type { InferSchemaType, HydratedDocument, Types } from "mongoose";
import type { OutreachRecordSchema, OutreachFollowupSchema } from "../../../models/salesIntelligence/outreach";
import type { CallInteractionSchema } from "../../../models/CallInteraction";
export type RecordRow = InferSchemaType<typeof OutreachRecordSchema> & { _id: Types.ObjectId };
export type FollowupRow = InferSchemaType<typeof OutreachFollowupSchema> & { _id: Types.ObjectId; createdAt?: Date };
export type RecordDocument = HydratedDocument<RecordRow>;
export type FollowupDocument = HydratedDocument<FollowupRow>;
export type InteractionRow = InferSchemaType<typeof CallInteractionSchema> & { _id: Types.ObjectId };
export function subjectKey(subject: RecordRow["subject"]): string {
  return subject.kind === "lead" ? `lead:${subject.model}:${subject.id}` : `number:${subject.contact_number_id}`;
}
