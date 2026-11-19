import assert from "node:assert/strict";
import { afterEach, before, mock, test } from "node:test";
import mongoose from "mongoose";
import {
  cplCorrectionWindowToStoredLeadRange,
  configureCplCorrectionAnalyticsInvalidation,
  createCplCorrection,
  normalizeCplCorrectionSelection,
  previewCplCorrection,
  processCplCorrectionBatch,
  type CplCorrectionAnalyticsInvalidationRequest,
  type CplCorrectionDependencies,
  type CplCorrectionGranularityStore,
  type CplCorrectionJobRecord,
  type CplCorrectionJobStore,
  type CplCorrectionLeadRef,
  type CplCorrectionLeadStore,
  type CplCorrectionResolver,
  type NormalizedCplCorrectionSelection,
} from "./cplCorrections";
import type { CplResolution } from "./cplSchedule";
import type { RegistryActorContext } from "./types";
import { logger } from "../../logger";

const GRANULARITY_ID = "507f1f77bcf86cd799439011";
const WINDOW_FROM = new Date("2026-01-01T05:00:00.000Z");
const WINDOW_UNTIL = new Date("2026-02-01T05:00:00.000Z");

const ACTOR: RegistryActorContext = {
  actorType: "owner",
  actorId: "admin_123",
  actorLabel: "owner@example.test",
  actorRole: "owner",
  requestId: "req_correction_1",
};

type MemoryState = {
  revision: number;
  jobs: Map<string, CplCorrectionJobRecord>;
  leads: CplCorrectionLeadRef[];
  analyticsCalls: CplCorrectionAnalyticsInvalidationRequest[];
  auditCommitted: boolean;
  failLeadIds: Set<string>;
  now: Date;
};

function leadId(model: "FormLead" | "CallLead", suffix: string): string {
  const prefix = model === "FormLead" ? "611" : "622";
  return `${prefix}${suffix}`.padEnd(24, "0");
}

function sampleLead(
  model: "FormLead" | "CallLead",
  suffix: string,
  overrides: Partial<CplCorrectionLeadRef> = {},
): CplCorrectionLeadRef {
  return {
    lead_model: model,
    lead_id: leadId(model, suffix),
    source_granularity_id: GRANULARITY_ID,
    timestamp: new Date("2026-01-15T12:00:00.000Z"),
    cpl: 100,
    cpl_resolution_status: "resolved",
    cpl_rate_period: "707f1f77bcf86cd799439099",
    ...overrides,
  };
}

function fixedResolver(amount: number): CplCorrectionResolver {
  return async () =>
    ({
      status: "resolved",
      amount,
      amount_cents: amount * 100,
      period_id: "808f1f77bcf86cd799439088",
    }) satisfies CplResolution;
}

function createMemoryHarness(
  overrides: Partial<MemoryState> & {
    revision?: number;
    leads?: CplCorrectionLeadRef[];
    resolver?: CplCorrectionResolver;
    batchSize?: number;
    leaseMs?: number;
    previewSampleLimit?: number;
  } = {},
): { deps: CplCorrectionDependencies; state: MemoryState } {
  const state: MemoryState = {
    revision: overrides.revision ?? 4,
    jobs: new Map(),
    leads: overrides.leads ?? [
      sampleLead("FormLead", "01"),
      sampleLead("FormLead", "02", { cpl: 150 }),
      sampleLead("CallLead", "01", { cpl: 90 }),
    ],
    analyticsCalls: [],
    auditCommitted: false,
    failLeadIds: new Set(),
    now: overrides.now ?? new Date("2026-07-29T12:00:00.000Z"),
  };

  const granularityStore: CplCorrectionGranularityStore = {
    async getScheduleRevision() {
      return state.revision;
    },
  };

  const leadStore: CplCorrectionLeadStore = {
    async countMatching(selection) {
      const matched = filterLeads(state.leads, selection);
      return {
        total: matched.length,
        form_lead_count: matched.filter((lead) => lead.lead_model === "FormLead").length,
        call_lead_count: matched.filter((lead) => lead.lead_model === "CallLead").length,
      };
    },
    async listSample(selection, limit) {
      return filterLeads(state.leads, selection)
        .sort(compareLeads)
        .slice(0, limit);
    },
    async listBatch(selection, cursor, limit) {
      const ordered = filterLeads(state.leads, selection).sort(compareLeads);
      const startIndex = cursor
        ? ordered.findIndex(
            (lead) =>
              lead.lead_model === cursor.lead_model && lead.lead_id === cursor.lead_id,
          ) + 1
        : 0;
      return ordered.slice(startIndex, startIndex + limit);
    },
    async updateLeadCorrection(ref, update) {
      if (state.failLeadIds.has(ref.lead_id)) {
        throw new Error(`Simulated failure for ${ref.lead_id}`);
      }
      const index = state.leads.findIndex(
        (lead) => lead.lead_model === ref.lead_model && lead.lead_id === ref.lead_id,
      );
      if (index < 0) return false;
      state.leads[index] = {
        ...state.leads[index]!,
        cpl: update.cpl,
        cpl_rate_period: update.cpl_rate_period,
        cpl_resolution_status: update.cpl_resolution_status,
        cpl_correction: {
          job_id: update.job_id,
          corrected_at: update.corrected_at,
          previous_cpl: update.previous_cpl,
        },
      };
      return true;
    },
  };

  const jobStore: CplCorrectionJobStore = {
    async create(input) {
      const id = new mongoose.Types.ObjectId().toString();
      const job: CplCorrectionJobRecord = {
        id,
        request_id: input.actor.requestId,
        source_granularity_id: input.selection.source_granularity_id,
        window_from: input.selection.window_from,
        window_until: input.selection.window_until,
        target_schedule_revision: input.selection.target_schedule_revision,
        max_form_lead_id: input.selection.max_form_lead_id ?? null,
        max_call_lead_id: input.selection.max_call_lead_id ?? null,
        reviewed_targets: input.reviewed_targets.map((target) => ({
          ...target,
        })),
        preview_hash: input.preview_hash,
        status: "pending",
        reason: input.reason,
        matched_count: input.matched_count,
        changed_count: 0,
        no_op_count: 0,
        failed_count: 0,
        created_at: state.now,
        updated_at: state.now,
      };
      state.jobs.set(id, job);
      return job;
    },
    async findById(id) {
      return state.jobs.get(id) ?? null;
    },
    async claimForProcessing(id, owner, leaseUntil, now) {
      const job = state.jobs.get(id);
      if (!job) return null;
      if (!["pending", "processing"].includes(job.status)) return null;
      if (job.leased_until && job.leased_until > now) return null;
      job.status = "processing";
      job.lease_owner = owner;
      job.leased_until = leaseUntil;
      job.started_at = now;
      job.updated_at = now;
      return { ...job };
    },
    async renewLease(id, owner, leaseUntil, now) {
      const job = state.jobs.get(id);
      if (!job || job.lease_owner !== owner || !job.leased_until || job.leased_until <= now) {
        return false;
      }
      job.leased_until = leaseUntil;
      return true;
    },
    async releaseLease(id, owner) {
      const job = state.jobs.get(id);
      if (!job || job.lease_owner !== owner) return;
      delete job.leased_until;
      delete job.lease_owner;
    },
    async updateProgress(id, owner, update) {
      const job = state.jobs.get(id);
      if (
        !job ||
        job.status !== "processing" ||
        job.lease_owner !== owner
      ) {
        return null;
      }
      job.changed_count = update.changed_count;
      job.no_op_count = update.no_op_count;
      job.failed_count = update.failed_count;
      if (update.cursor === null) delete job.cursor;
      else if (update.cursor) job.cursor = update.cursor;
      if (update.last_error !== undefined) {
        if (update.last_error) job.last_error = update.last_error;
        else delete job.last_error;
      }
      if (update.status) job.status = update.status;
      if (update.completed_at) job.completed_at = update.completed_at;
      job.updated_at = state.now;
      return { ...job };
    },
    async cancel(id, now) {
      const job = state.jobs.get(id);
      if (!job) return null;
      if (!["pending", "processing"].includes(job.status)) return null;
      job.status = "cancelled";
      job.completed_at = now;
      delete job.leased_until;
      delete job.lease_owner;
      return { ...job };
    },
    async findClaimable(now, limit) {
      return [...state.jobs.values()]
        .filter(
          (job) =>
            ["pending", "processing"].includes(job.status) &&
            (!job.leased_until || job.leased_until <= now),
        )
        .slice(0, limit);
    },
  };

  const deps: CplCorrectionDependencies = {
    jobStore,
    leadStore,
    granularityStore,
    resolveTargetCpl: overrides.resolver ?? fixedResolver(195),
    invalidateAnalytics: async (request) => {
      state.analyticsCalls.push(request);
    },
    now: () => state.now,
    batchSize: overrides.batchSize ?? 2,
    leaseMs: overrides.leaseMs ?? 60_000,
    previewSampleLimit: overrides.previewSampleLimit,
    workerOwner: () => "worker-test",
    runMutation: async (fn) => {
      state.auditCommitted = true;
      return fn({} as never);
    },
    registryAudit: {
      insertAudit: async () => {},
    },
  };

  return { deps, state };
}

function filterLeads(
  leads: CplCorrectionLeadRef[],
  selection: NormalizedCplCorrectionSelection,
): CplCorrectionLeadRef[] {
  if (selection.reviewed_targets) {
    const reviewed = new Set(
      selection.reviewed_targets.map(
        (target) => `${target.lead_model}:${target.lead_id}`,
      ),
    );
    return leads.filter((lead) =>
      reviewed.has(`${lead.lead_model}:${lead.lead_id}`),
    );
  }
  return leads.filter(
    (lead) =>
      lead.timestamp >= selection.window_from &&
      lead.timestamp < selection.window_until &&
      (lead.lead_model === "FormLead"
        ? selection.max_form_lead_id === undefined ||
          (selection.max_form_lead_id !== null &&
            lead.lead_id <= selection.max_form_lead_id)
        : selection.max_call_lead_id === undefined ||
          (selection.max_call_lead_id !== null &&
            lead.lead_id <= selection.max_call_lead_id)),
  );
}

function compareLeads(left: CplCorrectionLeadRef, right: CplCorrectionLeadRef): number {
  const modelOrder = left.lead_model.localeCompare(right.lead_model);
  if (modelOrder !== 0) return modelOrder;
  return left.lead_id.localeCompare(right.lead_id);
}

function baseSelection() {
  return {
    source_granularity_id: GRANULARITY_ID,
    window: {
      kind: "instant" as const,
      window_from: WINDOW_FROM,
      window_until: WINDOW_UNTIL,
    },
    target_schedule_revision: 4,
  };
}

const loggedKeys: string[] = [];

before(() => {
  for (const level of ["info", "warn", "error"] as const) {
    mock.method(logger, level, (entry: unknown) => {
      const key = (entry as { msg?: unknown } | null)?.msg;
      if (typeof key === "string") loggedKeys.push(key);
    });
  }
});

afterEach(() => {
  configureCplCorrectionAnalyticsInvalidation(async () => {});
  loggedKeys.length = 0;
});

test("preview hashes full Lead state and reports full counts beyond its sample", async () => {
  const { deps, state } = createMemoryHarness({ previewSampleLimit: 1 });
  const first = await previewCplCorrection(baseSelection(), deps);
  assert.equal(first.impact.sample.length, 1);
  assert.equal(first.impact.matched_count, 3);
  assert.equal(first.impact.would_change_count, 3);
  assert.equal(first.impact.would_no_op_count, 0);

  state.leads[2]!.cpl = 91;
  const second = await previewCplCorrection(baseSelection(), deps);
  assert.equal(second.impact.matched_count, first.impact.matched_count);
  assert.notEqual(second.preview_hash, first.preview_hash);
});

test("Form duplicate flags do not invoke Call duplicate-zero CPL semantics", async () => {
  const form = sampleLead("FormLead", "01", { duplicate: true });
  const { deps } = createMemoryHarness({
    leads: [form],
    resolver: async (input) =>
      input.duplicate
        ? {
            status: "duplicate_zero",
            amount: 0,
            amount_cents: 0,
            base_period_id: "808f1f77bcf86cd799439088",
          }
        : {
            status: "resolved",
            amount: 195,
            amount_cents: 19500,
            period_id: "808f1f77bcf86cd799439088",
          },
  });
  const preview = await previewCplCorrection(baseSelection(), deps);
  assert.equal(preview.impact.sample[0]?.target_resolution_status, "resolved");
  assert.equal(preview.impact.sample[0]?.target_cpl, 195);
});

test("createCplCorrection rejects stale preview hash", async () => {
  const { deps, state } = createMemoryHarness();
  await assert.rejects(
    () =>
      createCplCorrection(
        {
          ...baseSelection(),
          preview_hash: "deadbeef",
          confirm: true,
        },
        ACTOR,
        deps,
      ),
    (error: unknown) =>
      error instanceof Error &&
      "registryCode" in error &&
      error.registryCode === "CPL_PREVIEW_STALE",
  );
  assert.equal(state.jobs.size, 0);
});

test("correction jobs exclude Leads inserted after the reviewed preview", async () => {
  const { deps, state } = createMemoryHarness({ batchSize: 10 });
  const preview = await previewCplCorrection(baseSelection(), deps);
  const created = await createCplCorrection(
    {
      ...baseSelection(),
      preview_hash: preview.preview_hash,
      confirm: true,
    },
    ACTOR,
    deps,
  );
  const lateLead = sampleLead("FormLead", "99");
  state.leads.push(lateLead);

  const result = await processCplCorrectionBatch(created.id, deps);
  assert.equal(result.changed, 3);
  assert.equal(
    state.leads.find((lead) => lead.lead_id === lateLead.lead_id)
      ?.cpl_correction,
    undefined,
  );
});

test("correction jobs fail visibly when reviewed Lead state changes", async () => {
  const { deps, state } = createMemoryHarness({ batchSize: 10 });
  const preview = await previewCplCorrection(baseSelection(), deps);
  const created = await createCplCorrection(
    {
      ...baseSelection(),
      preview_hash: preview.preview_hash,
      confirm: true,
    },
    ACTOR,
    deps,
  );
  const changedAfterReview = state.leads.find(
    (lead) => lead.lead_model === "CallLead",
  )!;
  changedAfterReview.cpl = 91;

  const result = await processCplCorrectionBatch(created.id, deps);
  assert.equal(result.failed, 1);
  assert.equal(result.changed, 0);
  assert.equal(
    (await deps.jobStore.findById(created.id))?.status,
    "failed",
  );
  assert.equal(changedAfterReview.cpl_correction, undefined);
});

test("overlapping workers do not double-correct the same lead", async () => {
  const { deps, state } = createMemoryHarness({ batchSize: 10 });
  const preview = await previewCplCorrection(baseSelection(), deps);
  const created = await createCplCorrection(
    {
      ...baseSelection(),
      preview_hash: preview.preview_hash,
      confirm: true,
    },
    ACTOR,
    deps,
  );

  const job = state.jobs.get(created.id)!;
  job.leased_until = new Date(state.now.getTime() + 60_000);
  job.lease_owner = "other-worker";

  const blocked = await processCplCorrectionBatch(created.id, deps);
  assert.equal(blocked.claimed, false);
  assert.equal(blocked.processed, 0);

  delete job.leased_until;
  delete job.lease_owner;
  const allowed = await processCplCorrectionBatch(created.id, deps);
  assert.equal(allowed.claimed, true);
  assert.equal(allowed.changed, 3);
});

test("partial failure records failed count and resumes remaining leads", async () => {
  const { deps, state } = createMemoryHarness({ batchSize: 3 });
  state.failLeadIds.add(leadId("FormLead", "02"));
  const preview = await previewCplCorrection(baseSelection(), deps);
  const created = await createCplCorrection(
    {
      ...baseSelection(),
      preview_hash: preview.preview_hash,
      confirm: true,
    },
    ACTOR,
    deps,
  );

  const first = await processCplCorrectionBatch(created.id, deps);
  assert.equal(first.failed, 1);
  assert.equal(first.changed, 2);
  assert.equal(first.completed, false);

  let job = await deps.jobStore.findById(created.id);
  assert.equal(job?.failed_count, 1);
  assert.ok(job?.last_error);
  state.failLeadIds.clear();
  const resumed = await processCplCorrectionBatch(created.id, deps);
  assert.equal(resumed.changed, 1);
  assert.equal(resumed.completed, true);
  job = await deps.jobStore.findById(created.id);
  assert.equal(job?.changed_count, 3);
  assert.equal(job?.failed_count, 1);
  assert.ok(
    loggedKeys.includes("cpl_correction.lead_failed"),
  );
});

test("correction windows query pseudo-UTC Lead timestamps across DST", () => {
  const normalized = normalizeCplCorrectionSelection({
    source_granularity_id: GRANULARITY_ID,
    target_schedule_revision: 2,
    window: {
      kind: "business_date",
      window_from_date: "2026-03-08",
      window_until_date: "2026-03-08",
    },
  });
  assert.deepEqual(cplCorrectionWindowToStoredLeadRange(normalized), {
    from: new Date("2026-03-08T00:00:00.000Z"),
    until: new Date("2026-03-09T00:00:00.000Z"),
  });
});
