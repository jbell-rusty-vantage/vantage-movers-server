import { getRingCentralDirectorySnapshotModel } from "../../models/RingCentralDirectorySnapshot";

/**
 * Read-only view over the latest RingCentral directory snapshot for one
 * provider account. CSI-04 `directorySync.ts` writes snapshots; capture only
 * reads them. An empty lookup is a valid, honest state: without a snapshot,
 * roles stay `unknown` and company classification is not guessed. Rep mapping
 * review belongs to Team C (CSI-10).
 */
export type DirectoryExtension = Readonly<{
  id: string;
  extension_number: string | null;
  type: string;
  name: string | null;
}>;

export type DirectoryCompanyNumber = Readonly<{
  id: string;
  e164: string;
  usage_type: string | null;
  extension_id: string | null;
}>;

export type DirectoryLookup = Readonly<{
  provider_account_id: string | null;
  snapshot_id: string | null;
  taken_at: Date | null;
  extensionById(id: string): DirectoryExtension | null;
  extensionByNumber(extensionNumber: string): DirectoryExtension | null;
  companyNumberByE164(e164: string): DirectoryCompanyNumber | null;
  isQueueExtension(id: string): boolean;
  isEmpty: boolean;
}>;

export type DirectorySnapshotInput = {
  _id?: unknown;
  provider_account_id: string;
  taken_at: Date;
  extensions: ReadonlyArray<{
    id: string;
    extension_number?: string | null;
    type: string;
    name?: string | null;
  }>;
  company_numbers: ReadonlyArray<{
    id: string;
    e164: string;
    usage_type?: string | null;
    extension_id?: string | null;
  }>;
  queues: ReadonlyArray<{ id: string }>;
};

export function buildDirectoryLookup(
  snapshot: DirectorySnapshotInput | null,
): DirectoryLookup {
  if (!snapshot) return EMPTY_DIRECTORY_LOOKUP;
  const byId = new Map<string, DirectoryExtension>();
  const byNumber = new Map<string, DirectoryExtension>();
  for (const extension of snapshot.extensions) {
    const row: DirectoryExtension = {
      id: extension.id,
      extension_number: extension.extension_number ?? null,
      type: extension.type,
      name: extension.name ?? null,
    };
    byId.set(extension.id, row);
    if (row.extension_number) byNumber.set(row.extension_number, row);
  }
  const companyByE164 = new Map<string, DirectoryCompanyNumber>();
  for (const number of snapshot.company_numbers) {
    companyByE164.set(number.e164, {
      id: number.id,
      e164: number.e164,
      usage_type: number.usage_type ?? null,
      extension_id: number.extension_id ?? null,
    });
  }
  const queueIds = new Set(snapshot.queues.map((q) => q.id));
  return {
    provider_account_id: snapshot.provider_account_id,
    snapshot_id: snapshot._id ? String(snapshot._id) : null,
    taken_at: snapshot.taken_at,
    extensionById: (id) => byId.get(id) ?? null,
    extensionByNumber: (n) => byNumber.get(n) ?? null,
    companyNumberByE164: (e164) => companyByE164.get(e164) ?? null,
    isQueueExtension: (id) =>
      queueIds.has(id) || byId.get(id)?.type === "Department",
    isEmpty: false,
  };
}

export const EMPTY_DIRECTORY_LOOKUP: DirectoryLookup = Object.freeze({
  provider_account_id: null,
  snapshot_id: null,
  taken_at: null,
  extensionById: () => null,
  extensionByNumber: () => null,
  companyNumberByE164: () => null,
  isQueueExtension: () => false,
  isEmpty: true,
});

/** Latest persisted snapshot for the account, or the empty lookup. Never writes. */
export async function loadDirectoryLookup(
  providerAccountId: string,
): Promise<DirectoryLookup> {
  const row = await getRingCentralDirectorySnapshotModel()
    .findOne({ provider_account_id: providerAccountId })
    .sort({ taken_at: -1 })
    .lean();
  if (!row) return EMPTY_DIRECTORY_LOOKUP;
  return buildDirectoryLookup({
    _id: row._id,
    provider_account_id: row.provider_account_id,
    taken_at: row.taken_at,
    extensions: row.extensions,
    company_numbers: row.company_numbers,
    queues: row.queues,
  });
}
