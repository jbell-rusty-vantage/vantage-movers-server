import mongoose, { Schema } from "mongoose";

/** Provider dates only: discovery evidence, never a Lead identity assertion. */
const schema = new Schema({
  _id: { type: String, required: true },
  first_observed_at: { type: Date, required: true },
  last_observed_at: { type: Date, required: true },
}, { collection: "granot_estimates_open_dates", versionKey: false });

export const GranotEstimatesOpenDate = mongoose.models.GranotEstimatesOpenDate ??
  mongoose.model("GranotEstimatesOpenDate", schema);
