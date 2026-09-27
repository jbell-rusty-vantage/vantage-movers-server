import { csiFlag } from "../../../config/domain/salesIntelligence";
import { payloadHash } from "../transactions";
import type { EvidenceRecord } from "./contracts";
import type { CapturedPromptPage } from "./prompt";

/**
 * Citation handles (citation-handles spec §4.1). In handles mode the findings model never types a
 * database id: every citable context record gets a short server-owned handle, and the server resolves
 * each handle to the exact `{record_type, record_id}` (and the pages it was captured on) that the id
 * form resolves today, so the accepted `csi-envelope-v1` envelope is byte-identical.
 *
 * - `T<n>`: `story_event_ids[n]`, the Case File's `[Tn]` numbering (§4 of the Case File);
 * - `P<n>`: `prior_finding_ids[n]`, the Case File's `Pn` numbering (§6);
 * - `R<n>` (1-based): every other record in `appendix.context.records`, in appendix order, one
 *   namespace for all other types so a valid handle cannot be paired with the wrong type.
 *
 * Pure and byte-stable (no clock, no randomness): the same frozen snapshots always give the same table,
 * so a retry or an `original_evidence` replay reproduces it exactly.
 */
export const CITATION_HANDLES_FLAG = "SALES_INTELLIGENCE_CITATION_HANDLES";
/** Read once per run, at prepare time, through `structuredStepContracts()` (recorded as `citations: "handles"`). */
export const citationHandlesEnabled = () => csiFlag("CITATION_HANDLES");
export type CitationMode = "ids" | "handles";
export const CITATION_HANDLE_PATTERN = /^(T|P|R)[0-9]{1,4}$/;
export type CitationHandle = { ref: string; record_type: EvidenceRecord["record_type"]; record_id: string; snapshot_ids: string[] };
export type CitationHandleTable = { handles: CitationHandle[]; digest: string };
/** Types cited by T / P; never repeated as an R handle. */
const INDEXED_TYPES: ReadonlySet<string> = new Set(["story_event", "prior_finding"]);
const recordKey = (type: string, id: string) => `${type}\u0000${id}`;

export function buildCitationHandles(inputs: {
  /** Every captured page the expansion searches (context, Case File, prior). */
  context: readonly CapturedPromptPage[];
  /** `appendix.context.records` as the model is shown them (the context page minus prior-finding timeline rows). */
  records: readonly EvidenceRecord[];
  story_event_ids: readonly string[];
  prior_finding_ids: readonly string[];
}): CitationHandleTable {
  // A record on several pages (same type and id) is one handle whose snapshot_ids name every page, as `expandRefs` matches today.
  const pagesOf = (type: EvidenceRecord["record_type"], id: string) => [...new Set(inputs.context
    .filter(page => page.data.page.records.some(record => record.record_type === type && record.record_id === id)).map(page => page.snapshot_id))];
  const handles: CitationHandle[] = [
    ...inputs.story_event_ids.map((id, n) => ({ ref: `T${n}`, record_type: "story_event" as const, record_id: id, snapshot_ids: pagesOf("story_event", id) })),
    ...inputs.prior_finding_ids.map((id, n) => ({ ref: `P${n}`, record_type: "prior_finding" as const, record_id: id, snapshot_ids: pagesOf("prior_finding", id) })),
  ];
  const seen = new Set<string>();
  for (const record of inputs.records) {
    const key = recordKey(record.record_type, record.record_id);
    if (INDEXED_TYPES.has(record.record_type) || seen.has(key)) continue;
    seen.add(key);
    handles.push({ ref: `R${seen.size}`, record_type: record.record_type, record_id: record.record_id, snapshot_ids: pagesOf(record.record_type, record.record_id) });
  }
  return { handles, digest: payloadHash(handles) };
}

/** The handle of a record as the appendix shows it; null for a record cited by T / P or not in the table. */
export function handleIndex(table: CitationHandleTable) {
  const byRef = new Map(table.handles.map(handle => [handle.ref, handle]));
  const byRecord = new Map(table.handles.filter(handle => handle.ref.startsWith("R")).map(handle => [recordKey(handle.record_type, handle.record_id), handle.ref]));
  return { resolve: (ref: string) => byRef.get(ref) ?? null, refOf: (type: string, id: string) => byRecord.get(recordKey(type, id)) ?? null };
}

/** "T0–T41, P0–P12 and R1–R23" (empty lists named as such). */
export function handleRanges(table: CitationHandleTable) {
  const parts = (["T", "P", "R"] as const).map(letter => {
    const numbers = table.handles.filter(h => h.ref[0] === letter).map(h => Number(h.ref.slice(1)));
    return numbers.length ? `${letter}${Math.min(...numbers)}–${letter}${Math.max(...numbers)}` : `no ${letter} handles`;
  });
  return `${parts[0]}, ${parts[1]} and ${parts[2]}`;
}

/**
 * Repair text for a ref the table does not hold: the valid ranges, and the same number under another
 * letter only when that handle exists (named with its record type, so the model can check it). It never
 * substitutes: acceptance stays with `expandStructuredFindings`.
 */
export function handleRepairHint(table: CitationHandleTable, ref: string) {
  const { resolve } = handleIndex(table);
  const number = /^[A-Z]([0-9]{1,4})$/.exec(ref)?.[1];
  const others = number === undefined ? [] : (["T", "P", "R"] as const).filter(letter => letter !== ref[0])
    .flatMap(letter => { const handle = resolve(`${letter}${Number(number)}`); return handle ? [`${handle.ref} (a ${handle.record_type} record)`] : []; });
  return `ref ${JSON.stringify(ref)} is not a supplied handle: the handles run ${handleRanges(table)}.`
    + (others.length ? ` ${others.join(" and ")} exist${others.length === 1 ? "s" : ""}: check which record you mean.` : "")
    + " Cite only a T or P number from the Case File or the ref shown beside a record in appendix.context.records, or drop the citation.";
}
