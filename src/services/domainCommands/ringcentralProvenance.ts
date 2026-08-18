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
  const connection = input.source_connection_key?.trim();
  if (
    connection ===
    `ringcentral:call_log_sync:${telephonySessionId}`
  ) {
    // Call Log qualification is performed inside the server's shared ingest
    // seam. The adoption command independently revalidates the active route,
    // call start, scope, and bounded identity inside its transaction.
    return true;
  }
  const session = await findRingCentralCallSession(telephonySessionId);
  return (
    connection === `ringcentral:webhook:${telephonySessionId}` &&
    session != null &&
    session.telephonySessionId === telephonySessionId
  );
}
