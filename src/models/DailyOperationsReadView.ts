import { Schema, type Model } from "mongoose";
import { getDailyOperationsModel } from "./dailyOperationsModelFactory";

export type DailyOperationsReadViewDocument = {
  _id: string;
  generation: number;
  next_attempt_at: Date;
  lease_token: string | null;
  lease_expires_at: Date;
  payload?: unknown;
  content_hash?: string;
  revision?: number;
  generated_at?: Date;
};
const schema = new Schema<DailyOperationsReadViewDocument>({
  _id: { type: String, required: true },
  generation: { type: Number, required: true },
  next_attempt_at: { type: Date, required: true },
  lease_token: { type: String, default: null },
  lease_expires_at: { type: Date, required: true },
  payload: { type: Schema.Types.Mixed },
  content_hash: String,
  revision: Number,
  generated_at: Date,
}, { versionKey: false, minimize: false });

/** The primary _id index is the cross-instance cache/lease uniqueness fence. */
export function getDailyOperationsReadViewModel(): Model<DailyOperationsReadViewDocument> {
  return getDailyOperationsModel("DailyOperationsReadView", "read_views", schema);
}
