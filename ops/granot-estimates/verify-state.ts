/** Signed read-only Lead/Desk convergence inventory. Persists only minimized identity/policy facts. */
import { writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { ownerApi } from "./api-client";
import { normalizeJobNo } from "../../src/services/bookings/bookingIdentity";

type LeadFact = { id: string; model: string; job: string | null; priority: string | null; receiver: string | null; receiver_source: string | null; quoted: boolean; cubic_feet: number | null; closed: boolean; revision: number; accepted_at: string | null };
type DeskRow = { subject_id: string; job_no: string | null; assigned_agent_id: string | null; priority_raw: string | null; workflow: string | null };
type DeskPage = { rows: DeskRow[]; next_cursor: string | null; has_more: boolean };
const identity = (value: unknown): string | null => typeof value === "string" ? value : value && typeof value === "object" ? String((value as Record<string, unknown>)._id ?? (value as Record<string, unknown>).id ?? "") || null : null;

async function main() {
  if (!process.argv.includes("--run")) throw new Error("Explicit --run required.");
  const leads: LeadFact[] = [];
  for (const [resource, model] of [["form-leads", "FormLead"], ["call-leads", "CallLead"]]) {
    const ids = new Set<string>(), totals = new Set<number>();
    for (let page = 1; page <= 100; page++) {
      const data = await ownerApi<{ items: Array<Record<string, unknown>>; total: number; has_next_page: boolean }>("GET", `/api/v1/admin/${resource}`, undefined, { database_scope: "production", limit: "250", page: String(page), sort: "createdAt", direction: "asc" });
      totals.add(data.total);
      for (const row of data.items) {
        const id = String(row._id ?? row.id); if (ids.has(id)) throw new Error("Repeated browse identity; retry inventory."); ids.add(id);
        leads.push({ id, model: model!, job: typeof row.job_no === "string" ? normalizeJobNo(row.job_no) || null : null, priority: typeof row.granot_priority === "string" ? row.granot_priority : null,
          receiver: identity(row.receiver_agent), receiver_source: typeof row.receiver_agent_source === "string" ? row.receiver_agent_source : null,
          quoted: row.quoted === true, cubic_feet: typeof row.cubic_feet === "number" ? row.cubic_feet : null,
          closed: !!(row.booked || row.cancelled || row.bad_lead || row.created_on_unmatched), revision: Number(row.domain_revision ?? 0),
          accepted_at: row.last_accepted_granot_observation && typeof row.last_accepted_granot_observation === "object" ? String((row.last_accepted_granot_observation as Record<string, unknown>).captured_at ?? "") || null : null });
      }
      if (!data.has_next_page) break;
      if (page === 100) throw new Error("Lead page budget exhausted.");
    }
    if (totals.size !== 1 || !totals.has(ids.size)) throw new Error("Browse totals shifted; retry inventory.");
  }
  const team = await ownerApi<{ daily_call_goals: Array<{ agent_id: string; agent_name: string; goal: number | null; goal_state: string }>; roster: unknown }>("GET", "/api/v1/admin/sales-outreach/team");
  const configuration = await ownerApi<{ revision: number; value: { cadence: { priority_map: { codes: Array<{ code: string; workflow: string }> } } } }>("GET", "/api/v1/admin/sales-outreach/configuration");
  const workflows = new Map(configuration.value.cadence.priority_map.codes.map((row) => [row.code, row.workflow]));
  const deskAgents = new Set(team.daily_call_goals.map((row) => row.agent_id));
  const byJob = new Map<string, LeadFact[]>();
  for (const lead of leads) if (lead.job) { const group = byJob.get(lead.job) ?? []; group.push(lead); byJob.set(lead.job, group); }
  const queue: DeskRow[] = [];
  let cursor: string | null = null;
  const subjects = new Set<string>();
  for (let page = 0; page < 100; page++) {
    const data: DeskPage = await ownerApi<DeskPage>("GET", "/api/v1/admin/sales-outreach/queue", undefined, { state: "all_active", sort: "lead_received", direction: "asc", limit: "100", ...(cursor ? { cursor } : {}) });
    for (const row of data.rows) { if (subjects.has(row.subject_id)) throw new Error("Desk traversal repeated an identity."); subjects.add(row.subject_id); queue.push(row); }
    if (!data.has_more) break;
    if (!data.next_cursor || data.next_cursor === cursor) throw new Error("Desk cursor did not advance.");
    cursor = data.next_cursor;
    if (page === 99) throw new Error("Desk page budget exhausted.");
  }
  let comparable = 0, ambiguous = 0, noJob = 0;
  const assignmentMismatches: string[] = [], priorityMismatches: string[] = [], workflowMismatches: string[] = [];
  for (const row of queue) {
    if (!row.job_no) { noJob++; continue; }
    const job = normalizeJobNo(row.job_no);
    if (!job) { noJob++; continue; }
    const candidates = byJob.get(job) ?? [];
    if (candidates.length !== 1) { ambiguous++; continue; }
    const lead = candidates[0]!; comparable++;
    if (lead.receiver && deskAgents.has(lead.receiver) && row.assigned_agent_id !== lead.receiver) assignmentMismatches.push(row.subject_id);
    if (lead.accepted_at && lead.priority && row.priority_raw !== lead.priority) priorityMismatches.push(row.subject_id);
    if (lead.accepted_at && lead.priority && workflows.has(lead.priority) && row.workflow !== workflows.get(lead.priority)) workflowMismatches.push(row.subject_id);
  }
  const josh = team.daily_call_goals.find((row) => row.agent_name.toLowerCase() === "josh");
  const joshLeads = leads.filter((lead) => lead.receiver === josh?.agent_id);
  const summary = { at: new Date().toISOString(), configuration_revision: configuration.revision, lead_count: leads.length, with_job: leads.filter((l) => l.job).length, assigned: leads.filter((l) => l.receiver).length,
    quoted: leads.filter((l) => l.quoted).length, with_cubic_feet: leads.filter((l) => l.cubic_feet !== null).length,
    queue_rows: queue.length, comparable_rows: comparable, ambiguous_job_rows: ambiguous, job_pending_rows: noJob,
    assignment_mismatches: assignmentMismatches.length, priority_mismatches: priorityMismatches.length, workflow_mismatches: workflowMismatches.length,
    josh: josh ? { goal: josh.goal, goal_state: josh.goal_state, assigned_leads: joshLeads.length, active_desk_rows: queue.filter((r) => r.assigned_agent_id === josh.agent_id).length, quoted_leads: joshLeads.filter((l) => l.quoted).length } : null,
    atomic_snapshot: false, domain_mutations: 0 };
  const filename = process.argv.find((v) => v.startsWith("--out="))?.slice(6);
  if (filename) {
    const path = resolve(filename), rel = relative(resolve(__dirname, "../.."), path);
    if (!rel || (!rel.startsWith("..") && !isAbsolute(rel))) throw new Error("Private evidence must be outside the checkout.");
    await writeFile(path, JSON.stringify({ summary, leads, queue: queue.map(({ subject_id, assigned_agent_id, priority_raw, workflow }) => ({ subject_id, assigned_agent_id, priority_raw, workflow })), mismatches: { assignmentMismatches, priorityMismatches, workflowMismatches } }, null, 2), { mode: 0o600 });
  }
  console.log(JSON.stringify(summary));
}

main().catch((error: unknown) => { const message = error instanceof Error ? error.message : ""; console.error(JSON.stringify({ ok: false, reason: /^(API HTTP|Explicit|Repeated|Browse|Lead page|Desk |Private)/.test(message) ? message : "Convergence inventory failed; no writes performed." })); process.exitCode = 1; });
