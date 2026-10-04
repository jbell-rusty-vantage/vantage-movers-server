import type { Model } from "mongoose";
import { BookedLead } from "../../models/BookedLead";
import { CallLead } from "../../models/CallLead";
import { CancelledLead } from "../../models/CancelledLead";
import { FormLead } from "../../models/FormLead";

export type AdminResource =
  | "form-leads"
  | "call-leads"
  | "booked-leads"
  | "cancelled-leads";

export type AdminModels = Record<AdminResource, Model<unknown>>;

export function getAdminModels(): AdminModels {
  return {
    "form-leads": FormLead as Model<unknown>,
    "call-leads": CallLead as Model<unknown>,
    "booked-leads": BookedLead as Model<unknown>,
    "cancelled-leads": CancelledLead as Model<unknown>,
  };
}
