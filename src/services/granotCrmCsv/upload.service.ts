import { createHash } from "node:crypto";
import { getGranotCrmCsvBucket } from "../../config/domain";
import { getGranotCrmCsvIngestionModel } from "../../models/GranotCrmCsvIngestion";
import { parseGranotCsv } from "./parser";
import {
  ensureSourceForUpload,
  normalizeCrmOrigin,
  normalizeCsvPath,
} from "./registry";
import { buildGranotCrmCsvObjectKeys } from "./keys";
import { putGranotCrmObject } from "./storage";
import type { GranotCrmUploadInput, GranotCrmUploadResult } from "./types";

export async function uploadGranotCrmCsv(
  input: GranotCrmUploadInput,
): Promise<GranotCrmUploadResult> {
  const crmOrigin = normalizeCrmOrigin(input.crm_origin);
  const csvPath = normalizeCsvPath(input.csv_path);
  const fetchedAt = input.fetched_at ?? new Date();
  const uploadedAt = new Date();
  const contentSha256 = sha256(input.csv_text);
  const parsed = parseGranotCsv(input.csv_text);
  const byteSize = Buffer.byteLength(input.csv_text, "utf8");
  const source = await ensureSourceForUpload({
    crmOrigin,
    workspaceSlug: input.workspace_slug,
    granotLabel: input.granot_label,
    csvPath,
    csvKind: input.csv_kind,
  });
  const workspaceSlug = source.workspace_slug;
  const keys = buildGranotCrmCsvObjectKeys({
    crmOrigin,
    workspaceSlug,
    csvKind: input.csv_kind,
    fetchedAt,
    contentSha256,
  });
  const Ingestion = getGranotCrmCsvIngestionModel();
  const lastHash = source.last_ingestions?.[input.csv_kind]?.content_sha256;

  if (lastHash === contentSha256) {
    const skipped = await Ingestion.create({
      source: source._id,
      crm_origin: crmOrigin,
      workspace_slug: workspaceSlug,
      granot_label: source.granot_label,
      csv_kind: input.csv_kind,
      csv_path: csvPath,
      content_sha256: contentSha256,
      byte_size: byteSize,
      row_count: input.row_count ?? parsed.counts.total,
      data_row_count: input.data_row_count ?? parsed.counts.dataRows,
      fetched_at: fetchedAt,
      uploaded_at: uploadedAt,
      trigger: input.trigger,
      status: "skipped_unchanged",
      s3_bucket: getGranotCrmCsvBucket(),
      s3_latest_key: keys.latestKey,
      s3_meta_key: keys.metaKey,
    });
    return {
      ingestion_id: skipped._id.toString(),
      source_id: source._id.toString(),
      status: "skipped_unchanged",
      workspace_slug: workspaceSlug,
      csv_kind: input.csv_kind,
      content_sha256: contentSha256,
      row_count: skipped.row_count,
      data_row_count: skipped.data_row_count,
      s3_bucket: skipped.s3_bucket,
      s3_latest_key: skipped.s3_latest_key,
      s3_meta_key: skipped.s3_meta_key ?? keys.metaKey,
    };
  }

  const history = await putGranotCrmObject({
    key: keys.historyKey,
    body: input.csv_text,
    contentType: "text/csv; charset=utf-8",
    metadata: s3Metadata(contentSha256, input.csv_kind, workspaceSlug),
  });
  await putGranotCrmObject({
    key: keys.latestKey,
    body: input.csv_text,
    contentType: "text/csv; charset=utf-8",
    metadata: s3Metadata(contentSha256, input.csv_kind, workspaceSlug),
  });

  const meta = {
    crm_origin: crmOrigin,
    workspace_slug: workspaceSlug,
    granot_label: source.granot_label,
    csv_kind: input.csv_kind,
    csv_path: csvPath,
    content_sha256: contentSha256,
    byte_size: byteSize,
    row_count: input.row_count ?? parsed.counts.total,
    data_row_count: input.data_row_count ?? parsed.counts.dataRows,
    fetched_at: fetchedAt.toISOString(),
    uploaded_at: uploadedAt.toISOString(),
    trigger: input.trigger,
    history_key: keys.historyKey,
  };
  await putGranotCrmObject({
    key: keys.metaKey,
    body: JSON.stringify(meta, null, 2),
    contentType: "application/json; charset=utf-8",
    metadata: s3Metadata(contentSha256, input.csv_kind, workspaceSlug),
  });

  const ingestion = await Ingestion.create({
    source: source._id,
    crm_origin: crmOrigin,
    workspace_slug: workspaceSlug,
    granot_label: source.granot_label,
    csv_kind: input.csv_kind,
    csv_path: csvPath,
    content_sha256: contentSha256,
    byte_size: byteSize,
    row_count: meta.row_count,
    data_row_count: meta.data_row_count,
    fetched_at: fetchedAt,
    uploaded_at: uploadedAt,
    trigger: input.trigger,
    status: "uploaded",
    s3_bucket: history.bucket,
    s3_latest_key: keys.latestKey,
    s3_history_key: keys.historyKey,
    s3_meta_key: keys.metaKey,
    s3_version_id: history.versionId,
  });

  source.last_ingestions = {
    ...(source.last_ingestions ?? {}),
    [input.csv_kind]: {
      content_sha256: contentSha256,
      ingestion_id: ingestion._id,
      s3_key: keys.latestKey,
      imported_at: uploadedAt,
    },
  };
  source.csv_paths = {
    ...(source.csv_paths ?? {}),
    [input.csv_kind]: csvPath,
  };
  await source.save();

  return {
    ingestion_id: ingestion._id.toString(),
    source_id: source._id.toString(),
    status: "uploaded",
    workspace_slug: workspaceSlug,
    csv_kind: input.csv_kind,
    content_sha256: contentSha256,
    row_count: ingestion.row_count,
    data_row_count: ingestion.data_row_count,
    s3_bucket: ingestion.s3_bucket,
    s3_latest_key: ingestion.s3_latest_key,
    s3_history_key: ingestion.s3_history_key ?? undefined,
    s3_meta_key: ingestion.s3_meta_key ?? keys.metaKey,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function s3Metadata(
  contentSha256: string,
  csvKind: string,
  workspaceSlug: string,
): Record<string, string> {
  return {
    content_sha256: contentSha256,
    csv_kind: csvKind,
    workspace_slug: workspaceSlug.replace(/\//g, "-"),
  };
}
