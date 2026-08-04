import { normalizePhoneNumberForMatch } from "../../utils/phone";
import {
  nameTokens,
  normalizePersonName,
  toDateKeyFromRaw,
} from "./parsing";
import type {
  LeadBookingMatch,
  LeadMatchMethod,
  LidBestReloEntry,
  ParsedBookedDeal,
  ParsedCallLead,
  ParsedFormLead,
  ParsedRefund,
  RefundBookingMatch,
  RefundMatchMethod,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetweenKeys(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS));
}

function bookingDateKey(row: ParsedBookedDeal): string | undefined {
  return toDateKeyFromRaw(row.provenance.raw["Book Date"]) ?? toDateKeyFromRaw(row.book_date);
}

function callDateKey(row: ParsedCallLead): string | undefined {
  return toDateKeyFromRaw(row.date) ?? toDateKeyFromRaw(row.timestamp);
}

function withinNameDateWindow(leadMs?: number, bookMs?: number): boolean {
  return Boolean(
    leadMs &&
      bookMs &&
      leadMs >= bookMs - 90 * DAY_MS &&
      leadMs <= bookMs + DAY_MS,
  );
}

function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const prior = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = prior;
    }
  }
  return previous[b.length];
}

function fuzzyNameScore(bookedName: string, formName: string): number {
  const booked = normalizePersonName(bookedName);
  const form = normalizePersonName(formName);
  if (!booked || !form) return 0;
  if (booked === form) return 1;
  let best = 0;
  for (const candidate of [booked, ...nameTokens(bookedName)]) {
    if (candidate === form) {
      best = Math.max(best, 0.98);
      continue;
    }
    const bookedParts = candidate.split(/\s+/);
    const formParts = form.split(/\s+/);
    const bookedLast = bookedParts.at(-1) ?? "";
    const formLast = formParts.at(-1) ?? "";
    if (bookedLast.length < 3 || bookedLast !== formLast) continue;
    const bookedFirst = bookedParts[0] ?? "";
    const formFirst = formParts[0] ?? "";
    if (bookedFirst === formFirst) best = Math.max(best, 0.95);
    else if (levenshtein(bookedFirst, formFirst) <= 1) best = Math.max(best, 0.88);
  }
  return best;
}

function truthyFlag(value: string): boolean {
  return /booked|yes|true|>\s*[24]k|over\s*[24]000/i.test(value);
}

function amountTier(amount?: number): 0 | 2 | 4 {
  if ((amount ?? 0) >= 4000) return 4;
  if ((amount ?? 0) >= 2000) return 2;
  return 0;
}

function callAmountTier(call: ParsedCallLead): 0 | 2 | 4 {
  if (truthyFlag(call.over_4000)) return 4;
  if (truthyFlag(call.over_2000)) return 2;
  return 0;
}

function bookingAmountTier(booking: ParsedBookedDeal): 0 | 2 | 4 {
  return amountTier(Math.max(booking.binder_amount ?? 0, booking.deposit_amount ?? 0));
}

function extractPhones(value: string): string[] {
  return (value.match(/\d[\d\s().-]{7,}\d/g) ?? [])
    .map(normalizePhoneNumberForMatch)
    .filter((phone): phone is string => Boolean(phone));
}

export function matchLeadsToBookings(input: {
  forms: ParsedFormLead[];
  localForms: ParsedFormLead[];
  calls: ParsedCallLead[];
  booked: ParsedBookedDeal[];
  lidBestRelo: LidBestReloEntry[];
}): { matches: LeadBookingMatch[]; unmatchedBookings: ParsedBookedDeal[] } {
  const forms = [...input.forms, ...input.localForms];
  const bookings = input.booked.filter((row) => row.is_best_relocation_source);
  const matches: LeadBookingMatch[] = [];
  const matchedBookings = new Set<number>();
  const usedForms = new Set<string>();
  const usedCalls = new Set<string>();
  const formKey = (row: ParsedFormLead) => `${row.source_tab}:${row.sheet_row}`;
  const callKey = (row: ParsedCallLead) => `${row.source_tab}:${row.sheet_row}`;

  const byLid = new Map<string, ParsedFormLead>();
  const byRef = new Map<string, ParsedFormLead>();
  const byName = new Map<string, ParsedFormLead[]>();
  const byToken = new Map<string, ParsedFormLead[]>();
  const callsByPhone = new Map<string, ParsedCallLead[]>();
  for (const form of forms) {
    if (form.lead_id) {
      const key = form.lead_id.toLowerCase();
      const existing = byLid.get(key);
      if (!existing || (form.timestamp_ms ?? 0) > (existing.timestamp_ms ?? 0)) {
        byLid.set(key, form);
      }
    }
    if (form.ref_no) {
      const key = form.ref_no.toLowerCase();
      const existing = byRef.get(key);
      if (!existing || (form.timestamp_ms ?? 0) > (existing.timestamp_ms ?? 0)) {
        byRef.set(key, form);
      }
    }
    if (form.normalized_name) {
      byName.set(form.normalized_name, [...(byName.get(form.normalized_name) ?? []), form]);
    }
    for (const token of form.name_tokens) {
      byToken.set(token, [...(byToken.get(token) ?? []), form]);
    }
  }
  for (const candidates of [...byName.values(), ...byToken.values()]) {
    candidates.sort((a, b) => (b.timestamp_ms ?? 0) - (a.timestamp_ms ?? 0));
  }
  for (const call of input.calls) {
    if (call.normalized_phone) {
      callsByPhone.set(call.normalized_phone, [
        ...(callsByPhone.get(call.normalized_phone) ?? []),
        call,
      ]);
    }
  }
  const lidMembership = new Map(
    input.lidBestRelo.map((entry) => [entry.lid.toLowerCase(), entry]),
  );

  const pushForm = (
    booking: ParsedBookedDeal,
    row: ParsedFormLead,
    method: LeadMatchMethod,
    confidence: number,
    notes?: string,
  ) => {
    if (matchedBookings.has(booking.sheet_row)) return false;
    if (usedForms.has(formKey(row)) && method !== "lid_exact" && method !== "ref_no_exact") {
      return false;
    }
    matchedBookings.add(booking.sheet_row);
    usedForms.add(formKey(row));
    matches.push({ booking, lead: { kind: "form", row }, method, confidence, notes });
    return true;
  };
  const pushCall = (
    booking: ParsedBookedDeal,
    row: ParsedCallLead,
    method: LeadMatchMethod,
    confidence: number,
    notes?: string,
  ) => {
    if (matchedBookings.has(booking.sheet_row) || usedCalls.has(callKey(row))) return false;
    matchedBookings.add(booking.sheet_row);
    usedCalls.add(callKey(row));
    matches.push({ booking, lead: { kind: "call", row }, method, confidence, notes });
    return true;
  };

  for (const booking of bookings) {
    if (!booking.lid) continue;
    const key = booking.lid.toLowerCase();
    if (byLid.has(key)) pushForm(booking, byLid.get(key)!, "lid_exact", 1);
    else if (byRef.has(key)) pushForm(booking, byRef.get(key)!, "ref_no_exact", 0.95);
  }

  for (const booking of bookings) {
    if (matchedBookings.has(booking.sheet_row) || !booking.normalized_customer_name) continue;
    const hit = (byName.get(booking.normalized_customer_name) ?? []).find(
      (form) =>
        !usedForms.has(formKey(form)) &&
        withinNameDateWindow(form.timestamp_ms, booking.book_date_ms),
    );
    if (hit) pushForm(booking, hit, "name_date_window", 0.75);
  }

  for (const booking of bookings) {
    if (matchedBookings.has(booking.sheet_row)) continue;
    const hit = booking.customer_name_tokens
      .flatMap((token) => byToken.get(token) ?? [])
      .find(
        (form) =>
          !usedForms.has(formKey(form)) &&
          withinNameDateWindow(form.timestamp_ms, booking.book_date_ms),
      );
    if (hit) pushForm(booking, hit, "name_token_date_window", 0.65);
  }

  for (const booking of bookings) {
    if (matchedBookings.has(booking.sheet_row)) continue;
    const candidates = forms
      .filter(
        (form) =>
          !usedForms.has(formKey(form)) &&
          withinNameDateWindow(form.timestamp_ms, booking.book_date_ms),
      )
      .map((form) => ({ form, score: fuzzyNameScore(booking.customer_name, form.name) }))
      .filter(({ score }) => score >= 0.88)
      .sort((a, b) => b.score - a.score);
    if (candidates[0]) {
      pushForm(
        booking,
        candidates[0].form,
        "name_fuzzy_date_window",
        Math.min(0.8, candidates[0].score),
      );
    }
  }

  for (const booking of bookings) {
    if (matchedBookings.has(booking.sheet_row)) continue;
    let best:
      | { form: ParsedFormLead; call: ParsedCallLead; score: number }
      | undefined;
    for (const form of forms) {
      if (usedForms.has(formKey(form)) || !form.normalized_phone) continue;
      const score = fuzzyNameScore(booking.customer_name, form.name);
      if (score < 0.88) continue;
      const relatedCalls = callsByPhone.get(form.normalized_phone) ?? [];
      if (!relatedCalls.length) continue;
      const bookDay = bookingDateKey(booking);
      const call =
        relatedCalls.find((row) => {
          const day = callDateKey(row);
          return (
            !usedCalls.has(callKey(row)) &&
            /booked/i.test(row.booked_flag) &&
            Boolean(bookDay && day && daysBetweenKeys(bookDay, day) <= 2)
          );
        }) ??
        relatedCalls.find((row) => {
          const day = callDateKey(row);
          return (
            !usedCalls.has(callKey(row)) &&
            Boolean(bookDay && day && daysBetweenKeys(bookDay, day) <= 7)
          );
        }) ??
        relatedCalls.find((row) => !usedCalls.has(callKey(row)));
      if (call && (!best || score > best.score)) best = { form, call, score };
    }
    if (
      best &&
      pushForm(booking, best.form, "phone_form_bridge", 0.7)
    ) {
      usedCalls.add(callKey(best.call));
    }
  }

  for (const call of input.calls) {
    for (const phone of extractPhones(call.form_fill_checker)) {
      const list = callsByPhone.get(phone) ?? [];
      if (!list.some((row) => row.sheet_row === call.sheet_row)) {
        callsByPhone.set(phone, [...list, call]);
      }
    }
  }

  const bookedCalls = input.calls.filter((row) => /booked/i.test(row.booked_flag));
  const availableBookings = () =>
    bookings.filter(
      (row) =>
        !matchedBookings.has(row.sheet_row) && /inbounds/i.test(row.lead_source),
    );
  const availableCalls = () =>
    bookedCalls.filter((row) => !usedCalls.has(callKey(row)));

  const bookingsByDay = new Map<string, ParsedBookedDeal[]>();
  const callsByDay = new Map<string, ParsedCallLead[]>();
  for (const row of availableBookings()) {
    const day = bookingDateKey(row);
    if (day) bookingsByDay.set(day, [...(bookingsByDay.get(day) ?? []), row]);
  }
  for (const row of availableCalls()) {
    const day = callDateKey(row);
    if (day) callsByDay.set(day, [...(callsByDay.get(day) ?? []), row]);
  }
  for (const [day, dayBookings] of bookingsByDay) {
    const dayCalls = callsByDay.get(day) ?? [];
    if (dayBookings.length === 1 && dayCalls.length === 1) {
      pushCall(dayBookings[0], dayCalls[0], "call_same_day_unique", 0.62);
    }
  }

  const sameDayEdges = availableBookings().flatMap((booking) =>
    availableCalls()
      .filter((call) => callDateKey(call) === bookingDateKey(booking))
      .map((call) => {
        const bookingTier = bookingAmountTier(booking);
        const callTier = callAmountTier(call);
        const score = callTier === bookingTier ? 3 : callTier === 0 || bookingTier === 0 ? 1 : 0;
        return { booking, call, score };
      }),
  );
  sameDayEdges.sort((a, b) => b.score - a.score);
  for (const edge of sameDayEdges) {
    if (edge.score >= 1) {
      pushCall(
        edge.booking,
        edge.call,
        "call_same_day_amount_tier",
        0.55 + Math.min(edge.score, 3) * 0.03,
      );
    }
  }

  const windowEdges = availableBookings().flatMap((booking) => {
    const bookDay = bookingDateKey(booking);
    if (!bookDay) return [];
    return availableCalls().flatMap((call) => {
      const callDay = callDateKey(call);
      if (!callDay) return [];
      const dayDiff = daysBetweenKeys(bookDay, callDay);
      if (dayDiff > 1) return [];
      return [
        {
          booking,
          call,
          dayDiff,
          score:
            10 -
            dayDiff * 3 +
            (bookingAmountTier(booking) === callAmountTier(call) ? 2 : 0),
        },
      ];
    });
  });
  windowEdges.sort((a, b) => b.score - a.score || a.dayDiff - b.dayDiff);
  for (const edge of windowEdges) {
    if (matchedBookings.has(edge.booking.sheet_row) || usedCalls.has(callKey(edge.call))) {
      continue;
    }
    const forBooking = windowEdges.filter(
      (other) =>
        other.booking.sheet_row === edge.booking.sheet_row &&
        !usedCalls.has(callKey(other.call)),
    );
    const forCall = windowEdges.filter(
      (other) =>
        other.call.sheet_row === edge.call.sheet_row &&
        !matchedBookings.has(other.booking.sheet_row),
    );
    const unique = forBooking.length === 1 && forCall.length === 1;
    const clear =
      forBooking[0]?.call.sheet_row === edge.call.sheet_row &&
      forCall[0]?.booking.sheet_row === edge.booking.sheet_row &&
      (!forBooking[1] || edge.score >= forBooking[1].score + 2);
    if (unique || clear) {
      pushCall(
        edge.booking,
        edge.call,
        "call_date_window_unique",
        edge.dayDiff === 0 ? 0.58 : 0.5,
      );
    }
  }

  for (const booking of bookings) {
    if (matchedBookings.has(booking.sheet_row) || !booking.lid) continue;
    const entry = lidMembership.get(booking.lid.toLowerCase());
    if (entry) {
      matchedBookings.add(booking.sheet_row);
      matches.push({
        booking,
        lead: { kind: "lid_best_relo", entry },
        method: "lid_best_relo_only",
        confidence: 0.55,
      });
    }
  }

  return {
    matches,
    unmatchedBookings: bookings.filter((row) => !matchedBookings.has(row.sheet_row)),
  };
}

function moneyClose(a?: number, b?: number): boolean {
  return a !== undefined && b !== undefined && Math.abs(a - b) <= 0.02;
}

export function matchRefundsToBookings(
  refunds: ParsedRefund[],
  bookings: ParsedBookedDeal[],
): { matches: RefundBookingMatch[]; unmatched: ParsedRefund[] } {
  const relevantBookings = bookings.filter((row) => row.is_best_relocation_source);
  const relevantRefunds = selectBestRelocationRefundObservations(
    refunds,
    relevantBookings,
  );
  const byJob = new Map<string, ParsedBookedDeal[]>();
  const usedRows = new Set<number>();
  for (const booking of relevantBookings) {
    if (booking.normalized_job_no) {
      byJob.set(booking.normalized_job_no, [
        ...(byJob.get(booking.normalized_job_no) ?? []),
        booking,
      ]);
    }
  }
  const matches: RefundBookingMatch[] = [];
  const unmatched: ParsedRefund[] = [];
  const push = (
    refund: ParsedRefund,
    booking: ParsedBookedDeal,
    method: RefundMatchMethod,
    confidence: number,
  ) => {
    // Review-only evidence must not consume the booking before a later refund
    // with corroborated evidence can reach the unattended threshold.
    if (confidence >= 0.9) usedRows.add(booking.sheet_row);
    matches.push({ refund, booking, method, confidence });
  };

  for (const refund of relevantRefunds) {
    const candidates = (refund.normalized_job_no
      ? byJob.get(refund.normalized_job_no) ?? []
      : []
    ).filter((row) => !usedRows.has(row.sheet_row));
    const byAgent = candidates.filter(
      (row) =>
        Boolean(refund.normalized_agent) &&
        row.agent.trim().toLowerCase() === refund.normalized_agent,
    );
    if (byAgent.length === 1) {
      push(refund, byAgent[0], "job_no_agent", 1);
      continue;
    }
    const byCustomer = candidates.filter(
      (row) =>
        Boolean(refund.normalized_customer_name) &&
        row.normalized_customer_name === refund.normalized_customer_name,
    );
    if (byCustomer.length === 1) {
      push(refund, byCustomer[0], "job_no_customer", 0.9);
      continue;
    }
    const byLid = relevantBookings.filter(
      (row) =>
        !usedRows.has(row.sheet_row) &&
        refund.lid &&
        row.lid?.toLowerCase() === refund.lid.toLowerCase(),
    );
    if (
      byLid.length === 1 &&
      (candidates.length === 0 ||
        candidates.some((row) => row.sheet_row === byLid[0].sheet_row))
    ) {
      push(refund, byLid[0], "lid_exact", 0.9);
      continue;
    }
    if (candidates.length === 1) {
      // Unique job alone is review evidence under conservative calibration
      // (AUTO_LINK_THRESHOLD 0.9). Auto-cancel requires agent, customer, or LID.
      push(refund, candidates[0], "job_no_unique", 0.85);
      continue;
    }
    const byAmounts = candidates.filter(
      (row) =>
        moneyClose(row.binder_amount, refund.binder_amount) &&
        moneyClose(row.deposit_amount, refund.deposit_amount),
    );
    if (byAmounts.length === 1) {
      push(refund, byAmounts[0], "job_no_amounts", 0.85);
      continue;
    }
    const byCustomerDate = relevantBookings.filter(
      (row) =>
        !usedRows.has(row.sheet_row) &&
        Boolean(refund.normalized_customer_name) &&
        row.normalized_customer_name === refund.normalized_customer_name &&
        row.book_date?.slice(0, 10) === refund.book_date?.slice(0, 10),
    );
    if (byCustomerDate.length === 1) {
      push(refund, byCustomerDate[0], "customer_book_date", 0.7);
      continue;
    }
    unmatched.push(refund);
  }
  return { matches, unmatched };
}

export function selectBestRelocationRefundObservations(
  refunds: ParsedRefund[],
  bookings: ParsedBookedDeal[],
): ParsedRefund[] {
  const relevantBookings = bookings.filter(
    (row) => row.is_best_relocation_source,
  );
  const jobs = new Set(
    relevantBookings
      .map((row) => row.normalized_job_no)
      .filter((value): value is string => Boolean(value)),
  );
  const lids = new Set(
    relevantBookings
      .map((row) => row.lid?.toLowerCase())
      .filter((value): value is string => Boolean(value)),
  );
  return refunds.filter(
    (refund) =>
      refund.is_best_relocation_source ||
      Boolean(
        refund.normalized_job_no && jobs.has(refund.normalized_job_no),
      ) ||
      Boolean(refund.lid && lids.has(refund.lid.toLowerCase())),
  );
}
