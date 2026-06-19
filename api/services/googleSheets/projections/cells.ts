import type {
  AgentAllocationSheetSource,
  PopulatedBookedLead,
} from "../types";

import {
  formatFloridaCalendarDateIso,
} from "../../../utils/easternTime";

export function formatDateOnly(value: Date): string {
  return formatFloridaCalendarDateIso(value);
}

export function formatTimestamp(value: Date): string {
  const date = `${value.getMonth() + 1}/${value.getDate()}/${value.getFullYear()}`;
  const time = [value.getHours(), value.getMinutes(), value.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");

  return `${date} ${time}`;
}

export function booleanCell(value: boolean): string {
  return value ? "TRUE" : "FALSE";
}

export function localCell(value: string | null | undefined): string {
  return value === "local" ? "local" : "long_distance";
}

export function optionalLocalCell(value: string | null | undefined): string {
  if (!value) {
    return "";
  }
  return localCell(value);
}

export function bookedCell(value: boolean): string {
  return value ? "booked" : "";
}

export function bookedDateCell(
  booking: PopulatedBookedLead | string | null | undefined,
): string {
  if (!booking || typeof booking === "string") {
    return "";
  }

  return formatDateOnly(booking.book_date);
}

export function overThresholdCell(value: boolean, label: ">2k" | ">4k"): string {
  return value ? label : "";
}

export function cancelledCell(value: boolean): string {
  return value ? "cancelled" : "";
}

export function quotedCell(value: boolean): string {
  return value ? "quoted" : "";
}

export function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined || Number.isNaN(value) ? "" : String(value);
}

export function primaryBookingAgent(booking?: PopulatedBookedLead): string {
  return booking?.agent_allocations?.[0]?.agent_name_snapshot ?? "";
}

export function splitCell(allocations: AgentAllocationSheetSource[]): string {
  const namedAllocations = allocations.filter((allocation) => allocation.agent_name_snapshot.trim());
  const nonZeroAmount = allocations.some((allocation) => allocation.binder_amount !== 0);
  return namedAllocations.length >= 2 && allocations.length >= 2 && nonZeroAmount ? "TRUE" : "FALSE";
}
