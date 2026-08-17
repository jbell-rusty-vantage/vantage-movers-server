import {
  runExistingCreateCancellation,
  runExistingDeleteCancelledLead,
  runExistingUpdateCancelledLead,
} from "./existingWrites";
import type {
  CanonicalCommandContext,
  CompatibilityCanonicalCommandResult,
} from "./types";

export async function createCancellation(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return (await runExistingCreateCancellation(input)).command;
}

export async function updateCancelledLead(input: {
  cancellation_id: string;
  patch: Record<string, unknown>;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return (await runExistingUpdateCancelledLead(input)).command;
}

export async function deleteCancelledLead(input: {
  cancellation_id: string;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return runExistingDeleteCancelledLead(input);
}
