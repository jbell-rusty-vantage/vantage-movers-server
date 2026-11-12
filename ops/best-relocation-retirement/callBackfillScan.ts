import mongoose from "mongoose";
import { getCallLeadModel } from "../../src/models/CallLead";

export type CallBackfillCursor = { timestamp: string | null; id: string };
export type CallBackfillPageRequest = { scope: string | null; kind: "primary" | "boundary"; cursor?: CallBackfillCursor; from: Date; through: Date; scanFrom: Date; scanThrough: Date; limit: number };
export type CallBackfillQueryEvidence = {
  strategy: "installed_timestamp_and_source_scope_indexes" | "injected_pages";
  primary_index?: string; boundary_index?: string; max_time_ms: number;
  pages: number; rows_returned: number;
  explain_samples: Array<{ kind: "primary" | "boundary"; scope: string | null; index_name: string; keys_examined: number; documents_examined: number; returned: number; execution_ms: number; blocking_sort: boolean }>;
};
const MAX_TIME_MS = 10_000;
type Index = { name?: string; key: Record<string, unknown>; sparse?: boolean; partialFilterExpression?: unknown; hidden?: boolean };
export function selectCallBackfillIndexes(indexes: Index[]) {
  const usable = indexes.filter(index => index.name && !index.sparse && !index.partialFilterExpression && !index.hidden);
  const primary = usable.find(index => index.name === "call_lead_overview_timestamp_receiver" && index.key.timestamp === 1) ??
    usable.find(index => Object.keys(index.key)[0] === "timestamp" && index.key.timestamp === 1);
  const boundary = usable.find(index => Object.keys(index.key).length === 1 && index.key.source_granularity_id === 1);
  if (!primary || !boundary) throw new Error("installed_call_backfill_timestamp_or_source_scope_index_missing");
  return { primary: primary.name!, boundary: boundary.name! };
}
function hasSort(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.stage === "SORT" || Object.values(record).some(value => Array.isArray(value) ? value.some(hasSort) : hasSort(value));
}

/** Uses only indexes verified on this database; never creates an index. */
export function createCallBackfillScan(projection: Record<string, number>) {
  let selected: Promise<ReturnType<typeof selectCallBackfillIndexes>> | undefined;
  const evidence: CallBackfillQueryEvidence = { strategy: "installed_timestamp_and_source_scope_indexes", max_time_ms: MAX_TIME_MS, pages: 0, rows_returned: 0, explain_samples: [] };
  const sampled = new Set<string>();
  async function indexes() {
    selected ??= getCallLeadModel().collection.listIndexes().toArray().then(rows => selectCallBackfillIndexes(rows as Index[]));
    const result = await selected;
    evidence.primary_index = result.primary; evidence.boundary_index = result.boundary;
    return result;
  }
  return {
    async scopes(): Promise<Array<string | null>> {
      const chosen = await indexes();
      const rows = await getCallLeadModel().collection.aggregate([{ $group: { _id: "$source_granularity_id" } }], { hint: chosen.boundary, maxTimeMS: MAX_TIME_MS }).toArray();
      return [...rows.map(row => row._id).filter(id => id != null).map(String).sort(), null];
    },
    async page(request: CallBackfillPageRequest): Promise<Record<string, any>[]> {
      const chosen = await indexes();
      const index = request.kind === "primary" ? chosen.primary : chosen.boundary;
      const scope = request.scope ? new mongoose.Types.ObjectId(request.scope) : null;
      const range = request.kind === "primary" ? { timestamp: { $gte: request.scanFrom, $lte: request.scanThrough } } : {
        $and: [{ "ringcentral.start_time": { $gte: request.from, $lte: request.through } },
          { $or: [{ timestamp: { $lt: request.scanFrom } }, { timestamp: { $gt: request.scanThrough } }, { timestamp: { $not: { $type: "date" as const } } }] }],
      };
      const cursor = !request.cursor ? {} : request.kind === "boundary"
        ? { _id: { $gt: new mongoose.Types.ObjectId(request.cursor.id) } }
        : { $or: [{ timestamp: { $gt: new Date(request.cursor.timestamp!) } },
          { timestamp: new Date(request.cursor.timestamp!), _id: { $gt: new mongoose.Types.ObjectId(request.cursor.id) } }] };
      const filter = { $and: [{ source_granularity_id: scope }, range, cursor] };
      const sort: Record<string, 1> = request.kind === "primary" ? { timestamp: 1, _id: 1 } : { _id: 1 };
      const query = () => getCallLeadModel().find(filter).select(projection).hint(index).sort(sort).limit(request.limit).maxTimeMS(MAX_TIME_MS).lean();
      const sampleKey = `${request.kind}:${request.scope ?? "null"}`;
      if (!request.cursor && !sampled.has(sampleKey)) {
        const explained = await query().explain("executionStats") as unknown as Record<string, any>;
        const stats = explained.executionStats ?? {};
        evidence.explain_samples.push({ kind: request.kind, scope: request.scope, index_name: index,
          keys_examined: Number(stats.totalKeysExamined ?? 0), documents_examined: Number(stats.totalDocsExamined ?? 0),
          returned: Number(stats.nReturned ?? 0), execution_ms: Number(stats.executionTimeMillis ?? 0), blocking_sort: hasSort(explained.queryPlanner?.winningPlan) });
        sampled.add(sampleKey);
      }
      const rows = await query().exec();
      evidence.pages++; evidence.rows_returned += rows.length;
      return rows;
    },
    async queryEvidence() { await indexes(); return structuredClone(evidence); },
  };
}
