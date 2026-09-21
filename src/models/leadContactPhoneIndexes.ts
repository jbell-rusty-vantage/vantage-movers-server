import type { CsiIndex } from "./salesIntelligence/common";

/**
 * The Lead phone paths `phoneEvidence` (CSI-05 `attachment/sources.ts`) turns
 * into Contact Number evidence, and the indexes that let the attachment worker
 * ask for them by key instead of walking the Lead corpus once per number
 * (14 §3).
 *
 * Every path stores the ten-digit NANP form produced by
 * `normalizePhoneNumberForMatch`, which is exactly `contact_numbers.national_ten`.
 * The trailing `_id` lets Mongo merge-sort the `$or` branches on the keyset
 * order instead of buffering and sorting the union in memory.
 *
 * A Granot snapshot that carries only a raw, unnormalized `phone_number` is
 * deliberately not indexed here: raw provider formatting is not a key. Those
 * leads are still attached through the lead-driven `attachment-lead:` job,
 * which the attachment watermark sweep raises for every Lead.
 */
export const FORM_LEAD_ATTACHMENT_PHONE_PATHS = [
  "normalized_phone_number",
  "ingested_contact_snapshot.normalized_phone_number",
  "granot_contact_snapshot.normalized_phone_number",
] as const;

export const CALL_LEAD_ATTACHMENT_PHONE_PATHS = [
  ...FORM_LEAD_ATTACHMENT_PHONE_PATHS,
  "ringcentral.original_caller.normalized_phone_number",
] as const;

function phoneKeysetIndexes(prefix: string, paths: readonly string[]): CsiIndex[] {
  return paths.map((path) => ({
    name: `${prefix}_attach_${path.replace(/\./g, "_")}`,
    key: { [path]: 1, _id: 1 },
  }));
}

export const FORM_LEAD_ATTACHMENT_INDEXES: CsiIndex[] = phoneKeysetIndexes(
  "form_lead",
  FORM_LEAD_ATTACHMENT_PHONE_PATHS,
);

export const CALL_LEAD_ATTACHMENT_INDEXES: CsiIndex[] = phoneKeysetIndexes(
  "call_lead",
  CALL_LEAD_ATTACHMENT_PHONE_PATHS,
);

/** Mongo `$or` clauses matching any known contact path against one ten-digit key. */
export function leadPhoneMatchClauses(
  model: "FormLead" | "CallLead",
  digits: readonly string[],
): Array<Record<string, unknown>> {
  const paths =
    model === "FormLead"
      ? FORM_LEAD_ATTACHMENT_PHONE_PATHS
      : CALL_LEAD_ATTACHMENT_PHONE_PATHS;
  const values = [...new Set(digits.filter((value) => value.trim().length > 0))];
  if (!values.length) return [];
  return paths.map((path) =>
    values.length === 1 ? { [path]: values[0]! } : { [path]: { $in: values } },
  );
}
