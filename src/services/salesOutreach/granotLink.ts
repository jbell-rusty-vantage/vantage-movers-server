import mongoose from "mongoose";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import type { OutreachActor } from "./auth";
import type { DeskReadDeps } from "./reads/common";
import { requireDeskConfiguration } from "./reads/common";
import { mongoDeskQueueStore } from "./reads/deskStore";
import { OutreachError } from "./errors";
import { canUseGranotLinkPilot } from "./granotLinkPilot";
import { GranotJobLinkError, isGranotJobFormUrl, retrieveGranotJobFormLink, type VerifiedGranotJobLink } from "../granotHttpCollector/jobFormLink";
import { jobNumbersEquivalent, normalizeJobNo } from "../bookings/bookingIdentity";
import type { DeskLeadRef } from "./subjects/leadFacts";

type Cache = VerifiedGranotJobLink & { captured_at: Date };
type Lead = { job_no?: string; receiver_agent?: mongoose.Types.ObjectId; granot_job_form_link?: Cache };
export type GranotLinkStore = {
  read(lead: DeskLeadRef): Promise<Lead | null>;
  save(lead: DeskLeadRef, expected: { job_no: string; receiver: string }, cache: Cache): Promise<boolean>;
};
const model = (lead: DeskLeadRef) => lead.model === "FormLead" ? getFormLeadModel() : getCallLeadModel();
const mongoStore: GranotLinkStore = {
  async read(lead) {
    return model(lead).collection.findOne<Lead>({ _id: new mongoose.Types.ObjectId(lead.id) }, { projection: { job_no: 1, receiver_agent: 1, granot_job_form_link: 1 } });
  },
  async save(lead, expected, cache) {
    // Navigation metadata, not a domain change: no revision, lifecycle, Sheets or assignment effects.
    const result = await model(lead).collection.updateOne({ _id: new mongoose.Types.ObjectId(lead.id), job_no: expected.job_no, receiver_agent: new mongoose.Types.ObjectId(expected.receiver) }, { $set: { granot_job_form_link: cache } });
    return result.matchedCount === 1;
  },
};
const CACHE_MS = 10 * 60_000;

export async function resolveOutreachGranotLink(actor: OutreachActor, subjectId: string, refresh: boolean, deps: DeskReadDeps & { linkStore?: GranotLinkStore; retrieve?: typeof retrieveGranotJobFormLink }) {
  // Refuse every non-pilot identity before reading a Lead or touching Granot.
  if (!canUseGranotLinkPilot(actor, actor.agent_id)) throw new OutreachError("FORBIDDEN");
  await requireDeskConfiguration(deps.loader);
  if (!/^[a-f\d]{24}$/.test(subjectId)) throw new OutreachError("NOT_FOUND");
  const queueStore = deps.queueStore ?? mongoDeskQueueStore;
  const subject = await queueStore.loadSubject(subjectId, null);
  if (!subject || subject.status === "closed") throw new OutreachError("NOT_FOUND");
  const store = deps.linkStore ?? mongoStore;
  const before = await store.read(subject.lead);
  const receiver = before?.receiver_agent?.toString();
  if (!before || !canUseGranotLinkPilot(actor, receiver)) throw new OutreachError("NOT_FOUND");
  const job = normalizeJobNo(before.job_no);
  if (!job) throw new OutreachError("INVALID_INPUT", [{ path: "job_no", code: "job_number_pending" }]);
  let cache = before.granot_job_form_link;
  const age = cache ? +deps.now - +cache.captured_at : Infinity;
  const reusable = !refresh && cache && age >= 0 && age < CACHE_MS && isGranotJobFormUrl(cache.url) && jobNumbersEquivalent(job, normalizeJobNo(cache.job_no));
  if (!reusable) {
    try {
      const verified = await (deps.retrieve ?? retrieveGranotJobFormLink)(job);
      if (!isGranotJobFormUrl(verified.url) || !jobNumbersEquivalent(job, normalizeJobNo(verified.job_no))) throw new GranotJobLinkError("unverified");
      cache = { ...verified, captured_at: new Date() };
    } catch (error) {
      const reason = error instanceof GranotJobLinkError ? error.reason : "unavailable";
      throw new OutreachError("SERVICE_UNAVAILABLE", [{ path: "granot_link", code: reason }]);
    }
  }
  if (!cache) throw new OutreachError("SERVICE_UNAVAILABLE");
  // Recheck canonical assignment, job and subject after provider I/O (or before returning a cache hit).
  const [current, currentSubject] = await Promise.all([store.read(subject.lead), queueStore.loadSubject(subjectId, null)]);
  if (!currentSubject || currentSubject.status === "closed" || currentSubject.lead.id !== subject.lead.id || currentSubject.lead.model !== subject.lead.model || !canUseGranotLinkPilot(actor, current?.receiver_agent?.toString()) || current?.job_no !== before.job_no) throw new OutreachError("NOT_FOUND");
  if (!await store.save(subject.lead, { job_no: before.job_no!, receiver: receiver! }, cache)) throw new OutreachError("NOT_FOUND");
  return { url: cache.url, job_no: cache.job_no, captured_at: cache.captured_at.toISOString(), cached: Boolean(reusable) };
}
