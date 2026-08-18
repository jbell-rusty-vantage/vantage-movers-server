import type { ChannelOperationKind } from "./types";

export const EXTENSION_APPLY_ITEM_SCHEMA_HINT = "extension_granot_apply_item_v1";
export const AUTOMATION_APPLY_ITEM_SCHEMA_HINT = "granot_apply_item_v1";

export const GRANOT_APPLY_ITEM_SCHEMA_HINTS = [
  EXTENSION_APPLY_ITEM_SCHEMA_HINT,
  AUTOMATION_APPLY_ITEM_SCHEMA_HINT,
] as const;

export type GranotApplyItemSchemaHint =
  (typeof GRANOT_APPLY_ITEM_SCHEMA_HINTS)[number];

export type GranotApplyItem = {
  operation_id: string;
  operation_kind: ChannelOperationKind;
  granot_statement: Record<string, string | number | null>;
  expected_target?: { model: "FormLead" | "CallLead"; id: string };
};

export function isRecognizedApplyItemHint(
  hint: string | undefined,
): hint is GranotApplyItemSchemaHint {
  return (
    hint === EXTENSION_APPLY_ITEM_SCHEMA_HINT ||
    hint === AUTOMATION_APPLY_ITEM_SCHEMA_HINT
  );
}
