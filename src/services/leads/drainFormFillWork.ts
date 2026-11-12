import mongoose from "mongoose";
import { connectMongo } from "../../db";
import { logger } from "../../logger";
import { getFormFillWorkModel } from "../../models/FormFillWork";
import { getFormLeadModel } from "../../models/FormLead";
import { getCallLeadModel } from "../../models/CallLead";
import { hasReportingEligibleCall } from "./callLeadAdmission";
import { hasFormFillForCallLead, markMatchingCallLeadsWithFormFill } from "./duplicateLead.service";
import { emitLeadChange, systemLeadChangeContext, FORM_FILL_DETECTOR_ACTOR_ID } from "../domainCommands/leadChangeEmission";
import { finalizeSheetSync, persistSheetSyncIntent, type FullSheetSyncJob } from "../sheetSync";

/** At most 20 pages of 25 Calls per tick. Cursor and effects commit atomically.
 * Concurrent drains conflict on the work row; transaction retry reloads it.
 * A concurrent Lead correction resets its generation/cursor without losing work.
 */
export async function drainFormFillWork(maxPages = 20) {
  await connectMongo();
  let pages = 0;
  let deferred = 0;
  while (pages < maxPages) {
    const session = await mongoose.startSession();
    let found = false;
    let jobs: FullSheetSyncJob[] = [];
    let failedTask: { _id: string; generation: mongoose.Types.ObjectId } | null = null;
    try {
      await session.withTransaction(async () => {
        jobs = [];
        found = false;
        const Work = getFormFillWorkModel();
        const task = await Work.findOne({ due_at: { $lte: new Date() } }).sort({ due_at: 1, _id: 1 }).session(session).lean().exec();
        if (!task) return;
        found = true;
        failedTask = { _id: task._id, generation: task.generation };
        let full = false;
        let lastId: mongoose.Types.ObjectId | null = null;
        if (task.model === "FormLead") {
          const form = await getFormLeadModel().findById(task.lead_id).session(session).exec();
          if (form && !form.duplicate) {
            jobs = await markMatchingCallLeadsWithFormFill({ sourceCompany: form.source_company,
              leadSourceCompany: form.lead_source_company }, form.phone_number, String(form._id), session, undefined,
              { afterId: task.after_id, onPage: (id, more) => { lastId = id; full = more; } });
          }
        } else {
          const call = await getCallLeadModel().findById(task.lead_id).session(session).exec();
          if (call && call.form_fill !== true && hasReportingEligibleCall(call) &&
            await hasFormFillForCallLead({ sourceCompany: call.source_company,
              leadSourceCompany: call.lead_source_company }, call.phone_number, session)) {
            const before = call.toObject() as Record<string, unknown>;
            call.form_fill = true;
            await call.save({ session });
            await emitLeadChange({ model: "CallLead", id: String(call._id), before, paths: ["form_fill"],
              session, now: new Date(), command_name: "markCallLeadFormFill",
              context: systemLeadChangeContext({ actor_id: FORM_FILL_DETECTOR_ACTOR_ID, command_name: "markCallLeadFormFill" }) });
            jobs.push({ resource: "source_lead", operation: "call_lead.form_fill.update", leadModel: "CallLead", leadId: String(call._id) });
          }
        }
        for (const job of jobs) await persistSheetSyncIntent(job, session);
        const guard = { _id: task._id, generation: task.generation };
        if (full) await Work.updateOne(guard, { $set: { after_id: lastId, due_at: new Date() } }, { session });
        else await Work.deleteOne(guard, { session });
      });
    } catch (error) {
      jobs = [];
      if (!failedTask) throw error;
      // Keep durable intent and let unrelated work/Sheets proceed. A new generation
      // scheduled during this failure must not inherit the old task's delay.
      await getFormFillWorkModel().updateOne(failedTask, { $set: { due_at: new Date(Date.now() + 60_000) } });
      logger.error({ err: error, msg: "lead.form_fill.work_deferred", task: failedTask });
      deferred++;
    } finally { await session.endSession(); }
    for (const job of jobs) await finalizeSheetSync(job);
    if (!found) break;
    pages++;
  }
  return { pages, deferred, remaining: await getFormFillWorkModel().countDocuments({}) };
}
