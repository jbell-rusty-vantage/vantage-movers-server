// Canonical Service / Rule pairs from the Tariff Adjustment Drop Downs tab.
// Linehaul ranges and Binding Estimate Fee are automatic. Owner-chosen groups
// are the remaining Services. Keep this file in lockstep with
// granot_sync_extensions_and_services/src/workflows/tariff-adjustment/catalog.ts

export const LINEHAUL_SERVICE = "Linehaul";
export const BINDING_ESTIMATE_FEE_SERVICE = "Binding Estimate Fee";
export const BINDING_ESTIMATE_FEE_RULE = "Binding Estimate Fee";

export const LINEHAUL_RANGES = [
  { label: "0 to 300 c.f.", min: 0, max: 300 },
  { label: "301 to 500 c.f", min: 301, max: 500 },
  { label: "501 to 1,000 c.f.", min: 501, max: 1000 },
  { label: "1,001 to 1,500 c.f.", min: 1001, max: 1500 },
  { label: "1,501 to 2,000 c.f.", min: 1501, max: 2000 },
  { label: "2,001 to 2,500 c.f.", min: 2001, max: 2500 },
  { label: "2,501 to 3,000 c.f.", min: 2501, max: 3000 },
  { label: "3,000 + c.f.", min: 3001, max: Number.POSITIVE_INFINITY },
] as const;

export const LINEHAUL_RULES = LINEHAUL_RANGES.map((range) => range.label);

export const OWNER_TARIFF_SERVICE_RULES = {
  "P.G.S.": [
    "Guaranteed Pickup Day",
    "Guaranteed Delivery Day",
    "Expedited Delivery",
    "Direct Delivery",
    "Extra Stop",
  ],
  "Accesorial Services": ["Stair Fee", "Shuttle Fee", "Long Carry Fee"],
  "Packing Services": [
    "Full Pack",
    "Full Unpack",
    "Crating Service",
    "Partial Packing Service",
  ],
  "Bulk Fee": [
    "Piano",
    "Gun Safe",
    "Kayak / Canoe",
    "Exercise Equipment",
    "Golf Cart",
    "Motorcycle",
    "Riding Mower",
    "ATV",
    "Dirtbike",
    "Pool Table",
    "Misc Large Equipment",
  ],
} as const;

export const OWNER_TARIFF_SERVICES = Object.keys(
  OWNER_TARIFF_SERVICE_RULES,
) as Array<keyof typeof OWNER_TARIFF_SERVICE_RULES>;

export const TARIFF_SERVICE_RULES = {
  [LINEHAUL_SERVICE]: LINEHAUL_RULES,
  [BINDING_ESTIMATE_FEE_SERVICE]: [BINDING_ESTIMATE_FEE_RULE],
  ...OWNER_TARIFF_SERVICE_RULES,
} as const;

export function mapLinehaulCubicFeetToRule(
  cubicFeet: number,
): string | undefined {
  if (!Number.isFinite(cubicFeet) || cubicFeet < 0) {
    return undefined;
  }
  const whole = Math.floor(cubicFeet);
  return LINEHAUL_RANGES.find((range) => whole >= range.min && whole <= range.max)
    ?.label;
}

export function rulesForTariffService(service: string): readonly string[] {
  return TARIFF_SERVICE_RULES[service as keyof typeof TARIFF_SERVICE_RULES] ?? [];
}

export function isCatalogTariffPair(service: string, rule: string): boolean {
  return rulesForTariffService(service).includes(rule);
}

export function isBindingEstimateFeeLabel(value: string): boolean {
  return /^binding estimate fee$/i.test(value.trim());
}
