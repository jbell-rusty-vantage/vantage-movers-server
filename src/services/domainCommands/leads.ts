import {
  runExistingCreateCallLead,
  runExistingCreateFormLead,
  runExistingDeleteCallLead,
  runExistingDeleteFormLead,
  runExistingUpdateSourceOwnedLead,
} from "./existingWrites";
import type {
  CanonicalCommandContext,
  CompatibilityCanonicalCommandResult,
} from "./types";

export async function createFormLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return (await runExistingCreateFormLead(input)).command;
}

export async function createCallLead(input: {
  data: unknown;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return (await runExistingCreateCallLead(input)).command;
}

export async function updateSourceOwnedLead(input: {
  lead_model: "FormLead" | "CallLead";
  lead_id: string;
  patch: Record<string, unknown>;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return (await runExistingUpdateSourceOwnedLead(input)).command;
}

export async function deleteFormLead(input: {
  lead_id: string;
  cascade: boolean;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return runExistingDeleteFormLead(input);
}

export async function deleteCallLead(input: {
  lead_id: string;
  cascade: boolean;
  context: CanonicalCommandContext;
}): Promise<CompatibilityCanonicalCommandResult> {
  return runExistingDeleteCallLead(input);
}
