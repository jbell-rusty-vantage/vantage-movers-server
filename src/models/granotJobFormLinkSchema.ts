import { Schema } from "mongoose";

/** Navigation cache only; excluded from normal Lead reads and never job identity. */
export const granotJobFormLinkField = {
  type: new Schema({
    job_no: { type: String, required: true },
    url: { type: String, required: true },
    captured_at: { type: Date, required: true },
  }, { _id: false }),
  select: false,
  default: undefined,
};
