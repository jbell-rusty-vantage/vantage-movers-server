import type { ClientSession } from "mongoose";
import type { SalesOutreachLeadModel } from "../../../config/domain/salesOutreach";
import type { CsiActor } from "../../salesIntelligence/auth";
import type { appendCsiAudit, executeCsiCommand } from "../../salesIntelligence/transactions";
import { deskLeadKey, type DeskLeadFacts } from "../subjects/leadFacts";
import { fakeSession, objectId, type MemoryDeskSubjectStore } from "../subjects/testing";
import { ADMISSION_OUTCOMES, type AdmissionGroup, type AdmissionsStore } from "./admissions";
import type { EnrollmentDeps } from "./service";
import type { EnrollmentLease, EnrollmentRunRow, EnrollmentSkip, EnrollmentStore, LeadScanFilter, NewEnrollmentRun } from "./store";

/** Unit-test stand-ins for enrollment (no Mongo): runs, the command ledger and audit kept in memory. */
export class MemoryEnrollmentStore implements EnrollmentStore {
  runs: Array<EnrollmentRunRow & { actor: CsiActor }> = [];
  writes: string[] = [];
  /** Every `scanLeads` call (model, prefilter, rows returned), so tests can assert what a listing examined. */
  scans: Array<{ model: SalesOutreachLeadModel; filter: LeadScanFilter | null; returned: number }> = [];
  constructor(private readonly subjects: MemoryDeskSubjectStore) {}

  snapshot() {
    const saved = structuredClone({ runs: this.runs, writes: this.writes });
    return () => Object.assign(this, saved);
  }
  async scanLeads(model: SalesOutreachLeadModel, page: Readonly<{ after_id: string | null; limit: number; direction: 1 | -1; filter: LeadScanFilter | null }>) {
    const f = page.filter;
    const rows = [...this.subjects.leads.values()]
      .filter((lead) => lead.ref.model === model)
      .filter((lead) => !page.after_id || (page.direction === 1 ? lead.ref.id > page.after_id : lead.ref.id < page.after_id))
      .filter((lead) => !f?.timestamp_before || (lead.timestamp !== null && +lead.timestamp < +f.timestamp_before))
      .filter((lead) => !f?.id_from || lead.ref.id.toLowerCase() >= f.id_from.toLowerCase())
      .filter((lead) => !f?.id_before || lead.ref.id.toLowerCase() < f.id_before.toLowerCase())
      .filter((lead) => {
        if (!f?.timestamp_from && !f?.move_date_from) return true;
        const byTime = f.timestamp_from && lead.timestamp !== null && +lead.timestamp >= +f.timestamp_from;
        const byMove = f.move_date_from && model === "FormLead" && lead.move_date !== null && lead.move_date >= f.move_date_from.toISOString().slice(0, 10);
        return Boolean(byTime || byMove);
      })
      .sort((a, b) => (page.direction === 1 ? a.ref.id.localeCompare(b.ref.id) : b.ref.id.localeCompare(a.ref.id)));
    this.scans.push({ model, filter: f ? { ...f } : null, returned: Math.min(rows.length, page.limit) });
    return rows.slice(0, page.limit) as DeskLeadFacts[];
  }
  async findRun(runKey: string) {
    const run = this.runs.find((r) => r.run_key === runKey);
    return run ? structuredClone(run) : null;
  }
  async insertRun(run: NewEnrollmentRun) {
    if (this.runs.some((r) => r.run_key === run.run_key)) throw Object.assign(new Error("E11000"), { code: 11000 });
    this.runs.push({ ...structuredClone({ ...run, actor: { ...run.actor } }), lease_owner: null, lease_epoch: 0, leased_until: null, finished_at: null });
    this.writes.push(`insertRun:${run.run_key}`);
  }
  async acquireRunLease(runKey: string, owner: string, now: Date, ttlMs: number) {
    const run = this.runs.find((r) => r.run_key === runKey && r.mode === "apply" && (r.status === "running" || r.status === "paused"));
    if (!run || (run.leased_until && +run.leased_until > +now)) return null;
    Object.assign(run, { lease_owner: owner, leased_until: new Date(+now + ttlMs), lease_epoch: run.lease_epoch + 1, status: "running" });
    return structuredClone(run);
  }
  async checkpointRun(lease: EnrollmentLease, batch: Readonly<{ advance: number; counts: Record<string, number>; skipped: readonly EnrollmentSkip[]; now: Date; ttl_ms: number }>) {
    const run = this.runs.find((r) => r.run_key === lease.run_key && r.lease_owner === lease.owner && r.lease_epoch === lease.epoch && r.leased_until && +r.leased_until > +batch.now);
    if (!run) return false;
    const counts = { ...run.counts };
    for (const [key, value] of Object.entries(batch.counts)) counts[key] = (counts[key] ?? 0) + value;
    Object.assign(run, {
      next_index: run.next_index + batch.advance,
      last_committed_batch: run.last_committed_batch + 1,
      counts,
      results: { ...run.results, skipped: [...run.results.skipped, ...batch.skipped] },
      leased_until: new Date(+batch.now + batch.ttl_ms),
    });
    this.writes.push(`checkpoint:${lease.run_key}`);
    return true;
  }
  async releaseRun(lease: EnrollmentLease, status: EnrollmentRunRow["status"], now: Date, pauseReason: string | null = null) {
    const run = this.runs.find((r) => r.run_key === lease.run_key && r.lease_owner === lease.owner && r.lease_epoch === lease.epoch);
    if (!run) return;
    Object.assign(run, { status, lease_owner: null, leased_until: null, results: { ...run.results, pause_reason: pauseReason }, ...(status === "completed" ? { finished_at: now } : {}) });
  }
  async saveVerifyRun(apply: EnrollmentRunRow, results: Readonly<{ counts: Record<string, number>; verify: unknown }>, actor: CsiActor, now: Date) {
    const key = `verify:${apply.run_key}`;
    this.runs = this.runs.filter((r) => r.run_key !== key);
    this.runs.push({ ...structuredClone(apply), run_key: key, mode: "verify", selected_leads: [], counts: results.counts, results: { skipped: [], pause_reason: null, verify: results.verify }, finished_at: now, status: "completed", actor });
    this.writes.push(`verify:${apply.run_key}`);
  }
  async cohortSubjects(cohortId: string, afterId: string | null, limit: number) {
    const rows = this.subjects.subjects
      .filter((s) => s.enrollment.cohort_id === cohortId && (!afterId || s.id > afterId))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit);
    const out = [];
    for (const subject of rows) out.push({ subject: structuredClone(subject), periods: await this.subjects.findPeriods(subject.id) });
    return out;
  }
}

/** Deps wiring memory stores, a rolling-back transaction, a recording ledger/audit and a controllable clock. */
export function memoryEnrollmentDeps(subjects: MemoryDeskSubjectStore, store: MemoryEnrollmentStore, overrides: Partial<EnrollmentDeps> = {}) {
  const ledger = new Map<string, { hash: string; response: unknown }>();
  const audits: Array<Parameters<typeof appendCsiAudit>[1]> = [];
  let clock = new Date("2026-10-05T12:00:00.000Z");
  const run = (async (input: Parameters<typeof executeCsiCommand>[0]) => {
    const key = `${input.actor.kind}:${input.actor.id}:${input.idempotency_key}`;
    const hash = JSON.stringify({ command: input.command, payload: input.payload });
    const prior = ledger.get(key);
    if (prior) {
      if (prior.hash !== hash) throw Object.assign(new Error("IDEMPOTENCY_CONFLICT"), { code: "IDEMPOTENCY_CONFLICT" });
      return { response: prior.response, replayed: true };
    }
    const response = await input.operation({ session: fakeSession, command_id: objectId() as never, now: clock, actor: input.actor });
    ledger.set(key, { hash, response });
    return { response, replayed: false };
  }) as typeof executeCsiCommand;
  const deps: EnrollmentDeps = {
    subjects,
    store,
    run,
    audit: (async (_context: unknown, event: Parameters<typeof appendCsiAudit>[1]) => {
      audits.push(event);
    }) as typeof appendCsiAudit,
    transaction: async <T>(fn: (session: ClientSession) => Promise<T>) => {
      const restoreSubjects = subjects.snapshot();
      const restoreRuns = store.snapshot();
      try {
        return await fn(fakeSession);
      } catch (error) {
        restoreSubjects();
        restoreRuns();
        throw error;
      }
    },
    now: () => clock,
    sleep: async () => undefined,
    ...overrides,
  };
  return {
    deps,
    ledger,
    audits,
    setClock: (iso: string) => {
      clock = new Date(iso);
    },
  };
}

export const leadKeys = (leads: readonly DeskLeadFacts[]) => leads.map((l) => deskLeadKey(l.ref)).sort();

/** One `sales_intelligence_jobs` row as the olr B8 admissions read sees it (synthetic ledger stand-in). */
export type MemoryJobRow = {
  _id: string;
  stage: string;
  status: string;
  completed_at: Date | null;
  subject_key: string;
  input_refs: string[];
  result: unknown;
};

/**
 * In-memory job ledger for `GET /enrollment/admissions` (olr B8): the same filter, grouping and
 * newest-first refusal list as `mongoAdmissionsStore`'s aggregation.
 */
export class MemoryAdmissionsStore implements AdmissionsStore {
  rows: MemoryJobRow[] = [];
  /** Adds a completed `outreach_lead_change` job for a Lead with the given stored result. */
  complete(lead: { model: string; id: string }, completedAt: string, result: Record<string, unknown> | null, overrides: Partial<MemoryJobRow> = {}) {
    this.rows.push({
      _id: objectId(),
      stage: "outreach_lead_change",
      status: "completed",
      completed_at: new Date(completedAt),
      subject_key: `outreach-lead:${lead.model}:${lead.id}`,
      input_refs: [lead.id],
      result,
      ...overrides,
    });
    return this;
  }
  async leadChangeResults(window: Readonly<{ from: Date; to: Date }>, recentLimit: number) {
    const field = (row: MemoryJobRow, key: string) => {
      const value = (row.result as Record<string, unknown> | null)?.[key];
      return typeof value === "string" ? value : null;
    };
    const rows = this.rows.filter(
      (row) =>
        row.stage === "outreach_lead_change" &&
        row.status === "completed" &&
        row.completed_at !== null &&
        +row.completed_at >= +window.from &&
        +row.completed_at < +window.to &&
        (ADMISSION_OUTCOMES as readonly string[]).includes(field(row, "outcome") ?? ""),
    );
    const groups = new Map<string, AdmissionGroup>();
    for (const row of rows) {
      const group = { outcome: field(row, "outcome")!, reason: field(row, "reason"), status: field(row, "status"), admission: field(row, "admission") };
      const key = JSON.stringify(group);
      groups.set(key, { ...group, count: (groups.get(key)?.count ?? 0) + 1 });
    }
    const recent = rows
      .filter((row) => field(row, "outcome") === "not_admitted")
      .sort((a, b) => +b.completed_at! - +a.completed_at! || (a._id < b._id ? 1 : -1))
      .slice(0, recentLimit)
      .map((row) => ({ subject_key: row.subject_key, input_refs: row.input_refs, reason: field(row, "reason"), completed_at: row.completed_at! }));
    return { groups: [...groups.values()], recent };
  }
}
