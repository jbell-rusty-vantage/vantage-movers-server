const serverMetadata = new Set(["snapshot_id", "source_snapshot_id", "conversation_id", "transcript_version",
  "field_paths", "speaker_ref", "speaker_refs", "finding_keys", "schema_version", "run_id"]);

/** Retain full persisted evidence, but keep transport/citation metadata out of model context. */
export function modelEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(modelEvidence);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !serverMetadata.has(key)).map(([key, child]) => [key, modelEvidence(child)]));
  if (typeof value === "string" && /^[\s]*[\[{]/.test(value)) {
    try { return JSON.stringify(modelEvidence(JSON.parse(value))); } catch { /* Free text stays evidence. */ }
  }
  return value;
}
