import type {
  GranotCrmCsvKind,
  SourceCompany,
} from "../../config/domain";

export type GranotCrmDefaultChannel = "form" | "call" | "unknown";

export type GranotCrmSourceSeed = {
  workspace_slug: string;
  granot_label: string;
  default_channel: GranotCrmDefaultChannel;
  source_company: SourceCompany;
  csv_paths?: Partial<Record<GranotCrmCsvKind, string>>;
  enabled?: boolean;
  notes?: string;
};

export type GranotCsvRecord = Record<string, string>;

export type GranotCsvDataRow = {
  rowIndex: number;
  rowKey: string;
  [column: string]: string | number;
};

export type ParsedGranotCsv = {
  headers: string[];
  rows: GranotCsvDataRow[];
  counts: {
    total: number;
    dataRows: number;
    skippedRows: number;
  };
};

export type GranotCrmUploadInput = {
  crm_origin: string;
  csv_kind: GranotCrmCsvKind;
  csv_path: string;
  csv_text: string;
  trigger: "extension" | "script" | "manual";
  workspace_slug?: string;
  granot_label?: string;
  frame_url?: string;
  fetched_at?: Date;
  byte_length?: number;
  row_count?: number;
  data_row_count?: number;
};

export type GranotCrmUploadResult = {
  ingestion_id: string;
  source_id?: string;
  status: "uploaded" | "skipped_unchanged";
  workspace_slug: string;
  csv_kind: GranotCrmCsvKind;
  content_sha256: string;
  row_count: number;
  data_row_count: number;
  s3_bucket: string;
  s3_latest_key: string;
  s3_history_key?: string;
  s3_meta_key: string;
};
