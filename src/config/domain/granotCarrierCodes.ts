/**
 * Known Granot Carrier Codes from the Owner name map.
 * Runtime Tariff Adjustment resolve reads `moving_carriers.granot_carrier_code`.
 * This catalog is the seed list used to stamp those codes by DOT.
 */
export const GRANOT_CARRIER_CODE_SEEDS = [
  { granot_carrier_code: "ALLROAD", dot_number: "1883785" },
  { granot_carrier_code: "ALLSAFE", dot_number: "3453793" },
  { granot_carrier_code: "AMERIPRO", dot_number: "2789352" },
  { granot_carrier_code: "ARROW", dot_number: "3365195" },
  { granot_carrier_code: "BESTMOVING", dot_number: "3374800" },
  { granot_carrier_code: "BOLD", dot_number: "3139358" },
  { granot_carrier_code: "C2C", dot_number: "4168983" },
  { granot_carrier_code: "COBRA", dot_number: "4309696" },
  { granot_carrier_code: "ICV", dot_number: "4158039" },
  { granot_carrier_code: "EMINA", dot_number: "4246939" },
  { granot_carrier_code: "FABRI", dot_number: "4027429" },
  { granot_carrier_code: "FCM", dot_number: "3846816" },
  { granot_carrier_code: "GUTZ", dot_number: "4570153" },
  { granot_carrier_code: "JUSTPRO", dot_number: "3925031" },
  { granot_carrier_code: "LOADRANS", dot_number: "3729978" },
  { granot_carrier_code: "PVG", dot_number: "2338933" },
  { granot_carrier_code: "RIGOS", dot_number: "2824890" },
  { granot_carrier_code: "ROYS", dot_number: "2428059" },
  { granot_carrier_code: "SHIFT", dot_number: "4197619" },
  { granot_carrier_code: "SUNBELT", dot_number: "3949200" },
  { granot_carrier_code: "TXMOVING", dot_number: "3266915" },
] as const;

export type GranotCarrierCodeSeed = (typeof GRANOT_CARRIER_CODE_SEEDS)[number];

export function normalizeGranotCarrierCode(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}
