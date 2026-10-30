import mongoose from "mongoose";
import { getCallLeadModel } from "../../models/CallLead";
import { getFormLeadModel } from "../../models/FormLead";
import type { OutreachActor } from "./auth";
import type { DeskReadDeps } from "./reads/common";
import { requireDeskConfiguration } from "./reads/common";
import { mongoDeskQueueStore } from "./reads/deskStore";
import { OutreachError } from "./errors";
import { canOpenGranotLink } from "./granotLinkAccess";
import { getPoolAccess } from "./pool/reads";
import type { ActiveConfiguration } from "./config/load";
import { GranotJobLinkError, isGranotJobFormUrl, retrieveGranotJobFormLink, type VerifiedGranotJobLink } from "../granotHttpCollector/jobFormLink";
import { jobNumbersEquivalent, normalizeJobNo } from "../bookings/bookingIdentity";
import type { DeskLeadRef } from "./subjects/leadFacts";

type Cache = VerifiedGranotJobLink & { captured_at: Date };
type Lead = { job_no?: string; receiver_agent?: mongoose.Types.ObjectId; granot_job_form_link?: Cache };
export type GranotLinkStore = {
  read(lead: DeskLeadRef): Promise<Lead | null>;
  save(lead: DeskLeadRef, expected: { job_no: string; receiver: string | null }, cache: Cache): Promise<boolean>;
};
const model = (lead: DeskLeadRef) => lead.model === "FormLead" ? getFormLeadModel() : getCallLeadModel();
const mongoStore: GranotLinkStore = {
  async read(lead) {
    return model(lead).collection.findOne<Lead>({ _id: new mongoose.Types.ObjectId(lead.id) }, { projection: { job_no: 1, receiver_agent: 1, granot_job_form_link: 1 } });
  },
  async save(lead, expected, cache) {
    // Navigation metadata, not a domain change: no revision, lifecycle, Sheets or assignment effects.
    const result = await model(lead).collection.updateOne({ _id: new mongoose.Types.ObjectId(lead.id), job_no: expected.job_no, receiver_agent: expected.receiver ? new mongoose.Types.ObjectId(expected.receiver) : null }, { $set: { granot_job_form_link: cache } });
    return result.matchedCount === 1;
  },
};
const CACHE_MS = 10 * 60_000;

export async function resolveOutreachGranotLink(actor: OutreachActor, subjectId: string, refresh: boolean, deps: DeskReadDeps & {
  linkStore?: GranotLinkStore;
  retrieve?: typeof retrieveGranotJobFormLink;
  hasPoolAccess?: (subjectId: string, configuration: ActiveConfiguration) => Promise<boolean>;
}) {
  if (actor.role === "rep" && !actor.agent_id) throw new OutreachError("FORBIDDEN");
  const configuration = await requireDeskConfiguration(deps.loader);
  if (!/^[a-f\d]{24}$/.test(subjectId)) throw new OutreachError("NOT_FOUND");
  const queueStore = deps.queueStore ?? mongoDeskQueueStore;
  const subject = await queueStore.loadSubject(subjectId, null);
  if (!subject || subject.status === "closed") throw new OutreachError("NOT_FOUND");
  const store = deps.linkStore ?? mongoStore;
  const before = await store.read(subject.lead);
  const receiver = before?.receiver_agent?.toString() ?? null;
  const hasPoolAccess = deps.hasPoolAccess ?? (async (id: string, config: ActiveConfiguration) => Boolean(await getPoolAccess(id, config)));
  const authorized = async (assignee: string | null, config: ActiveConfiguration) => canOpenGranotLink(actor, assignee,
    actor.role === "rep" && assignee !== actor.agent_id ? await hasPoolAccess(subjectId, config) : false);
  if (!before || !await authorized(receiver, configuration)) throw new OutreachError("NOT_FOUND");
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
  const [current, currentSubject, currentConfiguration] = await Promise.all([store.read(subject.lead), queueStore.loadSubject(subjectId, null), requireDeskConfiguration(deps.loader)]);
  const currentReceiver = current?.receiver_agent?.toString() ?? null;
  if (!current || !currentSubject || currentSubject.status === "closed" || currentSubject.lead.id !== subject.lead.id || currentSubject.lead.model !== subject.lead.model || currentReceiver !== receiver || current.job_no !== before.job_no || !await authorized(currentReceiver, currentConfiguration)) throw new OutreachError("NOT_FOUND");
  if (!await store.save(subject.lead, { job_no: before.job_no!, receiver }, cache)) throw new OutreachError("NOT_FOUND");
  return { url: cache.url, job_no: cache.job_no, captured_at: cache.captured_at.toISOString(), cached: Boolean(reusable) };
}
