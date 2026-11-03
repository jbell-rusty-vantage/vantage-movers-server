/** Resolve source-local wall clocks conservatively. Ambiguous/nonexistent clocks need evidence. */
export function parseSourceDate(value: string, timeZone = "America/New_York"): Date | undefined {
  const raw = value.trim().replace(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+/i, "");
  if (!raw || /^FORMULAS$/i.test(raw)) return undefined;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const date = new Date(raw); return Number.isFinite(+date) ? date : undefined;
  }
  let wall: number;
  if (/^\d{4,6}(?:\.\d+)?$/.test(raw) && +raw >= 20000 && +raw <= 100000) {
    wall = Math.round((Date.UTC(1899, 11, 30) + +raw * 86400000) / 1000) * 1000;
  } else {
    const match = raw.match(/^(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[/-](\d{1,2})[/-](\d{4}))(?:[ T]+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?)?$/i);
    if (!match) return undefined;
    const y = +(match[1] ?? match[6]!), m = +(match[2] ?? match[4]!), d = +(match[3] ?? match[5]!);
    let h = +(match[7] ?? 0); const minute = +(match[8] ?? 0), second = +(match[9] ?? 0), ampm = match[10]?.toUpperCase();
    if (m < 1 || m > 12 || d < 1 || d > 31 || minute > 59 || second > 59 || h > (ampm ? 12 : 23) || (ampm && h < 1)) return undefined;
    if (ampm) h = h % 12 + (ampm === "PM" ? 12 : 0);
    wall = Date.UTC(y, m - 1, d, h, minute, second);
    const check = new Date(wall);
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return undefined;
  }
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const represent = (ms: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).filter(p => p.type !== "literal").map(p => [p.type, +p.value]));
    return Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  };
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) { const at = wall + hours * 3600000; offsets.add(represent(at) - at); }
  const candidates = [...offsets].map(offset => wall - offset).filter(at => represent(at) === wall);
  return candidates.length === 1 ? new Date(candidates[0]!) : undefined;
}
