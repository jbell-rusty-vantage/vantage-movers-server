import { normalizeGranotCarrierCode } from "../../config/domain/granotCarrierCodes";
import { MovingCarrier } from "../../models/MovingCarrier";
import { V1ServiceError } from "../v1ServiceError";

export type TariffCarrierLookup = {
  name: string;
  dot_number: string;
};

export function formatTariffCarrierCell(carrier: TariffCarrierLookup): string {
  return `${carrier.name} ${carrier.dot_number}`;
}

export async function resolveTariffCarrierCell(
  granotCarrierCode: string,
  lookup: (code: string) => Promise<TariffCarrierLookup | null> = lookupMovingCarrierByGranotCode,
): Promise<string> {
  const code = normalizeGranotCarrierCode(granotCarrierCode);
  if (!code) {
    throw new V1ServiceError("Granot Carrier Code is required", 400);
  }

  const carrier = await lookup(code);
  if (!carrier) {
    throw new V1ServiceError(`Unknown Granot Carrier Code: ${code}`, 400);
  }

  return formatTariffCarrierCell(carrier);
}

async function lookupMovingCarrierByGranotCode(
  code: string,
): Promise<TariffCarrierLookup | null> {
  const doc = await MovingCarrier.findOne({ granot_carrier_code: code })
    .select({ name: 1, dot_number: 1 })
    .lean()
    .exec();
  if (!doc?.name || !doc.dot_number) {
    return null;
  }
  return { name: doc.name, dot_number: doc.dot_number };
}
