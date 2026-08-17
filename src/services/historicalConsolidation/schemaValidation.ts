import { ObjectId } from "mongodb";
import type { Model } from "mongoose";
import { Agent } from "../../models/Agent";
import { Merchant } from "../../models/Merchant";
import { LeadSourceCompany } from "../../models/LeadSourceCompany";
import { LeadSourceGranularity } from "../../models/LeadSourceGranularity";
import { OperationsRegistryChange } from "../../models/OperationsRegistryChange";
import { Customer } from "../../models/Customer";
import { FormLead } from "../../models/FormLead";
import { CallLead } from "../../models/CallLead";
import { BookedLead } from "../../models/BookedLead";
import { CancelledLead } from "../../models/CancelledLead";
import { comparable, materializeMongoValue } from "./mongoValues";
import type { HistoricalOperation } from "./types";

/** Schema defaults/hooks may attach these on insert. They are not sheet-planned facts. */
const SERVER_OWNED_REVISION_DEFAULTS = new Set([
  "domain_revision",
  "change_history_started_at",
  "granot_contact_revision",
  "quoted",
]);

type ParityRecord = Record<string, unknown>;

const MODELS: Record<HistoricalOperation["model"], Model<ParityRecord>> = {
  Agent: Agent as unknown as Model<ParityRecord>,
  Merchant: Merchant as unknown as Model<ParityRecord>,
  LeadSourceCompany: LeadSourceCompany as unknown as Model<ParityRecord>,
  LeadSourceGranularity: LeadSourceGranularity as unknown as Model<ParityRecord>,
  OperationsRegistryChange: OperationsRegistryChange as unknown as Model<ParityRecord>,
  Customer: Customer as unknown as Model<ParityRecord>,
  FormLead: FormLead as unknown as Model<ParityRecord>,
  CallLead: CallLead as unknown as Model<ParityRecord>,
  BookedLead: BookedLead as unknown as Model<ParityRecord>,
  CancelledLead: CancelledLead as unknown as Model<ParityRecord>,
};

export function validateManifestOperations(operations: HistoricalOperation[]): void {
  for (const operation of operations) {
    const ModelCtor = MODELS[operation.model];
    if (operation.action === "insert") {
      const expected = { _id: new ObjectId(operation.target_id), ...(materializeMongoValue(operation.document ?? {}) as Record<string, unknown>) };
      const document = new ModelCtor(expected);
      const validation = document.validateSync();
      if (validation) throw new Error(`Production schema rejected ${operation.operation_id}: ${validation.message}`);
      const serialized = document.toObject({ depopulate: true, virtuals: false, versionKey: false, minimize: true });
      const unexpected = Object.keys(serialized).filter(
        (key) => !(key in expected) && !SERVER_OWNED_REVISION_DEFAULTS.has(key),
      );
      if (unexpected.length) throw new Error(`Production schema introduced unplanned fields for ${operation.operation_id}: ${unexpected.join(", ")}`);
      for (const [field, value] of Object.entries(expected)) {
        if (JSON.stringify(comparable(serialized[field])) !== JSON.stringify(comparable(value))) throw new Error(`Production schema changed planned field ${field} for ${operation.operation_id}`);
      }
    } else {
      for (const [field, value] of Object.entries(operation.set ?? {})) {
        validateUpdateField(ModelCtor, operation.operation_id, field, value);
      }
    }
  }
}

function validateUpdateField(
  ModelCtor: Model<ParityRecord>,
  operationId: string,
  field: string,
  value: unknown,
): void {
  const materialized = materializeMongoValue(value);
  const schemaType = ModelCtor.schema.path(field);
  if (schemaType) {
    const cast = schemaType.cast(materialized);
    if (JSON.stringify(comparable(cast)) !== JSON.stringify(comparable(materialized))) {
      throw new Error(`Production schema changed update field ${field} for ${operationId}`);
    }
    return;
  }
  if (
    ModelCtor.schema.pathType(field) === "nested" &&
    materialized !== null &&
    typeof materialized === "object" &&
    !Array.isArray(materialized)
  ) {
    for (const [nestedField, nestedValue] of Object.entries(materialized as Record<string, unknown>)) {
      validateUpdateField(ModelCtor, operationId, `${field}.${nestedField}`, nestedValue);
    }
    return;
  }
  throw new Error(`Update ${operationId} targets unknown production field ${field}`);
}
