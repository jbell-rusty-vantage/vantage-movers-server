import { z } from "zod";
import {
  CSI_ENVELOPE_SCHEMA_VERSION,
  intelligenceEnvelopeSchema,
} from "../../../validation/intelligence/intelligenceEnvelope.validation";
import { payloadHash } from "../transactions";
import { intelligenceToolArguments } from "./contracts";

/**
 * The JSON Schema *rendering* of the envelope contract, versioned separately
 * from the contract itself (22 §4.2).
 *
 * The envelope stays `csi-envelope-v1`: the Zod contract in
 * `intelligenceEnvelope.validation.ts` accepts exactly the same documents
 * before and after, every stored submission carries that literal, and the apply
 * path reads it. What changes is how that contract is *drawn* as JSON Schema.
 *
 * `r1` inlines every repeated sub-object, so the seventeen finding kinds each
 * carry their own copy of the evidence-reference union: 41,424 bytes, sent on
 * every step of every run. `r2` hoists the reused pieces into `$defs` and
 * references them: 16,646 bytes for the identical contract.
 *
 * Both revisions stay available because a run pins its digest at preparation
 * and an `original_evidence` replay must reproduce the parent exactly. An
 * unrecognised digest resolves to nothing and the runtime fails
 * `contract_mismatch` — never a silent substitution of one rendering for
 * another.
 */
export type SchemaArtifactRevision = "r1" | "r2";
export const CSI_SCHEMA_ARTIFACT_REVISIONS = ["r1", "r2"] as const;
export const CSI_SCHEMA_ARTIFACT_REVISION: SchemaArtifactRevision = "r2";
export const CSI_SCHEMA_RESOURCE_URIS: Record<SchemaArtifactRevision, string> = {
  r1: `csi://schemas/${CSI_ENVELOPE_SCHEMA_VERSION}`,
  r2: `csi://schemas/${CSI_ENVELOPE_SCHEMA_VERSION}r2`,
};

const jsonSchemaFor = (revision: SchemaArtifactRevision, schema: z.ZodType) =>
  revision === "r1" ? z.toJSONSchema(schema) : z.toJSONSchema(schema, { reused: "ref" });

/** Generation is pure but not free; the digest is read on every run preparation. */
const memo = new Map<SchemaArtifactRevision, { json: unknown; digest: string }>();
function artifact(revision: SchemaArtifactRevision) {
  const cached = memo.get(revision);
  if (cached) return cached;
  const json = jsonSchemaFor(revision, intelligenceEnvelopeSchema);
  const built = { json, digest: payloadHash(json) };
  memo.set(revision, built);
  return built;
}

export const intelligenceEnvelopeJsonSchema = (revision: SchemaArtifactRevision = CSI_SCHEMA_ARTIFACT_REVISION) =>
  artifact(revision).json;
export const intelligenceSchemaDigest = (revision: SchemaArtifactRevision = CSI_SCHEMA_ARTIFACT_REVISION) =>
  artifact(revision).digest;

export type ResolvedSchemaArtifact = { revision: SchemaArtifactRevision; uri: string; digest: string; json: unknown };
/** The artifact a run pinned, found by its digest. `null` means this deployment cannot reproduce it. */
export function schemaArtifactForDigest(digest: string): ResolvedSchemaArtifact | null {
  for (const revision of CSI_SCHEMA_ARTIFACT_REVISIONS) {
    const built = artifact(revision);
    if (built.digest === digest)
      return { revision, uri: CSI_SCHEMA_RESOURCE_URIS[revision], digest, json: built.json };
  }
  return null;
}
/**
 * Digests of the envelope renderings pinned by runs prepared before the context-provenance
 * additions (optional `prior_finding_relations` / `story_discrepancies`, five record types).
 * The contract those runs accepted is a strict subset of today's, so an `original_evidence`
 * replay of one is still asked exactly what its parent was asked; this deployment simply cannot
 * re-render their JSON, so `schemaArtifactForDigest` stays null for them.
 */
export const LEGACY_SCHEMA_DIGESTS: Readonly<Record<string, SchemaArtifactRevision>> = {
  "18a4746f6343c4b093ef449693b685872e3f912ae36fe87e4d49196fc1ecfed7": "r1",
  "c26e86d1eac2e9d1090133bcb65dcab8e0830d99f5c4b3ccbdc55934e9658d6a": "r2",
};
export const knownSchemaDigest = (digest: string) => schemaArtifactForDigest(digest) !== null || digest in LEGACY_SCHEMA_DIGESTS;

/**
 * Tool argument schemas as the MCP publishes them. The submit tool embeds the
 * envelope, so it inherits the same compaction and the same 60% saving; the
 * read tools are small either way and only change shape at `r2` if they happen
 * to reuse a sub-schema.
 */
export function intelligenceToolJsonSchemas(revision: SchemaArtifactRevision = CSI_SCHEMA_ARTIFACT_REVISION) {
  return Object.fromEntries(
    Object.entries(intelligenceToolArguments).map(([name, schema]) => [name, jsonSchemaFor(revision, schema)]),
  );
}
