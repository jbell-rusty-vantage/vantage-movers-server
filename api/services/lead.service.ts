import { Lead, type LeadDocument } from "../models/Lead";
import { generateLeadId } from "../utils/ids";
import { type CreateLeadInput } from "../validation/lead.validation";
import { syncLeadToSheets } from "./googleSheets.service";

export class LeadSheetSyncError extends Error {
  constructor(
    message: string,
    public readonly leadId: string,
  ) {
    super(message);
    this.name = "LeadSheetSyncError";
  }
}

export async function createLead(input: CreateLeadInput): Promise<LeadDocument> {
  const lead = await Lead.create({
    ...input,
    refNo: input.refNo?.trim() || "not provided",
    leadId: generateLeadId(),
    timestamp: new Date(),
    sheetSyncStatus: "pending",
    updatedSinceLastSheetSync: false,
  });

  try {
    const syncResult = await syncLeadToSheets(lead);
    const syncedLead = await Lead.findByIdAndUpdate(
      lead._id,
      {
        $set: {
          sheetSyncStatus: "synced",
          sheetSyncedAt: new Date(),
          sheetSyncError: undefined,
          mainSheetRowNumber: syncResult.mainSheetRowNumber,
          companySheetName: syncResult.companySheetName,
          companySheetRowNumber: syncResult.companySheetRowNumber,
          updatedSinceLastSheetSync: false,
        },
      },
      { returnDocument: "after" },
    ).orFail();

    return syncedLead;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sheets sync error";
    await Lead.findByIdAndUpdate(lead._id, {
      $set: {
        sheetSyncStatus: "failed",
        sheetSyncError: message,
        updatedSinceLastSheetSync: false,
      },
    });

    throw new LeadSheetSyncError(message, lead.leadId);
  }
}
