import { randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { SheetSyncLease } from "../../models/SheetSyncLease";
import { MongoLeaseStore } from "../durableWork/leases";
import { openGranotNetworkSession, type GranotSessionRequest } from "./index";
import { readGranotNetworkCredentials } from "./credentials";
import { verifiedJobLinkFromPage, type VerifiedGranotJobLink, GRANOT_ORIGIN } from "./jobFormLink";

export class GranotSessionJobLinkError extends Error {
  constructor(readonly reason: "busy" | "unavailable" | "session_expired" | "account_mismatch" | "unverified" | "not_found") { super(reason); }
}

/** Verify the supplied context's user BEFORE searching. Opening a menu on the result context clears its job. */
export async function searchGranotJobInUserSession(request: GranotSessionRequest, context: string, job: string, expectedUsername: string): Promise<VerifiedGranotJobLink> {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(context) || !expectedUsername.trim()) throw new GranotSessionJobLinkError("session_expired");
  const numericJob = /^P?(\d{1,20})$/i.exec(job.trim())?.[1];
  if (!numericJob) throw new GranotSessionJobLinkError("unverified");
  const menu = await request(`/wc.dll?mv~mainmenuwc~${context}~LOGIN`);
  const text = cheerio.load(menu)("body").text().replace(/\s+/g, " ");
  const username = /Logged\s+in\s+as\s+([a-z\d._@-]+)/i.exec(text)?.[1];
  if (!username) throw new GranotSessionJobLinkError("session_expired");
  if (username.toUpperCase() !== expectedUsername.trim().toUpperCase()) throw new GranotSessionJobLinkError("account_mismatch");
  const html = await request(`/wc.dll?mv~searchret~${context}~QSEARCH`, { method: "POST", body: new URLSearchParams({ VALUE: numericJob, B5: "Search" }) });
  const result = verifiedJobLinkFromPage(html, job);
  if (!result) throw new GranotSessionJobLinkError(/Job No:/i.test(html) ? "unverified" : "not_found");
  return result;
}

/** Company credentials establish transport only; the supplied, verified user context owns the job lookup. */
export async function retrieveGranotJobInUserSession(context: string, job: string, expectedUsername: string): Promise<VerifiedGranotJobLink> {
  const store = new MongoLeaseStore(SheetSyncLease);
  const ttl = 90_000;
  let lease = await store.acquire({ scope: "granot:automation:account", owner: `desk-session-link:${randomUUID()}`, now: new Date(), ttl_ms: ttl });
  if (!lease) throw new GranotSessionJobLinkError("busy");
  let requests = 0;
  const deadline = Date.now() + 60_000;
  try {
    const transport: typeof fetch = async (input, init) => {
      if (++requests > 16 || Date.now() > deadline || new URL(String(input)).origin !== GRANOT_ORIGIN) throw new GranotSessionJobLinkError("unavailable");
      const renewed = await store.renew({ token: lease!, now: new Date(), ttl_ms: ttl });
      if (!renewed) throw new GranotSessionJobLinkError("busy");
      lease = renewed;
      return fetch(input, init);
    };
    const network = await openGranotNetworkSession(readGranotNetworkCredentials(), { fetch: transport, timeoutMs: 10_000 });
    return await searchGranotJobInUserSession(network.request, context, job, expectedUsername);
  } catch (error) {
    if (error instanceof GranotSessionJobLinkError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "invalid_session") throw new GranotSessionJobLinkError("session_expired");
    // Provider errors may contain private URLs. Never propagate their text or a credential-based fallback.
    throw new GranotSessionJobLinkError("unavailable");
  } finally { await store.release({ token: lease, now: new Date() }); }
}
