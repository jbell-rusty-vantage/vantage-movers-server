import type { EffectiveCapability } from "./types";

export function resolveEffectiveCapability(input: {
  required_configuration_present: boolean;
  deployment_gate: boolean;
  owner_intent: boolean;
}): EffectiveCapability {
  const reasons: string[] = [];
  if (!input.required_configuration_present) {
    reasons.push("required_configuration_missing");
  }
  if (!input.deployment_gate) {
    reasons.push("deployment_gate_disabled");
  }
  if (!input.owner_intent) {
    reasons.push("owner_intent_disabled");
  }
  return {
    env_configured: input.required_configuration_present,
    env_enabled: input.deployment_gate,
    owner_enabled: input.owner_intent,
    effective_enabled:
      input.required_configuration_present &&
      input.deployment_gate &&
      input.owner_intent,
    reasons,
  };
}
