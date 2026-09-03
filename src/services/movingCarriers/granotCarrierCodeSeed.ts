import {
  GRANOT_CARRIER_CODE_SEEDS,
  normalizeGranotCarrierCode,
} from "../../config/domain/granotCarrierCodes";

export type GranotCarrierCodeSeedRow = {
  dot_number: string;
  granot_carrier_code?: string | null;
};

export type GranotCarrierCodeSeedPlan = {
  granot_carrier_code: string;
  dot_number: string;
  outcome: "missing" | "already_set" | "will_set" | "will_replace";
  current_code?: string;
};

export function planGranotCarrierCodeSeed(
  carriers: GranotCarrierCodeSeedRow[],
  seeds = GRANOT_CARRIER_CODE_SEEDS,
): GranotCarrierCodeSeedPlan[] {
  const byDot = new Map(
    carriers.map((carrier) => [normalizeCarrierNumber(carrier.dot_number), carrier]),
  );

  return seeds.map((seed) => {
    const code = normalizeGranotCarrierCode(seed.granot_carrier_code);
    const carrier = byDot.get(normalizeCarrierNumber(seed.dot_number));
    if (!carrier) {
      return {
        granot_carrier_code: code,
        dot_number: seed.dot_number,
        outcome: "missing",
      };
    }

    const current = carrier.granot_carrier_code
      ? normalizeGranotCarrierCode(carrier.granot_carrier_code)
      : "";
    if (current === code) {
      return {
        granot_carrier_code: code,
        dot_number: seed.dot_number,
        outcome: "already_set",
        current_code: current,
      };
    }
    if (current) {
      return {
        granot_carrier_code: code,
        dot_number: seed.dot_number,
        outcome: "will_replace",
        current_code: current,
      };
    }
    return {
      granot_carrier_code: code,
      dot_number: seed.dot_number,
      outcome: "will_set",
    };
  });
}

function normalizeCarrierNumber(value: string): string {
  return value.trim().replace(/\s+/g, "");
}
