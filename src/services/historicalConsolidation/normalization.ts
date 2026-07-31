export type ParsedNameField = {
  raw_value: string;
  display_value: string;
  tokens: string[];
  normalized_tokens: string[];
  metadata: { terminal_split?: true; terminal_percentage?: string };
  disposition: "accepted" | "ambiguous" | "empty";
  reason_codes: string[];
};

export type ParseResult<T> =
  | { disposition: "accepted"; value: T; reason_codes: string[] }
  | { disposition: "ambiguous" | "empty" | "invalid"; reason_codes: string[] };

export function normalizeExact(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function normalizeDisplay(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

export function parseAgentNames(rawValue: string): ParsedNameField {
  const raw = String(rawValue ?? "");
  let display = normalizeDisplay(raw);
  if (!display) {
    return { raw_value: raw, display_value: "", tokens: [], normalized_tokens: [], metadata: {}, disposition: "empty", reason_codes: ["empty_agent"] };
  }

  const metadata: ParsedNameField["metadata"] = {};
  const percentage = display.match(/(?:^|\s)(100|[1-9]?\d)%$/u);
  if (percentage) {
    metadata.terminal_percentage = `${percentage[1]}%`;
    display = display.slice(0, percentage.index).trim();
  }
  const split = display.match(/(?:^|\s)split$/iu);
  if (split) {
    metadata.terminal_split = true;
    display = display.slice(0, split.index).trim();
  }

  const reasons: string[] = [];
  if (/[\\&+,]/u.test(display) || /\band\b/iu.test(display)) reasons.push("ambiguous_agent_separator");
  if (/\/\s*\//u.test(display) || display.startsWith("/") || display.endsWith("/")) reasons.push("empty_agent_token");
  if (/\bsplit\b/iu.test(display) || /\b(?:100|[1-9]?\d)%\b/u.test(display)) reasons.push("non_terminal_agent_metadata");

  const tokens = display.split("/").map(normalizeDisplay);
  const normalizedTokens: string[] = [];
  const uniqueTokens: string[] = [];
  for (const token of tokens) {
    const normalized = normalizeExact(token);
    if (!normalized) continue;
    if (!normalizedTokens.includes(normalized)) {
      normalizedTokens.push(normalized);
      uniqueTokens.push(token);
    }
  }
  return {
    raw_value: raw,
    display_value: display,
    tokens: uniqueTokens,
    normalized_tokens: normalizedTokens,
    metadata,
    disposition: reasons.length ? "ambiguous" : "accepted",
    reason_codes: reasons,
  };
}

export function parseCustomerName(rawValue: string): ParsedNameField {
  const raw = String(rawValue ?? "");
  const display = normalizeDisplay(raw);
  const flags = [
    /\//u.test(display) ? "contains_slash" : null,
    /\\/u.test(display) ? "contains_backslash" : null,
    /&/u.test(display) ? "contains_ampersand" : null,
    /\+/u.test(display) ? "contains_plus" : null,
    /,/u.test(display) ? "contains_comma" : null,
    /\band\b/iu.test(display) ? "contains_and" : null,
  ].filter((value): value is string => Boolean(value));
  return {
    raw_value: raw,
    display_value: display,
    tokens: display ? [display] : [],
    normalized_tokens: display ? [normalizeExact(display)] : [],
    metadata: {},
    disposition: display ? "accepted" : "empty",
    reason_codes: display ? flags : ["empty_customer"],
  };
}

export function parseMoneyToCents(rawValue: unknown): ParseResult<number> {
  if (rawValue === null || rawValue === undefined || String(rawValue).trim() === "") {
    return { disposition: "empty", reason_codes: ["missing_money"] };
  }
  const raw = typeof rawValue === "number" ? String(rawValue) : String(rawValue).trim();
  const cleaned = raw.replace(/^\$/u, "").replaceAll(",", "").trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(cleaned)) {
    return { disposition: "invalid", reason_codes: ["malformed_or_negative_money"] };
  }
  const [whole, fraction = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return { disposition: "invalid", reason_codes: ["money_out_of_range"] };
  return { disposition: "accepted", value: cents, reason_codes: [] };
}

export function allocateCents(totalCents: number, agentIds: readonly string[]): Array<{ agent_id: string; cents: number }> {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error("Allocation total must be non-negative integer cents");
  const unique = [...new Set(agentIds)];
  if (unique.length === 0) throw new Error("At least one distinct agent is required");
  const base = Math.floor(totalCents / unique.length);
  let remainder = totalCents % unique.length;
  return unique.map((agent_id) => ({ agent_id, cents: base + (remainder-- > 0 ? 1 : 0) }));
}
