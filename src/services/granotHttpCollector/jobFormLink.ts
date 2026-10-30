import { randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { SheetSyncLease } from "../../models/SheetSyncLease";
import { MongoLeaseStore } from "../durableWork/leases";
import { jobNumbersEquivalent, normalizeJobNo } from "../bookings/bookingIdentity";
import { openGranotAuthenticatedSession, type GranotSessionRequest } from "./index";
import { readGranotCredentials } from "./credentials";

export const GRANOT_ORIGIN = "https://eagle.hellomoving.com";
export class GranotJobLinkError extends Error {
  constructor(readonly reason: "busy" | "not_found" | "unverified" | "unavailable") { super(reason); }
}
export type VerifiedGranotJobLink = { job_no: string; url: string };

/** Only an exact observed charges URL, never a report/login/session-menu URL. */
export function isGranotJobFormUrl(value: string): boolean {
  return /^https:\/\/eagle\.hellomoving\.com\/wc\.dll\?mpcharge~chargeswc~[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
}

export function verifiedJobLinkFromPage(html: string, requestedJob: string): VerifiedGranotJobLink | null {
  const $ = cheerio.load(html);
  const labels = $("td").toArray().filter(cell => /^Job No:\s*$/i.test($(cell).text().trim()));
  if (labels.length !== 1) return null;
  const actual = $(labels[0]!).next().text().replace(/\s/g, "");
  if (!jobNumbersEquivalent(normalizeJobNo(actual), normalizeJobNo(requestedJob))) return null;
  const paths = [...new Set(html.match(/\/wc\.dll\?mpcharge~chargeswc~[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}/gi) ?? [])];
  if (paths.length !== 1) return null;
  return { job_no: actual, url: `${GRANOT_ORIGIN}${paths[0]}` };
}

/** Search only; no execution of job-page scripts or submit/update actions. History is a bounded fallback. */
export async function searchGranotJobForm(request: GranotSessionRequest, session: string, job: string): Promise<VerifiedGranotJobLink> {
  if (!/^[a-z\d-]{1,40}$/i.test(job)) throw new GranotJobLinkError("unverified");
  await request(`/wc.dll?mv~searchwc~${session}`);
  for (const history of [false, true]) {
    const body = new URLSearchParams({ ORDNO: job });
    if (history) body.set("HISTORY", "ON");
    const html = await request(`/wc.dll?mv~searchret~${session}`, { method: "POST", body });
    const verified = verifiedJobLinkFromPage(html, job);
    if (verified) return verified;
    // A mismatched job is never treated as an absent job and never saved.
    if (/Job No:/i.test(html)) throw new GranotJobLinkError("unverified");
  }
  throw new GranotJobLinkError("not_found");
}

/** Shares the existing automation lease so clicks cannot invalidate a running collector's login. */
export async function retrieveGranotJobFormLink(job: string): Promise<VerifiedGranotJobLink> {
  const store = new MongoLeaseStore(SheetSyncLease);
  const ttl = 90_000;
  let lease = await store.acquire({ scope: "granot:automation:account", owner: `desk-job-link:${randomUUID()}`, now: new Date(), ttl_ms: ttl });
  if (!lease) throw new GranotJobLinkError("busy");
  const deadline = Date.now() + 60_000;
  let requests = 0;
  try {
    const transport: typeof fetch = async (input, init) => {
      if (++requests > 20 || Date.now() > deadline || new URL(String(input)).origin !== GRANOT_ORIGIN) throw new GranotJobLinkError("unavailable");
      const renewed = await store.renew({ token: lease!, now: new Date(), ttl_ms: ttl });
      if (!renewed) throw new GranotJobLinkError("busy");
      lease = renewed;
      return fetch(input, init);
    };
    const session = await openGranotAuthenticatedSession(readGranotCredentials(), { fetch: transport, timeoutMs: 10_000 });
    return await searchGranotJobForm(session.request, session.sessionToken, job);
  } catch (error) {
    // Provider errors can include session URLs. Do not propagate them into route logs or responses.
    throw error instanceof GranotJobLinkError ? error : new GranotJobLinkError("unavailable");
  } finally {
    await store.release({ token: lease, now: new Date() });
  }
}
