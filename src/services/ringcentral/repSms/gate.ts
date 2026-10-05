import { salesOutreachConfigurationLoader } from "../../salesOutreach/config/load";
import { minuteOfDay } from "../../salesOutreach/engine/calendar";

/**
 * Rep SMS capture is gated by the persisted desk control `controls.rep_sms_capture_enabled`
 * (sales_outreach_configuration), never by an environment flag. A missing, uninitialized or broken
 * configuration — or any read failure — means off (fail closed).
 */
export async function repSmsCaptureEnabled(): Promise<boolean> {
  try {
    const loaded = await salesOutreachConfigurationLoader.load();
    return loaded.state === "active" && loaded.value.controls.rep_sms_capture_enabled === true;
  } catch {
    return false;
  }
}

/** RINGCENTRAL-CAPTURE §5/§7: the staffed window the 5-minute safety poll runs in ([07:45, 20:30) New York). */
export const REP_SMS_POLL_TIMEZONE = "America/New_York";
export const REP_SMS_POLL_START_MINUTE = 7 * 60 + 45;
export const REP_SMS_POLL_END_MINUTE = 20 * 60 + 30;

export function inRepSmsPollWindow(now: Date): boolean {
  const minute = minuteOfDay(now.getTime(), REP_SMS_POLL_TIMEZONE);
  return minute >= REP_SMS_POLL_START_MINUTE && minute < REP_SMS_POLL_END_MINUTE;
}
