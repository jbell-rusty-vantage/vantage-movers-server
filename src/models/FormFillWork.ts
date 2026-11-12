import mongoose, { type InferSchemaType, type Model } from "mongoose";
import { getMongoDatabaseName } from "../config/domain/runtime";

const schema = new mongoose.Schema({
  _id: { type: String, required: true },
  model: { type: String, enum: ["FormLead", "CallLead"], required: true },
  lead_id: { type: String, required: true },
  generation: { type: mongoose.Schema.Types.ObjectId, required: true },
  after_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  due_at: { type: Date, required: true },
}, { collection: "form_fill_work", versionKey: false });
schema.index({ due_at: 1, _id: 1 });

type FormFillWorkDocument = InferSchemaType<typeof schema>;

export function getFormFillWorkModel(): Model<FormFillWorkDocument> {
  const db = mongoose.connection.useDb(getMongoDatabaseName(), { useCache: true });
  return (db.models.FormFillWork as Model<FormFillWorkDocument> | undefined) ?? db.model<FormFillWorkDocument>("FormFillWork", schema);
}
