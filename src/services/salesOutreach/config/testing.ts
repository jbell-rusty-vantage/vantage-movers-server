import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClientSession } from "mongoose";
import mongoose from "mongoose";
import { CsiError, type CsiActor } from "../../salesIntelligence/auth";
import { payloadHash, type executeCsiCommand, type appendCsiAudit } from "../../salesIntelligence/transactions";
import type { ConfigurationPointer, ConfigurationStore, ConfigurationVersion, ConfigurationWriter } from "./store";

/**
 * In-memory stand-in for `sales_outreach_configuration` + the CSI command ledger, for unit tests
 * only (no Mongo). It keeps the properties the real path relies on: a unique pointer key, a
 * revision CAS, unique version keys, an idempotency ledger keyed by actor scope + key with payload
 * hash conflicts, and all-or-nothing commands (a failed operation leaves no partial write).
 */
export class MemoryConfigurationDb {
  pointer: ConfigurationPointer | null = null;
  versions = new Map<string, ConfigurationVersion>();
  audits: Array<{ event_kind: string; revision: number }> = [];
  ledger = new Map<string, { hash: string; response: unknown }>();
  reads = { pointer: 0, version: 0 };
  failReads = false;

  readonly store: ConfigurationStore = {
    readPointer: async () => {
      this.reads.pointer += 1;
      if (this.failReads) throw new Error("database unavailable");
      return this.pointer ? { ...this.pointer } : null;
    },
    readVersion: async (version) => {
      this.reads.version += 1;
      if (this.failReads) throw new Error("database unavailable");
      const row = this.versions.get(version);
      return row ? { ...row } : null;
    },
  };

  readonly writer: ConfigurationWriter = {
    insertVersion: async (input) => {
      if (this.versions.has(input.version)) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      this.versions.set(input.version, {
        version: input.version,
        value: structuredClone(input.value),
        content_hash: input.content_hash,
        approval_ref: input.approval_ref,
        created_by: input.actor.id,
        created_at: new Date(0),
      });
    },
    createPointer: async (input) => {
      if (this.pointer) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      this.pointer = { id: "pointer-1", version: input.version, content_hash: input.content_hash, revision: 1, updated_by: input.updated_by, updated_at: new Date(0) };
      return { ...this.pointer };
    },
    movePointer: async (input) => {
      if (!this.pointer || this.pointer.revision !== input.expected_revision) return false;
      this.pointer = { ...this.pointer, version: input.version, content_hash: input.content_hash, revision: this.pointer.revision + 1, updated_by: input.updated_by };
      return true;
    },
  };

  readonly audit: typeof appendCsiAudit = async (_context, input) => {
    this.audits.push({ event_kind: input.event_kind, revision: input.revision });
  };

  readonly run = (async (input: Parameters<typeof executeCsiCommand>[0]) => {
    const key = `${input.actor.kind}:${input.actor.id}\n${input.idempotency_key}`;
    const hash = payloadHash({ command: input.command, payload: input.payload });
    const prior = this.ledger.get(key);
    if (prior) {
      if (prior.hash !== hash) throw new CsiError("IDEMPOTENCY_CONFLICT");
      return { response: prior.response, replayed: true };
    }
    const snapshot = { pointer: this.pointer, versions: new Map(this.versions), audits: [...this.audits] };
    try {
      const response = await input.operation({
        session: { inTransaction: () => true } as unknown as ClientSession,
        command_id: new mongoose.Types.ObjectId(),
        now: new Date(),
        actor: input.actor as CsiActor,
      });
      this.ledger.set(key, { hash, response });
      return { response, replayed: false };
    } catch (error) {
      this.pointer = snapshot.pointer;
      this.versions = snapshot.versions;
      this.audits = snapshot.audits;
      throw error;
    }
  }) as typeof executeCsiCommand;

  deps() {
    return { run: this.run, store: this.store, writer: this.writer, audit: this.audit };
  }
}

/**
 * The production revision-5 value shape (FINAL-01 policy, all five controls on, intake open,
 * migration running, 12-agent roster), frozen as JSON from the schema as it was before the
 * Outreach lifecycle repair added any key (olr A0). Its hash was computed then and must never
 * change: every later schema addition must leave this value re-parsing to the same hash.
 */
export const CONFIGURATION_REVISION_5_HASH = "4a3f18969e5b6dc68bfba80c190ddb44fa8f1e47172f970ce2f8e094cd239aee";
export function configurationRevision5Value(): Record<string, Record<string, unknown>> {
  return JSON.parse(readFileSync(resolve(__dirname, "fixtures/configuration-revision-5.json"), "utf8")) as Record<string, Record<string, unknown>>;
}
