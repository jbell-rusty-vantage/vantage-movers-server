import assert from "node:assert/strict";
import { test } from "node:test";
import type { SystemsLocationEntry } from "../../models/SystemsLocations";
import type { RegistryActorContext } from "../operationsRegistry/types";
import { RegistryError } from "../operationsRegistry/errors";
import {
  EDITABLE_LOCATION_KEYS,
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

test("the first read seeds the table once, in page order, with the Master Sheet links built from the ids", async () => {
  const memory = memoryStore();
  const first = await getSystemsLocations({ store: memory.store, sheetIds });
  await getSystemsLocations({ store: memory.store, sheetIds });
  assert.equal(memory.seeds(), 1);
  assert.deepEqual(
    first.locations.map((row) => row.key),
    [...EDITABLE_LOCATION_KEYS, "master_leads", "master_booked"],
  );
  const extension = first.locations[0]!;
  assert.equal(extension.action, "install");
  assert.match(extension.url, /^https:\/\/chromewebstore\.google\.com\/detail\/granot-sync\//);
  assert.equal(extension.code_note, "personal account");
  const partners = first.locations.find((row) => row.key === "partner_pages")!;
  assert.deepEqual(partners.paths, ["/top10", "/tbm", "/tbm-primes", "/getmovers"]);
  assert.equal(first.locations.find((row) => row.key === "mcp")!.action, "copy");
  assert.equal(first.locations.find((row) => row.key === "server")!.logs_url, "https://vercel.com/vantage-4d3db9ef/vantage-movers-main-server/logs");
  const leads = first.locations.find((row) => row.key === "master_leads")!;
  assert.equal(leads.url, "https://docs.google.com/spreadsheets/d/leads-sheet");
  assert.equal(leads.editable, false);
  const booked = first.locations.find((row) => row.key === "master_booked")!;
  assert.equal(booked.url, "");
  assert.match(booked.note ?? "", /not set/);
});

test("an edit records only the changed rows and moves the revision", async () => {
  const memory = memoryStore();
  const { audits, mutate } = recordingMutate();
  const result = await patchSystemsLocations(
    { revision: 1, locations: { partner_pages: { url: "https://partners.example.com" } } },
    actor,
    { store: memory.store, sheetIds, mutate },
  );
  assert.equal(result.revision, 2);
  assert.deepEqual(result.changed_keys, ["partner_pages"]);
  assert.equal(result.updated_by, "owner@example.com");
  assert.equal(result.locations.find((row) => row.key === "partner_pages")!.url, "https://partners.example.com");
  // The rest of the row is kept.
  assert.deepEqual(result.locations.find((row) => row.key === "partner_pages")!.paths, LOCATION_SEED.partner_pages.paths);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]!.entityType, "systems_locations");
  assert.equal(audits[0]!.action, "update");
  assert.deepEqual(Object.keys(audits[0]!.after ?? {}), ["partner_pages"]);
  assert.equal((audits[0]!.before as Record<string, SystemsLocationEntry>).partner_pages.url, "https://vantagemoves.com");
});

test("a patch that changes nothing writes nothing", async () => {
  const memory = memoryStore();
  const { audits, mutate } = recordingMutate();
  const result = await patchSystemsLocations(
    { revision: 1, locations: { main_site: { label: "Main site" } } },
    actor,
    { store: memory.store, sheetIds, mutate },
  );
  assert.equal(result.revision, 1);
  assert.deepEqual(result.changed_keys, []);
  assert.equal(audits.length, 0);
});

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
