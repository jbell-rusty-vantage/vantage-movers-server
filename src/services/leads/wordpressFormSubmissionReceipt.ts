import type { ClientSession } from "mongoose";
import {
  getMongoDatabaseName,
  isTestMode,
} from "../../config/domain/runtime";
import {
  getWordpressFormSubmissionReceiptModel,
} from "../../models/WordpressFormSubmissionReceipt";
import { ServiceUnavailableError, ValidationError } from "../errors";
import type { FormLeadIngestionOrigin } from "../granotLifecycle/types";

export const WORDPRESS_SUBMISSION_KEY_MIN = 8;
export const WORDPRESS_SUBMISSION_KEY_MAX = 128;

export const TEST_WORDPRESS_RECEIPT_DATABASE =
  /^testvantagemovers(?:_[a-z0-9]+)?$/i;

export type WordpressReceiptProcessingStatus = "received" | "lead_created";

export type WordpressFormSubmissionReceiptRecord = {
  id: string;
  source_system: "wordpress";
  submission_key: string;
  received_at: Date;
  processing_status: WordpressReceiptProcessingStatus;
  lead_ref: { model: "FormLead"; id: string } | null;
  form_path: "test";
};

export type WordpressReceiptWriteAuthorization = {
  ingestionOrigin: FormLeadIngestionOrigin | string;
  testMode: boolean;
  databaseName: string;
};

export type WordpressReceiptStore = {
  insertReceived(input: {
    submission_key: string;
    received_at: Date;
    session?: ClientSession;
  }): Promise<WordpressFormSubmissionReceiptRecord>;
  findBySubmissionKey(
    submission_key: string,
    session?: ClientSession,
  ): Promise<WordpressFormSubmissionReceiptRecord | null>;
  attachLeadRef(input: {
    receipt_id: string;
    lead_id: string;
    session?: ClientSession;
  }): Promise<WordpressFormSubmissionReceiptRecord>;
};

export function wordpressReceiptWriteAuthorized(
  input: WordpressReceiptWriteAuthorization,
): boolean {
  return (
    input.ingestionOrigin === "wordpress_form" &&
    input.testMode === true &&
    TEST_WORDPRESS_RECEIPT_DATABASE.test(input.databaseName)
  );
}

export function isWordpressReceiptWriteAuthorized(
  ingestionOrigin: FormLeadIngestionOrigin | string,
): boolean {
  return wordpressReceiptWriteAuthorized({
    ingestionOrigin,
    testMode: isTestMode(),
    databaseName: getMongoDatabaseName(),
  });
}

export function resolveWordpressSubmissionKey(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const submission_key = value.trim();
  if (!submission_key) return null;
  if (
    submission_key.length < WORDPRESS_SUBMISSION_KEY_MIN ||
    submission_key.length > WORDPRESS_SUBMISSION_KEY_MAX
  ) {
    throw new ValidationError(
      "wordpress_submission_key must be 8 to 128 characters",
    );
  }
  return submission_key;
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === 11000,
  );
}

function asRecord(doc: {
  _id: { toString(): string };
  submission_key: string;
  received_at: Date;
  processing_status: WordpressReceiptProcessingStatus;
  lead_ref?: { model: "FormLead"; id: { toString(): string } } | null;
}): WordpressFormSubmissionReceiptRecord {
  return {
    id: doc._id.toString(),
    source_system: "wordpress",
    submission_key: doc.submission_key,
    received_at: doc.received_at,
    processing_status: doc.processing_status,
    lead_ref: doc.lead_ref
      ? { model: "FormLead", id: doc.lead_ref.id.toString() }
      : null,
    form_path: "test",
  };
}

export function createMongoWordpressReceiptStore(): WordpressReceiptStore {
  const Model = getWordpressFormSubmissionReceiptModel();
  return {
    async insertReceived(input) {
      try {
        const created = await Model.create(
          [
            {
              source_system: "wordpress",
              submission_key: input.submission_key,
              received_at: input.received_at,
              processing_status: "received",
              lead_ref: null,
              form_path: "test",
            },
          ],
          { session: input.session },
        );
        const doc = created[0];
        if (!doc) {
          throw new ServiceUnavailableError(
            "WordPress submission receipt capture failed; Form Lead was not created",
          );
        }
        return asRecord(doc);
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        const existing = await Model.findOne({
          submission_key: input.submission_key,
        }).session(input.session ?? null);
        if (!existing) throw error;
        return asRecord(existing);
      }
    },
    async findBySubmissionKey(submission_key, session) {
      const existing = await Model.findOne({ submission_key }).session(
        session ?? null,
      );
      return existing ? asRecord(existing) : null;
    },
    async attachLeadRef(input) {
      const updated = await Model.findOneAndUpdate(
        {
          _id: input.receipt_id,
          $or: [{ lead_ref: null }, { "lead_ref.id": input.lead_id }],
        },
        {
          $set: {
            processing_status: "lead_created",
            lead_ref: { model: "FormLead", id: input.lead_id },
          },
        },
        { new: true, session: input.session },
      );
      if (updated) return asRecord(updated);
      const current = await Model.findById(input.receipt_id).session(
        input.session ?? null,
      );
      if (!current) {
        throw new ServiceUnavailableError(
          "WordPress submission receipt disappeared before Lead attach",
        );
      }
      return asRecord(current);
    },
  };
}

export function createMemoryWordpressReceiptStore(hooks?: {
  onInsert?: (record: WordpressFormSubmissionReceiptRecord) => void;
}): WordpressReceiptStore & { list(): WordpressFormSubmissionReceiptRecord[] } {
  const rows = new Map<string, WordpressFormSubmissionReceiptRecord>();
  let nextId = 1;

  return {
    list() {
      return [...rows.values()];
    },
    async insertReceived(input) {
      const existing = [...rows.values()].find(
        (row) => row.submission_key === input.submission_key,
      );
      if (existing) {
        return existing;
      }
      const record: WordpressFormSubmissionReceiptRecord = {
        id: `wp-rcpt-${nextId++}`,
        source_system: "wordpress",
        submission_key: input.submission_key,
        received_at: input.received_at,
        processing_status: "received",
        lead_ref: null,
        form_path: "test",
      };
      rows.set(record.id, record);
      hooks?.onInsert?.(record);
      return record;
    },
    async findBySubmissionKey(submission_key) {
      return (
        [...rows.values()].find((row) => row.submission_key === submission_key) ??
        null
      );
    },
    async attachLeadRef(input) {
      const current = rows.get(input.receipt_id);
      if (!current) {
        throw new ServiceUnavailableError(
          "WordPress submission receipt disappeared before Lead attach",
        );
      }
      if (current.lead_ref && current.lead_ref.id !== input.lead_id) {
        return current;
      }
      const next: WordpressFormSubmissionReceiptRecord = {
        ...current,
        processing_status: "lead_created",
        lead_ref: { model: "FormLead", id: input.lead_id },
      };
      rows.set(next.id, next);
      return next;
    },
  };
}

export async function captureWordpressReceiptThenCreateLead(input: {
  authorization: WordpressReceiptWriteAuthorization;
  submissionKey: unknown;
  now: Date;
  store: WordpressReceiptStore;
  session?: ClientSession;
  createLead: () => Promise<{ leadId: string }>;
  leadExists?: (leadId: string) => Promise<boolean>;
}): Promise<{
  receipt: WordpressFormSubmissionReceiptRecord | null;
  createdLead: boolean;
  reusedLeadId: string | null;
}> {
  if (!wordpressReceiptWriteAuthorized(input.authorization)) {
    await input.createLead();
    return { receipt: null, createdLead: true, reusedLeadId: null };
  }

  const submission_key = resolveWordpressSubmissionKey(input.submissionKey);
  if (!submission_key) {
    await input.createLead();
    return { receipt: null, createdLead: true, reusedLeadId: null };
  }

  let receipt: WordpressFormSubmissionReceiptRecord;
  try {
    receipt = await input.store.insertReceived({
      submission_key,
      received_at: input.now,
      session: input.session,
    });
  } catch (error) {
    throw new ServiceUnavailableError(
      "WordPress submission receipt capture failed; Form Lead was not created",
      { cause: error instanceof Error ? error : undefined },
    );
  }

  if (receipt.lead_ref) {
    const exists = input.leadExists
      ? await input.leadExists(receipt.lead_ref.id)
      : true;
    if (!exists) {
      throw new ServiceUnavailableError(
        "WordPress submission receipt points at a missing Form Lead; refusing to invent a replacement",
      );
    }
    return {
      receipt,
      createdLead: false,
      reusedLeadId: receipt.lead_ref.id,
    };
  }

  const created = await input.createLead();
  const attached = await input.store.attachLeadRef({
    receipt_id: receipt.id,
    lead_id: created.leadId,
    session: input.session,
  });
  return { receipt: attached, createdLead: true, reusedLeadId: null };
}
