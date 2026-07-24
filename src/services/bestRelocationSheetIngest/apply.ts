import {
  DEFAULT_PRODUCTION_BASE_URL,
} from "./plan";
import type { IngestPlan, PlannedMutation } from "./types";

export type ApplyResult = {
  idempotency_key: string;
  status: "created" | "existing";
  entity_id?: string;
  http_status: number;
};

export async function applyIngestPlan(
  plan: IngestPlan,
  options: {
    apiSecret?: string;
    fetchImpl?: typeof fetch;
    confirmProductionApply: boolean;
    initialResults?: ApplyResult[];
    onProgress?: (results: ApplyResult[]) => void | Promise<void>;
  },
): Promise<ApplyResult[]> {
  if (!options.confirmProductionApply) {
    throw new Error("Live apply requires confirmProductionApply=true");
  }
  const apiSecret = options.apiSecret?.trim() ?? process.env.VANTAGE_API_SECRET?.trim();
  if (!apiSecret) throw new Error("Missing VANTAGE_API_SECRET for live apply");
  assertPinnedProductionUrl(plan.base_url);
  assertSupportedPlan(plan);
  const fetchImpl = options.fetchImpl ?? fetch;
  const results: ApplyResult[] = [...(options.initialResults ?? [])];
  const completedKeys = new Set(results.map((result) => result.idempotency_key));
  const resolvedIds = new Map(
    results
      .filter(
        (result): result is ApplyResult & { entity_id: string } =>
          typeof result.entity_id === "string",
      )
      .map((result) => [result.idempotency_key, result.entity_id]),
  );

  for (const mutation of plan.mutations) {
    if (completedKeys.has(mutation.idempotency_key)) continue;
    const existing = await findExistingEntity(
      plan.base_url,
      mutation,
      apiSecret,
      fetchImpl,
      resolvedIds,
    );
    if (existing) {
      resolvedIds.set(mutation.idempotency_key, existing);
      results.push({
        idempotency_key: mutation.idempotency_key,
        status: "existing",
        entity_id: existing,
        http_status: 200,
      });
      await options.onProgress?.([...results]);
      continue;
    }

    const body = resolveBindings(mutation, resolvedIds);
    const response = await fetchImpl(`${plan.base_url}${mutation.api.path}`, {
      method: "POST",
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-secret": apiSecret,
      },
      body: JSON.stringify(body),
    });
    const envelope = await responseJson(response);
    if (!response.ok) {
      throw new Error(
        `Apply failed for ${mutation.idempotency_key}: ${response.status} ${JSON.stringify(envelope)}`,
      );
    }
    const entityId = extractEntityId(envelope);
    if (
      !entityId &&
      (mutation.action === "create_form_lead" ||
        mutation.action === "create_booked_from_source" ||
        mutation.action === "create_leadless_booking")
    ) {
      throw new Error(
        `API response for ${mutation.idempotency_key} did not contain an entity ID`,
      );
    }
    if (entityId) resolvedIds.set(mutation.idempotency_key, entityId);
    results.push({
      idempotency_key: mutation.idempotency_key,
      status: "created",
      entity_id: entityId,
      http_status: response.status,
    });
    await options.onProgress?.([...results]);
  }
  return results;
}

function resolveBindings(
  mutation: PlannedMutation,
  resolvedIds: Map<string, string>,
): Record<string, unknown> {
  const body = { ...mutation.api.body };
  for (const [field, dependency] of Object.entries(mutation.api.bindings ?? {})) {
    const id = resolvedIds.get(dependency);
    if (!id) {
      throw new Error(
        `Cannot apply ${mutation.idempotency_key}: dependency ${dependency} has no resolved ID`,
      );
    }
    body[field] = id;
  }
  return body;
}

async function findExistingEntity(
  baseUrl: string,
  mutation: PlannedMutation,
  apiSecret: string,
  fetchImpl: typeof fetch,
  resolvedIds: Map<string, string>,
): Promise<string | undefined> {
  if (mutation.action === "create_form_lead") {
    const refNo = stringField(mutation.api.body.ref_no);
    if (!refNo) return undefined;
    const data = await request(
      fetchImpl,
      `${baseUrl}/api/v1/form-leads/search`,
      apiSecret,
      { ref_no: refNo, include_duplicates: true, limit: 25 },
    );
    return objectId(record(data)?.lead);
  }
  if (mutation.action === "create_call_lead") {
    const phone = stringField(mutation.api.body.phone_number);
    const jobNo = stringField(mutation.api.body.job_no);
    const timestamp = stringField(mutation.api.body.timestamp);
    if (!phone && !jobNo) return undefined;
    const data = await request(
      fetchImpl,
      `${baseUrl}/api/v1/call-leads/search`,
      apiSecret,
      compact({ phone_number: phone, job_no: jobNo, limit: 25 }),
    );
    const payload = record(data);
    const candidates = Array.isArray(data)
      ? data
      : [
          ...(Array.isArray(payload?.matches) ? payload.matches : []),
          ...(payload?.lead ? [payload.lead] : []),
        ];
    const exact = candidates
      .map((candidate) => record(record(candidate)?.lead) ?? record(candidate))
      .find((candidate) => {
        if (!candidate) return false;
        if (jobNo && stringField(candidate.job_no) === jobNo) return true;
        return (
          phoneDigits(stringField(candidate.phone_number)) === phoneDigits(phone) &&
          timestamp &&
          sameInstant(stringField(candidate.timestamp), timestamp)
        );
      });
    return objectId(exact);
  }
  if (
    mutation.action === "create_booked_from_source" ||
    mutation.action === "create_leadless_booking"
  ) {
    const job = normalizeJob(
      stringField(mutation.api.body.job_no) ??
        stringField(mutation.api.body.call_job_no),
    );
    const data = await get(
      fetchImpl,
      `${baseUrl}/api/v1/admin/booked-leads?database_scope=production&job_no=${encodeURIComponent(job)}&limit=5`,
      apiSecret,
    );
    const existing = arrayData(data).find(
      (row) =>
        normalizeJob(stringField(record(row)?.normalized_job_no)) === job ||
        normalizeJob(stringField(record(row)?.job_no)) === job,
    );
    return objectId(existing);
  }
  if (mutation.action === "create_cancelled_lead") {
    const dependency = mutation.api.bindings?.booked_lead;
    const bookedId = dependency ? resolvedIds.get(dependency) : undefined;
    if (!bookedId) return undefined;
    const job = mutation.idempotency_key.split(":").at(-2) ?? "";
    const data = await get(
      fetchImpl,
      `${baseUrl}/api/v1/admin/cancelled-leads?database_scope=production&job_no=${encodeURIComponent(job)}&limit=5`,
      apiSecret,
    );
    return objectId(
      arrayData(data).find(
        (row) => objectId(record(row)?.booked_lead) === bookedId,
      ),
    );
  }
  return undefined;
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  apiSecret: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-secret": apiSecret,
    },
    body: JSON.stringify(body),
  });
  const envelope = await responseJson(response);
  if (!response.ok) {
    throw new Error(`Preflight request failed: ${response.status} ${JSON.stringify(envelope)}`);
  }
  return record(envelope)?.data;
}

async function get(
  fetchImpl: typeof fetch,
  url: string,
  apiSecret: string,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    redirect: "manual",
    headers: { Accept: "application/json", "x-api-secret": apiSecret },
  });
  const envelope = await responseJson(response);
  if (!response.ok) {
    throw new Error(`Preflight request failed: ${response.status} ${JSON.stringify(envelope)}`);
  }
  return record(envelope)?.data;
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractEntityId(envelope: unknown): string | undefined {
  const data = record(record(envelope)?.data);
  return (
    objectId(data?.lead) ??
    objectId(data?.booking) ??
    objectId(data?.cancellation) ??
    objectId(data)
  );
}

function arrayData(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const payload = record(value);
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function objectId(value: unknown): string | undefined {
  if (typeof value === "string" && /^[a-f\d]{24}$/i.test(value)) return value;
  const payload = record(value);
  const candidate = payload?._id ?? payload?.id;
  return typeof candidate === "string" && /^[a-f\d]{24}$/i.test(candidate)
    ? candidate
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeJob(value?: string): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function phoneDigits(value?: string): string {
  return (value ?? "").replace(/\D/g, "").slice(-10);
}

function sameInstant(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1000;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function assertPinnedProductionUrl(baseUrl: string): void {
  const actual = new URL(baseUrl);
  const expected = new URL(DEFAULT_PRODUCTION_BASE_URL);
  if (
    actual.protocol !== "https:" ||
    actual.username ||
    actual.password ||
    actual.origin !== expected.origin ||
    actual.pathname.replace(/\/+$/, "") !== ""
  ) {
    throw new Error(
      `Live apply is pinned to ${expected.origin}; refusing target ${actual.origin}`,
    );
  }
}

function assertSupportedPlan(plan: IngestPlan): void {
  const paths = {
    create_form_lead: "/api/v1/form-leads",
    create_call_lead: "/api/v1/call-leads",
    create_booked_from_source: "/api/v1/booked-leads/from-source",
    create_leadless_booking: "/api/v1/leadless-bookings",
    create_cancelled_lead: "/api/v1/cancelled-leads",
  } as const;
  if (plan.version !== 1 || plan.source_company !== "best_relocation_leads") {
    throw new Error("Live apply only accepts a version 1 Best Relocation plan");
  }
  const keys = new Set<string>();
  for (const mutation of plan.mutations) {
    if (
      mutation.api.method !== "POST" ||
      paths[mutation.action] !== mutation.api.path
    ) {
      throw new Error(
        `Unsupported mutation endpoint for ${mutation.idempotency_key}`,
      );
    }
    if (keys.has(mutation.idempotency_key)) {
      throw new Error(`Duplicate idempotency key ${mutation.idempotency_key}`);
    }
    for (const dependency of mutation.depends_on ?? []) {
      if (!keys.has(dependency)) {
        throw new Error(
          `Mutation ${mutation.idempotency_key} has an unresolved or out-of-order dependency`,
        );
      }
    }
    keys.add(mutation.idempotency_key);
  }
}
