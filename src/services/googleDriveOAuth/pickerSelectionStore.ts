import { connectMongo } from "../../db";

import { GooglePickerSelection } from "../../models/GooglePickerSelection";

import { setPickerNonceStoreForTests } from "./pickerNonceStore";

import type { PickerFlow } from "./picker.types";



export type PickerSelectionRecord = {

  reference_hash: string;

  owner_email: string;

  flow: PickerFlow;

  file_id: string;

  mime_type: string;

  name: string;

  url: string;

  parent_folder_id?: string;

  expires_at: Date;

  consumed_at: Date | null;

};



export interface PickerSelectionStore {

  create(record: Omit<PickerSelectionRecord, "consumed_at">): Promise<void>;

  countActive(): Promise<number>;

  findActive(input: {

    referenceHash: string;

    ownerEmail: string;

    flow: PickerFlow;

    now?: Date;

  }): Promise<PickerSelectionRecord | null>;

  consumeActive(input: {

    referenceHash: string;

    ownerEmail: string;

    flow: PickerFlow;

    now?: Date;

  }): Promise<PickerSelectionRecord | null>;

}



export class InMemoryPickerSelectionStore implements PickerSelectionStore {

  readonly records: PickerSelectionRecord[] = [];



  seed(record: PickerSelectionRecord): void {

    this.records.push({

      ...record,

      expires_at: new Date(record.expires_at),

      consumed_at: record.consumed_at ? new Date(record.consumed_at) : null,

    });

  }



  get(referenceHash: string): PickerSelectionRecord | undefined {

    const record = this.records.find(

      (entry) => entry.reference_hash === referenceHash,

    );

    return record ? { ...record } : undefined;

  }



  async create(record: Omit<PickerSelectionRecord, "consumed_at">): Promise<void> {

    this.records.push({ ...record, consumed_at: null });

  }



  async countActive(): Promise<number> {

    const now = new Date();

    return this.records.filter(

      (record) => record.consumed_at === null && record.expires_at > now,

    ).length;

  }



  async findActive(input: {

    referenceHash: string;

    ownerEmail: string;

    flow: PickerFlow;

    now?: Date;

  }): Promise<PickerSelectionRecord | null> {

    const record = this.records.find(

      (entry) => entry.reference_hash === input.referenceHash,

    );

    if (!record) return null;

    const now = input.now ?? new Date();

    if (

      record.owner_email !== input.ownerEmail ||

      record.flow !== input.flow ||

      record.consumed_at !== null ||

      record.expires_at <= now

    ) {

      return null;

    }

    return { ...record };

  }



  async consumeActive(input: {

    referenceHash: string;

    ownerEmail: string;

    flow: PickerFlow;

    now?: Date;

  }): Promise<PickerSelectionRecord | null> {

    const record = this.records.find(

      (entry) => entry.reference_hash === input.referenceHash,

    );

    if (!record) return null;

    const now = input.now ?? new Date();

    if (

      record.owner_email !== input.ownerEmail ||

      record.flow !== input.flow ||

      record.consumed_at !== null ||

      record.expires_at <= now

    ) {

      return null;

    }

    record.consumed_at = now;

    return { ...record, consumed_at: now };

  }



  clear(): void {

    this.records.length = 0;

  }

}



function toPickerSelectionRecord(

  document: {

    reference_hash: string;

    owner_email: string;

    flow: PickerFlow;

    file_id: string;

    mime_type: string;

    name: string;

    url: string;

    parent_folder_id?: string | null;
    expires_at: Date;
    consumed_at?: Date | null;
  } | null,
): PickerSelectionRecord | null {
  if (!document) return null;
  return {
    reference_hash: document.reference_hash,
    owner_email: document.owner_email,
    flow: document.flow,
    file_id: document.file_id,
    mime_type: document.mime_type,
    name: document.name,
    url: document.url,
    parent_folder_id: document.parent_folder_id ?? undefined,
    expires_at: document.expires_at,
    consumed_at: document.consumed_at ?? null,
  };
}



const mongoPickerSelectionStore: PickerSelectionStore = {

  async create(record) {

    await connectMongo();

    await GooglePickerSelection.create(record);

  },

  async countActive() {

    await connectMongo();

    return GooglePickerSelection.countDocuments({

      expires_at: { $gt: new Date() },

      consumed_at: null,

    });

  },

  async findActive(input) {

    await connectMongo();

    const document = await GooglePickerSelection.findOne({

      reference_hash: input.referenceHash,

      owner_email: input.ownerEmail,

      flow: input.flow,

      expires_at: { $gt: input.now ?? new Date() },

      consumed_at: null,

    }).lean();

    return toPickerSelectionRecord(document);

  },

  async consumeActive(input) {

    await connectMongo();

    const document = await GooglePickerSelection.findOneAndUpdate(

      {

        reference_hash: input.referenceHash,

        owner_email: input.ownerEmail,

        flow: input.flow,

        expires_at: { $gt: input.now ?? new Date() },

        consumed_at: null,

      },

      { $set: { consumed_at: input.now ?? new Date() } },

      { returnDocument: "after" },

    ).lean();

    return toPickerSelectionRecord(document);

  },

};



let pickerSelectionStore: PickerSelectionStore = mongoPickerSelectionStore;



export function getPickerSelectionStore(): PickerSelectionStore {

  return pickerSelectionStore;

}



export function setPickerSelectionStoreForTests(

  store: PickerSelectionStore | undefined,

): void {

  pickerSelectionStore = store ?? mongoPickerSelectionStore;

}



export function resetPickerVerificationStoresForTests(): void {

  setPickerNonceStoreForTests(undefined);

  setPickerSelectionStoreForTests(undefined);

}

