import { mock } from "node:test";
import { logger } from "../../logger";
import { isGranotLifecycleCatalogKey } from "./observability";

export type CapturedLifecycleLog = {
  level: "info" | "warn" | "error";
  msg: string;
  record: Record<string, unknown>;
};

/**
 * Captures structured logger lines in a test. Lifecycle diagnostics are log
 * lines keyed by the closed event key in `msg`; nothing else stores them.
 * `events` keeps only catalog event lines.
 */
export function captureGranotLifecycleLogs(): {
  records: CapturedLifecycleLog[];
  events: () => CapturedLifecycleLog[];
  keys: () => string[];
  find: (msg: string) => CapturedLifecycleLog | undefined;
  clear: () => void;
  restore: () => void;
} {
  const records: CapturedLifecycleLog[] = [];
  const mocks = (["info", "warn", "error"] as const).map((level) =>
    mock.method(logger, level, (record: unknown) => {
      if (record && typeof record === "object" && typeof (record as { msg?: unknown }).msg === "string") {
        records.push({
          level,
          msg: (record as { msg: string }).msg,
          record: record as Record<string, unknown>,
        });
      }
    }),
  );
  return {
    records,
    events: () => records.filter((row) => isGranotLifecycleCatalogKey(row.msg)),
    keys: () => records.filter((row) => isGranotLifecycleCatalogKey(row.msg)).map((row) => row.msg),
    find: (msg) => records.find((row) => row.msg === msg),
    clear: () => {
      records.length = 0;
    },
    restore: () => {
      for (const entry of mocks) entry.mock.restore();
    },
  };
}
