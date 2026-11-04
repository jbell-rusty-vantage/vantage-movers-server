import mongoose, { type ClientSession } from "mongoose";
import { getFormFillWorkModel } from "../../models/FormFillWork";

/** Same transaction as the Lead write; resetting the cursor makes corrections replayable. */
export async function scheduleFormFillWork(model: "FormLead" | "CallLead", id: string, session?: ClientSession) {
  await getFormFillWorkModel().updateOne({ _id: `${model}:${id}` }, { $set: {
    model, lead_id: id, generation: new mongoose.Types.ObjectId(), after_id: null, due_at: new Date(),
  } }, { upsert: true, session });
}
