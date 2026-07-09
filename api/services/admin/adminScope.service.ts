import type { Model } from "mongoose";
import { Agent } from "../../models/Agent";
import { BookedLead } from "../../models/BookedLead";
import { CallLead } from "../../models/CallLead";
import { CancelledLead } from "../../models/CancelledLead";
import { Customer } from "../../models/Customer";
import { FormLead } from "../../models/FormLead";
import type { AdminDatabaseScope } from "../../validation/v1.validation";
// Historical models target the separate vantagemovershistorical DB and are only
// selected when admin callers pass database_scope=historical (or combined).
import { registerHistoricalModels } from "../../models/historical";

export type AdminResource =
  | "form-leads"
  | "call-leads"
  | "booked-leads"
  | "cancelled-leads"
  | "customers"
  | "agents";

export type ConcreteAdminScope = Exclude<AdminDatabaseScope, "combined">;

export type AdminModels = Record<AdminResource, Model<unknown>>;

export function getAdminModels(scope: ConcreteAdminScope): AdminModels {
  if (scope === "historical") {
    const historical = registerHistoricalModels();
    return {
      "form-leads": historical.FormLead as Model<unknown>,
      "call-leads": historical.CallLead as Model<unknown>,
      "booked-leads": historical.BookedLead as Model<unknown>,
      "cancelled-leads": historical.CancelledLead as Model<unknown>,
      customers: historical.Customer as Model<unknown>,
      agents: historical.Agent as Model<unknown>,
    };
  }

  return {
    "form-leads": FormLead as Model<unknown>,
    "call-leads": CallLead as Model<unknown>,
    "booked-leads": BookedLead as Model<unknown>,
    "cancelled-leads": CancelledLead as Model<unknown>,
    customers: Customer as Model<unknown>,
    agents: Agent as Model<unknown>,
  };
}

export function concreteScopes(
  scope: AdminDatabaseScope,
): ConcreteAdminScope[] {
  return scope === "combined" ? ["production", "historical"] : [scope];
}

export function rejectCombinedDetailScope(
  scope: AdminDatabaseScope,
): ConcreteAdminScope {
  if (scope === "combined") {
    throw new Error(
      "Detail endpoints support production or historical scope, not combined",
    );
  }
  return scope;
}
