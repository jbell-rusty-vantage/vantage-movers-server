import {
  easternDateTimeParts,
  easternWallClockToUtc,
} from "../../utils/easternTime";

/** Exclusive end of the no-send window: 00:00 inclusive through 07:00 exclusive. */
export const LEAD_SMS_QUIET_HOUR_END = 7;
/** Wall-clock hour in America/New_York to send deferred overnight messages. */
export const LEAD_SMS_DEFERRED_SEND_HOUR = 8;

/**
 * If `now` is in the Eastern quiet window (midnight through 6:59:59 AM
 * America/New_York), return the UTC instant for 8:00 AM that same Eastern
 * calendar day so Twilio can schedule the send. Otherwise return null and
 * the message should go out immediately.
 */
export function resolveLeadSmsQuietHoursDeferral(now: Date): Date | null {
  const parts = easternDateTimeParts(now);
  if (parts.hour >= LEAD_SMS_QUIET_HOUR_END) return null;

  const sendAt = easternWallClockToUtc(
    parts.year,
    parts.month,
    parts.day,
    LEAD_SMS_DEFERRED_SEND_HOUR,
  );
  if (!sendAt) {
    throw new Error(
      "Could not resolve 8:00 AM America/New_York for lead SMS quiet-hours deferral",
    );
  }
  return sendAt;
}
