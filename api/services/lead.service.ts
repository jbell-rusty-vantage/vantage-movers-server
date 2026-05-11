import { Lead, type LeadDocument } from "../models/Lead";
import { findCompanySource, getCompanySourceBySite } from "../utils/companySources";
import { generateLeadId } from "../utils/ids";
import { getStateCodeForZip } from "../utils/pickupZipState";
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
  const locationStateFields = await getLeadLocationStateFields(
    input.pickupZip,
    input.destinationZip,
  );
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
    ...locationStateFields,
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

  const locationStateFields = await getLeadLocationStateFields(
    input.pickupZip ?? existingLead.pickupZip,
    input.destinationZip ?? existingLead.destinationZip,
    {
      pickup_state: input.pickupZip ? undefined : existingLead.pickup_state,
      delivery_state: input.destinationZip ? undefined : existingLead.delivery_state,
    },
  );
  updates.local = locationStateFields.local;

  if (locationStateFields.pickup_state) {
    updates.pickup_state = locationStateFields.pickup_state;
  } else {
    unset.pickup_state = "";
  }

  if (locationStateFields.delivery_state) {
    updates.delivery_state = locationStateFields.delivery_state;
  } else {
    unset.delivery_state = "";
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

async function getLeadLocationStateFields(
  pickupZip: string,
  destinationZip: string,
  fallback?: {
    pickup_state?: string | null;
    delivery_state?: string | null;
  },
): Promise<{
  pickup_state?: string;
  delivery_state?: string;
  local: boolean;
}> {
  const [pickup_state, delivery_state] = await Promise.all([
    getStateCodeForZip(pickupZip),
    getStateCodeForZip(destinationZip),
  ]);
  const resolvedPickupState = pickup_state ?? fallback?.pickup_state ?? undefined;
  const resolvedDeliveryState = delivery_state ?? fallback?.delivery_state ?? undefined;

  return {
    pickup_state: resolvedPickupState,
    delivery_state: resolvedDeliveryState,
    local: Boolean(
      resolvedPickupState &&
        resolvedDeliveryState &&
        resolvedPickupState === resolvedDeliveryState,
    ),
  };
}
