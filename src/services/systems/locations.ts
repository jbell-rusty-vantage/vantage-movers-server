import type { ClientSession } from "mongoose";
import {
  getMasterBookedSheetContainerId,
  getMasterLeadsSheetContainerId,
} from "../../config/domain";
import {
  SYSTEMS_LOCATIONS_DOCUMENT_KEY,
  SystemsLocations,
  type SystemsLocationEntry,
} from "../../models/SystemsLocations";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import { RegistryError } from "../operationsRegistry/errors";
import { withRegistryMutation } from "../operationsRegistry/registryAudit";
import type { RegistryActorContext } from "../operationsRegistry/types";
import type { SystemsLocationsPatch } from "../../validation/v1/systems.validation";

/**
 * Systems › Where things live (doc 11b, R1). The stored keys are fixed; only labels, links and notes change.
 * Order here is the order on the page. The two Master Sheet rows are appended at read time from the sheet id
 * env names (wiring, not secrets) and are never stored or editable.
 */
export const EDITABLE_LOCATION_KEYS = [
  "extension",
  "main_site",
  "partner_pages",
  "wordpress",
  "dashboard",
  "server",
  "mcp",
] as const;
export type EditableLocationKey = (typeof EDITABLE_LOCATION_KEYS)[number];
export const SHEET_LOCATION_KEYS = ["master_leads", "master_booked"] as const;

/** What the row's main button does. Fixed per key, not editable. */
export type LocationAction = "install" | "open" | "copy";
const LOCATION_ACTIONS: Record<EditableLocationKey, LocationAction> = {
  extension: "install",
  main_site: "open",
  partner_pages: "open",
  wordpress: "open",
  dashboard: "open",
  server: "open",
  mcp: "copy",
};

const vercel = (project: string) => `https://vercel.com/vantage-4d3db9ef/${project}`;
const github = (repo: string) => `https://github.com/${repo}`;
const EXTENSION_STORE_URL =
  "https://chromewebstore.google.com/detail/granot-sync/mnfinkiglgagkfokimdnpkhlgemjnhfd";

/** Seed values, verified 2026-10-06 (doc 11b "The list"). Written once, on the first read. */
export const LOCATION_SEED: Record<EditableLocationKey, SystemsLocationEntry> = {
  extension: {
    label: "Granot Sync extension",
    url: EXTENSION_STORE_URL,
    note: null,
    paths: [],
    code_url: github("Overton77/vantage-movers-browser-extensions"),
    code_note: "personal account",
    host_url: EXTENSION_STORE_URL,
    logs_url: null,
  },
  main_site: {
    label: "Main site",
    url: "https://www.vantagehomemovers.com",
    note: null,
    paths: [],
    code_url: `${github("jbell-rusty-vantage/vantage-movers-clients")}/tree/main/apps/main-site`,
    code_note: null,
    host_url: vercel("vantage-movers-clients-main-site"),
    logs_url: null,
  },
  partner_pages: {
    label: "Partner landing pages",
    url: "https://vantagemoves.com",
    note: null,
    paths: ["/top10", "/tbm", "/tbm-primes", "/getmovers"],
    code_url: `${github("jbell-rusty-vantage/vantage-movers-clients")}/tree/main/apps/clients`,
    code_note: null,
    host_url: vercel("vantage-movers-clients"),
    logs_url: null,
  },
  wordpress: {
    label: "Old partner site",
    url: "https://vantagequotes.com",
    note: "WordPress. Partner paths moved to vantagemoves.com",
    paths: [],
    code_url: null,
    code_note: null,
    host_url: null,
    logs_url: null,
  },
  dashboard: {
    label: "Dashboard",
    url: "https://vantage-admin-rho.vercel.app",
    note: null,
    paths: [],
    code_url: github("jbell-rusty-vantage/vantage-admin"),
    code_note: null,
    host_url: vercel("vantage-admin"),
    logs_url: null,
  },
  server: {
    label: "Server (API)",
    url: "https://vantage-movers-main-server.vercel.app",
    note: null,
    paths: [],
    code_url: github("jbell-rusty-vantage/vantage-movers-server"),
    code_note: null,
    host_url: vercel("vantage-movers-main-server"),
    logs_url: `${vercel("vantage-movers-main-server")}/logs`,
  },
  mcp: {
    label: "MCP server",
    url: "https://vantage-movers-mcp.vercel.app/api/mcp",
    note: "Copy only. It asks for a key in a browser.",
    paths: [],
    code_url: github("jbell-rusty-vantage/vantage-movers-mcp"),
    code_note: null,
    host_url: vercel("vantage-movers-mcp"),
    logs_url: null,
  },
};

export type SystemsLocationRow = SystemsLocationEntry & {
  key: string;
  action: LocationAction;
  editable: boolean;
};

export type SystemsLocationsView = {
  revision: number;
  updated_at: string;
  updated_by: string | null;
  locations: SystemsLocationRow[];
};

type StoredLocations = {
  revision: number;
  entries: Record<string, SystemsLocationEntry>;
  updated_by: string | null;
  updated_at: Date;
};

export type LocationsStore = {
  /** Reads the document, inserting the seed when it does not exist yet (race-safe upsert). */
  readOrSeed(): Promise<StoredLocations>;
  /** Moves the document from `revision` to `revision + 1`; null when the revision is stale. */
  compareAndSet(
    revision: number,
    entries: Record<string, SystemsLocationEntry>,
    actorLabel: string,
    session: ClientSession,
  ): Promise<StoredLocations | null>;
};

export type SheetIdReader = () => { master_leads: string | null; master_booked: string | null };

const mongoLocationsStore: LocationsStore = {
  async readOrSeed() {
    const doc = await SystemsLocations.findOneAndUpdate(
      { key: SYSTEMS_LOCATIONS_DOCUMENT_KEY },
      {
        $setOnInsert: {
          key: SYSTEMS_LOCATIONS_DOCUMENT_KEY,
          revision: 1,
          entries: LOCATION_SEED,
          updated_by: null,
          updated_at: new Date(),
        },
      },
      { upsert: true, returnDocument: "after", lean: true },
    );
    return doc as StoredLocations;
  },
  async compareAndSet(revision, entries, actorLabel, session) {
    const doc = await SystemsLocations.findOneAndUpdate(
      { key: SYSTEMS_LOCATIONS_DOCUMENT_KEY, revision },
      { $set: { entries, updated_by: actorLabel, updated_at: new Date() }, $inc: { revision: 1 } },
      { returnDocument: "after", lean: true, session },
    );
    return (doc as StoredLocations | null) ?? null;
  },
};

function optionalSheetId(read: () => string): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}

const envSheetIds: SheetIdReader = () => ({
  master_leads: optionalSheetId(getMasterLeadsSheetContainerId),
  master_booked: optionalSheetId(getMasterBookedSheetContainerId),
});

function sheetRow(key: (typeof SHEET_LOCATION_KEYS)[number], label: string, id: string | null): SystemsLocationRow {
  return {
    key,
    label,
    url: id ? `https://docs.google.com/spreadsheets/d/${id}` : "",
    note: id ? "Google Sheets" : "The sheet id is not set on the server.",
    paths: [],
    code_url: null,
    code_note: null,
    host_url: null,
    logs_url: null,
    action: "open",
    editable: false,
  };
}

/** Stored entries over the seed, so a key added to the seed later still renders before its first edit. */
function entryFor(stored: StoredLocations, key: EditableLocationKey): SystemsLocationEntry {
  return { ...LOCATION_SEED[key], ...(stored.entries[key] ?? {}) };
}

function toView(stored: StoredLocations, sheetIds: ReturnType<SheetIdReader>): SystemsLocationsView {
  return {
    revision: stored.revision,
    updated_at: new Date(stored.updated_at).toISOString(),
    updated_by: stored.updated_by ?? null,
    locations: [
      ...EDITABLE_LOCATION_KEYS.map((key) => ({
        key,
        ...entryFor(stored, key),
        action: LOCATION_ACTIONS[key],
        editable: true,
      })),
      sheetRow("master_leads", "Master Leads", sheetIds.master_leads),
      sheetRow("master_booked", "Master Booked", sheetIds.master_booked),
    ],
  };
}

export type SystemsLocationsDeps = {
  store?: LocationsStore;
  sheetIds?: SheetIdReader;
  mutate?: typeof withRegistryMutation;
};

export async function getSystemsLocations(deps: SystemsLocationsDeps = {}): Promise<SystemsLocationsView> {
  const stored = await (deps.store ?? mongoLocationsStore).readOrSeed();
  return toView(stored, (deps.sheetIds ?? envSheetIds)());
}

export type SystemsLocationsPatchResult = SystemsLocationsView & { changed_keys: string[] };

/**
 * Owner edit. Applies the patch over the current entries, refuses a stale revision, and records one
 * `systems_locations` change (only the rows that changed, before and after) for Setup › Change history.
 * A patch that changes nothing writes nothing.
 */
export async function patchSystemsLocations(
  patch: SystemsLocationsPatch,
  actor: RegistryActorContext,
  deps: SystemsLocationsDeps = {},
): Promise<SystemsLocationsPatchResult> {
  const store = deps.store ?? mongoLocationsStore;
  const sheetIds = (deps.sheetIds ?? envSheetIds)();
  const current = await store.readOrSeed();
  if (current.revision !== patch.revision) throw staleRevision(current.revision);

  const next: Record<string, SystemsLocationEntry> = {};
  const before: Record<string, SystemsLocationEntry> = {};
  const after: Record<string, SystemsLocationEntry> = {};
  for (const key of EDITABLE_LOCATION_KEYS) {
    const existing = entryFor(current, key);
    const merged = { ...existing, ...(patch.locations[key] ?? {}) };
    next[key] = merged;
    if (JSON.stringify(existing) !== JSON.stringify(merged)) {
      before[key] = existing;
      after[key] = merged;
    }
  }
  const changedKeys = Object.keys(after);
  if (changedKeys.length === 0) return { ...toView(current, sheetIds), changed_keys: [] };

  const saved = await (deps.mutate ?? withRegistryMutation)({
    actor,
    audit: {
      entityType: "systems_locations",
      entityId: SYSTEMS_LOCATIONS_DOCUMENT_KEY,
      action: "update",
      reason: patch.reason,
      before,
      after,
      metadata: { changed_keys: changedKeys, revision_from: current.revision },
    },
    mutate: async (session) => {
      const result = await store.compareAndSet(current.revision, next, actor.actorLabel, session);
      if (!result) throw staleRevision(current.revision);
      return result;
    },
  });
  return { ...toView(saved, sheetIds), changed_keys: changedKeys };
}

function staleRevision(revision: number): RegistryError {
  return new RegistryError("Someone else saved the locations first. Reload and try again.", {
    registryCode: REGISTRY_ERROR_CODES.STALE_REVISION,
    remediation: { summary: "Reload the page to see the latest locations.", action: "reload" },
    metadata: { current_revision: revision },
  });
}
