import assert from "node:assert/strict";
import { test } from "node:test";
import type { SystemsLocationEntry } from "../../models/SystemsLocations";
import type { RegistryActorContext } from "../operationsRegistry/types";
import { RegistryError } from "../operationsRegistry/errors";
import {
  getSystemsLocations,
  LOCATION_SEED,
  patchSystemsLocations,
  type LocationsStore,
} from "./locations";

const actor: RegistryActorContext = {
  actorType: "owner",
  actorId: "owner-1",
  actorLabel: "owner@example.com",
  actorRole: "owner",
  requestId: "req-1",
};

function memoryStore() {
  let doc: { revision: number; entries: Record<string, SystemsLocationEntry>; updated_by: string | null; updated_at: Date } | null =
    null;
  let seeds = 0;
  const store: LocationsStore = {
    async readOrSeed() {
      if (!doc) {
        seeds += 1;
        doc = { revision: 1, entries: structuredClone(LOCATION_SEED), updated_by: null, updated_at: new Date("2026-10-07T00:00:00Z") };
      }
      return structuredClone(doc);
    },
    async compareAndSet(revision, entries, actorLabel) {
      if (!doc || doc.revision !== revision) return null;
      doc = { revision: revision + 1, entries: structuredClone(entries), updated_by: actorLabel, updated_at: new Date() };
      return structuredClone(doc);
    },
  };
  return { store, seeds: () => seeds, bump: () => doc && (doc.revision += 1) };
}

const sheetIds = () => ({ master_leads: "leads-sheet", master_booked: null });

type Audit = Parameters<NonNullable<Parameters<typeof patchSystemsLocations>[2]>["mutate"] & object>[0];
function recordingMutate() {
  const audits: Audit["audit"][] = [];
  const mutate = (async (input: Audit) => {
    const result = await input.mutate({} as never);
    audits.push(input.audit);
    return result;
  }) as never;
  return { audits, mutate };
}

test("a stale revision is refused before and inside the write", async () => {
  const memory = memoryStore();
  const { mutate } = recordingMutate();
  await getSystemsLocations({ store: memory.store, sheetIds });
  await assert.rejects(
    patchSystemsLocations({ revision: 7, locations: { main_site: { label: "Site" } } }, actor, { store: memory.store, sheetIds, mutate }),
    (error: unknown) => error instanceof RegistryError && error.statusCode === 409,
  );
  // Someone else saves between the read and the write.
  const racing = (async (input: Audit) => {
    memory.bump();
    return input.mutate({} as never);
  }) as never;
  await assert.rejects(
    patchSystemsLocations({ revision: 1, locations: { main_site: { label: "Site" } } }, actor, {
      store: memory.store,
      sheetIds,
      mutate: racing,
    }),
    (error: unknown) => error instanceof RegistryError && error.statusCode === 409,
  );
});
