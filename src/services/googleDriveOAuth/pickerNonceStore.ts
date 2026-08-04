import { connectMongo } from "../../db";
import { GooglePickerNonce } from "../../models/GooglePickerNonce";
import type { PickerFlow } from "./picker.types";

export type PickerNonceRecord = {
  nonce_hash: string;
  owner_email: string;
  flow: PickerFlow;
  expires_at: Date;
  consumed_at: Date | null;
};

export interface PickerNonceStore {
  findActive(input: {
    nonceHash: string;
    ownerEmail: string;
    now?: Date;
  }): Promise<PickerNonceRecord | null>;
  consumeActive(input: {
    nonceHash: string;
    ownerEmail: string;
    now?: Date;
  }): Promise<PickerNonceRecord | null>;
}

export class InMemoryPickerNonceStore implements PickerNonceStore {
  private readonly records = new Map<string, PickerNonceRecord>();

  seed(record: PickerNonceRecord): void {
    this.records.set(record.nonce_hash, {
      ...record,
      expires_at: new Date(record.expires_at),
      consumed_at: record.consumed_at ? new Date(record.consumed_at) : null,
    });
  }

  get(nonceHash: string): PickerNonceRecord | undefined {
    const record = this.records.get(nonceHash);
    return record ? { ...record } : undefined;
  }

  async findActive(input: {
    nonceHash: string;
    ownerEmail: string;
    now?: Date;
  }): Promise<PickerNonceRecord | null> {
    const record = this.records.get(input.nonceHash);
    if (!record) return null;
    const now = input.now ?? new Date();
    if (
      record.owner_email !== input.ownerEmail ||
      record.consumed_at !== null ||
      record.expires_at <= now
    ) {
      return null;
    }
    return { ...record };
  }

  async consumeActive(input: {
    nonceHash: string;
    ownerEmail: string;
    now?: Date;
  }): Promise<PickerNonceRecord | null> {
    const record = this.records.get(input.nonceHash);
    if (!record) return null;
    const now = input.now ?? new Date();
    if (
      record.owner_email !== input.ownerEmail ||
      record.consumed_at !== null ||
      record.expires_at <= now
    ) {
      return null;
    }
    record.consumed_at = now;
    return { ...record, consumed_at: now };
  }

  clear(): void {
    this.records.clear();
  }
}

function toPickerNonceRecord(
  document: {
    nonce_hash: string;
    owner_email: string;
    flow: PickerFlow;
    expires_at: Date;
    consumed_at?: Date | null;
  } | null,
): PickerNonceRecord | null {
  if (!document) return null;
  return {
    nonce_hash: document.nonce_hash,
    owner_email: document.owner_email,
    flow: document.flow,
    expires_at: document.expires_at,
    consumed_at: document.consumed_at ?? null,
  };
}

const mongoPickerNonceStore: PickerNonceStore = {
  async findActive(input) {
    await connectMongo();
    const document = await GooglePickerNonce.findOne({
      nonce_hash: input.nonceHash,
      owner_email: input.ownerEmail,
      expires_at: { $gt: input.now ?? new Date() },
      consumed_at: null,
    }).lean();
    return toPickerNonceRecord(document);
  },
  async consumeActive(input) {
    await connectMongo();
    const document = await GooglePickerNonce.findOneAndUpdate(
      {
        nonce_hash: input.nonceHash,
        owner_email: input.ownerEmail,
        expires_at: { $gt: input.now ?? new Date() },
        consumed_at: null,
      },
      { $set: { consumed_at: input.now ?? new Date() } },
      { returnDocument: "after" },
    ).lean();
    return toPickerNonceRecord(document);
  },
};

let pickerNonceStore: PickerNonceStore = mongoPickerNonceStore;

export function getPickerNonceStore(): PickerNonceStore {
  return pickerNonceStore;
}

export function setPickerNonceStoreForTests(
  store: PickerNonceStore | undefined,
): void {
  pickerNonceStore = store ?? mongoPickerNonceStore;
}
