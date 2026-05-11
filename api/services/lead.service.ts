import { Lead, type LeadDocument } from "../models/Lead";
import { findCompanySource, getCompanySourceBySite } from "../utils/companySources";
import { generateLeadId } from "../utils/ids";
import { getStateCodeForPickupZip } from "../utils/pickupZipState";
import { type CreateLeadInput, type UpdateLeadInput } from "../validation/lead.validation";
import { syncLeadToSheets, updateLeadInSheets } from "./googleSheets.service";

export class LeadSheetSyncError extends Error {
  constructor(
    message: string,
    public readonly leadId: string,
  ) {
    super(message);
    this.name = "LeadSheetSyncError";
  }
}

export class LeadCompanySourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadCompanySourceError";
  }
}

export async function createLead(input: CreateLeadInput): Promise<LeadDocument> {
  const State = await getStateCodeForPickupZip(input.pickupZip);
  const companySource =
    findCompanySource(input.sourceCompanySite) ??
    (input.sourceCompanyLabel ? findCompanySource(input.sourceCompanyLabel) : undefined);
  if (!companySource) {
    throw new LeadCompanySourceError(
      `Unknown lead company source: ${input.sourceCompanySite || input.sourceCompanyLabel}`,
    );
  }

  const lead = await Lead.create({
    ...input,
    refNo: input.refNo?.trim() || "not provided",
    State,
    sourceCompanyLabel: companySource.company,
    sourceCompanySite: companySource.site,
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
          companySpreadsheetId: syncResult.companySpreadsheetId,
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

export async function updateLead(
  leadMongoId: string,
  input: UpdateLeadInput,
): Promise<LeadDocument | null> {
  const existingLead = await Lead.findById(leadMongoId);
  if (!existingLead) {
    return null;
  }

  const updates: Record<string, unknown> = {
    ...input,
    sheetSyncStatus: "pending",
    updatedSinceLastSheetSync: true,
  };
  const unset: Record<string, ""> = {
    sheetSyncError: "",
  };

  if ("refNo" in input) {
    updates.refNo = input.refNo?.trim() || "not provided";
  }

  if (input.pickupZip) {
    const State = await getStateCodeForPickupZip(input.pickupZip);
    if (State) {
      updates.State = State;
    } else {
      unset.State = "";
    }
  }

  if (input.sourceCompanySite || input.sourceCompanyLabel) {
    const lookupValue = input.sourceCompanySite ?? input.sourceCompanyLabel;
    const companySource = lookupValue ? findCompanySource(lookupValue) : undefined;
    if (!companySource) {
      throw new LeadCompanySourceError(`Unknown lead company source: ${lookupValue}`);
    }

    updates.sourceCompanyLabel = companySource.company;
    updates.sourceCompanySite = companySource.site;
  } else {
    const companySource = getCompanySourceBySite(existingLead.sourceCompanySite);
    if (companySource) {
      updates.sourceCompanyLabel = companySource.company;
      updates.sourceCompanySite = companySource.site;
    }
  }

  const updatedLead = await Lead.findByIdAndUpdate(
    existingLead._id,
    {
      $set: updates,
      $unset: unset,
    },
    { returnDocument: "after" },
  ).orFail();

  try {
    const syncResult = await updateLeadInSheets(updatedLead);
    const syncedLead = await Lead.findByIdAndUpdate(
      updatedLead._id,
      {
        $set: {
          sheetSyncStatus: "synced",
          sheetSyncedAt: new Date(),
          mainSheetRowNumber: syncResult.mainSheetRowNumber,
          companySpreadsheetId: syncResult.companySpreadsheetId,
          companySheetName: syncResult.companySheetName,
          companySheetRowNumber: syncResult.companySheetRowNumber,
          updatedSinceLastSheetSync: false,
        },
        $unset: {
          sheetSyncError: "",
        },
      },
      { returnDocument: "after" },
    ).orFail();

    return syncedLead;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Sheets sync error";
    await Lead.findByIdAndUpdate(updatedLead._id, {
      $set: {
        sheetSyncStatus: "failed",
        sheetSyncError: message,
        updatedSinceLastSheetSync: true,
      },
    });

    throw new LeadSheetSyncError(message, updatedLead.leadId);
  }
}
