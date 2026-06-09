import type { GranotCrmCsvKind } from "../../config/domain";
import { getGranotCrmCsvPrefix } from "../../config/domain";
import { normalizeCrmOrigin, slugifyWorkspace } from "./registry";

export type GranotCrmCsvObjectKeys = {
  latestKey: string;
  metaKey: string;
  historyKey: string;
};

export function buildGranotCrmCsvObjectKeys(input: {
  crmOrigin: string;
  workspaceSlug: string;
  csvKind: GranotCrmCsvKind;
  fetchedAt: Date;
  contentSha256: string;
}): GranotCrmCsvObjectKeys {
  const prefix = getGranotCrmCsvPrefix();
  const originHost = originHostSegment(input.crmOrigin);
  const workspace = slugifyWorkspace(input.workspaceSlug, { allowSlash: true });
  const base = `${prefix}/${originHost}/workspaces/${workspace}/${input.csvKind}`;
  const historyDate = utcDatePath(input.fetchedAt);
  const filename = `${utcCompact(input.fetchedAt)}_${input.contentSha256.slice(0, 8)}.csv`;

  return {
    latestKey: `${base}/latest.csv`,
    metaKey: `${base}/latest.meta.json`,
    historyKey: `${base}/history/${historyDate}/${filename}`,
  };
}

export function buildRegistryKey(crmOrigin: string): string {
  const prefix = getGranotCrmCsvPrefix();
  return `${prefix}/${originHostSegment(crmOrigin)}/registry.json`;
}

function originHostSegment(value: string): string {
  try {
    return new URL(normalizeCrmOrigin(value)).host.toLowerCase();
  } catch {
    return normalizeCrmOrigin(value)
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9.-]+/gi, "-")
      .toLowerCase();
  }
}

function utcDatePath(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function utcCompact(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}
