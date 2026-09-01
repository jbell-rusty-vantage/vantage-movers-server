import { compareGranotTemporal } from "./granotTemporal";

export type BookingIntakeLatestAction = "booked" | "release" | "priority_5";

export type BookingIntakeLatestActionEvidence = {
  action: BookingIntakeLatestAction;
  captured_at: Date;
  observation_id: string;
};

export function selectBookingIntakeLatestAction(
  evidence: BookingIntakeLatestActionEvidence[],
): BookingIntakeLatestAction | undefined {
  if (evidence.length === 0) return undefined;

  const bookingEvidence = evidence.filter(
    (row) => row.action === "booked" || row.action === "release",
  );
  const considered = bookingEvidence.length > 0 ? bookingEvidence : evidence;
  let latest = considered[0]!;
  for (const row of considered.slice(1)) {
    if (compareGranotTemporal(row, latest) === "newer") {
      latest = row;
    }
  }
  return latest.action;
}
