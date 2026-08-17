import { findRingCentralCallSession } from "../ringcentral/call-session-store";

export type RingCentralTelephonyProvenanceInput = {
  source_receipt_id: string | null;
  source_connection_key: string | null;
};

export async function verifyTrustedRingCentralTelephonyProvenance(
  input: RingCentralTelephonyProvenanceInput,
): Promise<boolean> {
  const telephonySessionId = input.source_receipt_id?.trim();
  if (!telephonySessionId) {
    return false;
  }
  const session = await findRingCentralCallSession(telephonySessionId);
  return session != null && session.telephonySessionId === telephonySessionId;
}
