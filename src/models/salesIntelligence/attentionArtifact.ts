import { Schema } from "mongoose";
import { at, defineCsiModel, enumeration, index, str, unique } from "./common";

export const ATTENTION_ARTIFACT_INDEXES = [
  unique("attention_artifact_content", { deployment: 1, database: 1, encoding: 1, hash: 1 }),
  index("attention_artifact_collection", { deployment: 1, database: 1, created_at: 1 }),
];
export const AttentionArtifactSchema = new Schema({
  deployment: str, database: str, encoding: str, hash: str,
  kind: enumeration(["rows", "index", "order"]),
  bytes: { type: Buffer, required: true },
  raw_bytes: { type: Number, required: true }, created_at: at,
}, { collection: "sales_intelligence_attention_artifacts" });
// Immutable content; privileged collection deletion is owned by the fenced janitor.
export const getAttentionArtifactModel = defineCsiModel("AttentionArtifact", AttentionArtifactSchema, ATTENTION_ARTIFACT_INDEXES, true);
