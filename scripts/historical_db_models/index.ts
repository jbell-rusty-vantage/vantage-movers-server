import mongoose, { type Connection, type Model } from "mongoose";
import { registerHistoricalAgent } from "./Agent";
import { registerHistoricalBookedLead } from "./BookedLead";
import { registerHistoricalCallLead } from "./CallLead";
import { registerHistoricalCancelledLead } from "./CancelledLead";
import { registerHistoricalCustomer } from "./Customer";
import { registerHistoricalFormLead } from "./FormLead";

export const HISTORICAL_DATABASE_NAME = "vantagemovershistorical";

export function getHistoricalConnection(): Connection {
  return mongoose.connection.useDb(HISTORICAL_DATABASE_NAME, { useCache: true });
}

export function registerHistoricalModels(connection: Connection = getHistoricalConnection()) {
  const Agent = registerHistoricalAgent(connection);
  const Customer = registerHistoricalCustomer(connection);
  const FormLead = registerHistoricalFormLead(connection);
  const CallLead = registerHistoricalCallLead(connection);
  const BookedLead = registerHistoricalBookedLead(connection);
  const CancelledLead = registerHistoricalCancelledLead(connection);

  return { Agent, Customer, FormLead, CallLead, BookedLead, CancelledLead };
}

export function getHistoricalModelList(
  models: ReturnType<typeof registerHistoricalModels>,
): Model<unknown>[] {
  return [
    models.Agent,
    models.Customer,
    models.FormLead,
    models.CallLead,
    models.BookedLead,
    models.CancelledLead,
  ];
}

export {
  registerHistoricalAgent,
  registerHistoricalBookedLead,
  registerHistoricalCallLead,
  registerHistoricalCancelledLead,
  registerHistoricalCustomer,
  registerHistoricalFormLead,
};
