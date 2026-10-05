import { createHash } from "node:crypto";
import type { ClientSession } from "mongoose";
import {
  getSalesOutreachConfigurationModel,
  SALES_OUTREACH_CONFIGURATION_POINTER_KEY,
  salesOutreachConfigurationVersionKey,
} from "../../../models/salesOutreach/configuration";
import type { SalesOutreachConfigurationValue } from "../../../validation/v1/salesOutreach";
import { canonicalJson } from "../../durableWork/checksum";
import type { CsiActor } from "../../salesIntelligence/auth";

export type ConfigurationPointer = Readonly<{
  id: string;
  version: string;
  content_hash: string;
  revision: number;
  updated_by: string | null;
  updated_at: Date | null;
}>;

export type ConfigurationVersion = Readonly<{
  version: string;
  value: unknown;
  content_hash: string;
  approval_ref: string | null;
  created_by: string | null;
  created_at: Date | null;
}>;

/** Reads every request/job admission makes: the active pointer (primary) and an immutable version. */
export type ConfigurationStore = {
  readPointer(session?: ClientSession): Promise<ConfigurationPointer | null>;
  readVersion(version: string, session?: ClientSession): Promise<ConfigurationVersion | null>;
};

/** Writes, only inside the PATCH command transaction. */
export type ConfigurationWriter = {
  insertVersion(
    input: { version: string; value: SalesOutreachConfigurationValue; content_hash: string; approval_ref: string | null; actor: CsiActor },
    session: ClientSession,
  ): Promise<void>;
  /** Creates the pointer at revision 1 (explicit Owner initialization). */
  createPointer(input: { version: string; content_hash: string; updated_by: string }, session: ClientSession): Promise<ConfigurationPointer>;
  /** CAS on `revision`; false when another writer moved the pointer first. */
  movePointer(
    input: { expected_revision: number; version: string; content_hash: string; updated_by: string },
    session: ClientSession,
  ): Promise<boolean>;
};

/** Hash of the normalized complete value (CONTRACTS: "hash covers normalized complete value"). */
export function configurationContentHash(value: SalesOutreachConfigurationValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Version id derived from the command's idempotency identity, so a lost-response retry writes the same version. */
export function configurationVersionFor(actorScope: string, idempotencyKey: string): string {
  return `sod-config-${createHash("sha256").update(`${actorScope}\n${idempotencyKey}`).digest("hex").slice(0, 24)}`;
}

type PointerRow = {
  _id: unknown;
  version: string;
  content_hash: string | null;
  revision: number | null;
  updated_by: string | null;
  updatedAt?: Date | null;
};
type VersionRow = {
  version: string;
  value: unknown;
  content_hash: string | null;
  approval_ref: string | null;
  created_by: { id?: string } | null;
  createdAt?: Date | null;
};

const toPointer = (row: PointerRow): ConfigurationPointer => ({
  id: String(row._id),
  version: row.version,
  content_hash: row.content_hash ?? "",
  revision: row.revision ?? 0,
  updated_by: row.updated_by ?? null,
  updated_at: row.updatedAt ?? null,
});

export const mongoConfigurationStore: ConfigurationStore = {
  async readPointer(session) {
    const row = await getSalesOutreachConfigurationModel()
      .findOne({ kind: "pointer", key: SALES_OUTREACH_CONFIGURATION_POINTER_KEY })
      .read("primary")
      .session(session ?? null)
      .lean<PointerRow>();
    return row ? toPointer(row) : null;
  },
  async readVersion(version, session) {
    const row = await getSalesOutreachConfigurationModel()
      .findOne({ kind: "version", key: salesOutreachConfigurationVersionKey(version) })
      .read("primary")
      .session(session ?? null)
      .lean<VersionRow>();
    if (!row) return null;
    return {
      version: row.version,
      value: row.value,
      content_hash: row.content_hash ?? "",
      approval_ref: row.approval_ref ?? null,
      created_by: row.created_by?.id ?? null,
      created_at: row.createdAt ?? null,
    };
  },
};

export const mongoConfigurationWriter: ConfigurationWriter = {
  async insertVersion(input, session) {
    await getSalesOutreachConfigurationModel().create(
      [
        {
          kind: "version",
          key: salesOutreachConfigurationVersionKey(input.version),
          version: input.version,
          schema_version: 1,
          value: input.value,
          content_hash: input.content_hash,
          approval_ref: input.approval_ref,
          created_by: input.actor,
        },
      ],
      { session },
    );
  },
  async createPointer(input, session) {
    const [row] = await getSalesOutreachConfigurationModel().create(
      [
        {
          kind: "pointer",
          key: SALES_OUTREACH_CONFIGURATION_POINTER_KEY,
          version: input.version,
          content_hash: input.content_hash,
          revision: 1,
          updated_by: input.updated_by,
        },
      ],
      { session },
    );
    return toPointer(row!.toObject() as PointerRow);
  },
  async movePointer(input, session) {
    const result = await getSalesOutreachConfigurationModel().updateOne(
      { kind: "pointer", key: SALES_OUTREACH_CONFIGURATION_POINTER_KEY, revision: input.expected_revision },
      {
        $set: { version: input.version, content_hash: input.content_hash, updated_by: input.updated_by },
        $inc: { revision: 1 },
      },
      { session, runValidators: true },
    );
    return result.modifiedCount === 1;
  },
};
