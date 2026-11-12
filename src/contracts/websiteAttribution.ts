/** Server-owned v1 wire contract. Distribute byte-for-byte to api-client; do not edit the copy. */
export const WEBSITE_ATTRIBUTION_VERSION = 1;
export const ATTRIBUTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const WEBSITE_DESIGN = { id: "main-site-optimization", version: "2026-11-12" } as const;

const pagePairs = [
  ["home", "/", "/es"], ["services", "/services", "/es/servicios"],
  ["resources", "/resources", "/es/recursos"], ["locations", "/locations", "/es/destinos"],
  ["contact", "/contact", "/es/contacto"],
  ["long-distance-moving", "/services/long-distance-moving", "/es/servicios/mudanzas-larga-distancia"],
  ["residential-moving", "/services/residential-moving", "/es/servicios/mudanzas-residenciales"],
  ["corporate-office-moving", "/services/corporate-office-moving", "/es/servicios/mudanzas-de-oficina"],
  ["military-moving", "/services/military-moving", "/es/servicios/mudanzas-militares"],
  ["senior-moving", "/services/senior-moving", "/es/servicios/mudanzas-para-personas-mayores"],
  ["packing-services", "/services/packing-services", "/es/servicios/servicios-de-embalaje"],
  ["storage-options", "/services/storage-options", "/es/servicios/opciones-de-almacenamiento"],
  ["auto-transport", "/services/auto-transport", "/es/servicios/transporte-de-autos"],
  ["before-the-inventory-call", "/resources/before-the-inventory-call", "/es/recursos/preparar-inventario"],
  ["comparing-moving-estimates", "/resources/comparing-moving-estimates", "/es/recursos/comparar-presupuestos"],
  ["who-handles-my-move", "/resources/who-handles-my-move", "/es/recursos/quien-organiza-mi-mudanza"],
  ["moving-cost-guide", "/resources/moving-cost-guide", "/es/recursos/costos-de-mudanza"],
  ["items-to-check-before-packing", "/resources/items-to-check-before-packing", "/es/recursos/articulos-antes-de-embalar"],
  ["moving-paperwork-guide", "/resources/moving-paperwork-guide", "/es/recursos/documentos-de-mudanza"],
  ["wisconsin", "/locations/wisconsin-movers", "/es/destinos/wisconsin"],
  ["madison-wisconsin", "/locations/wisconsin-movers/madison", "/es/destinos/wisconsin/madison"],
  ["florida", "/locations/florida-movers", "/es/destinos/florida"],
  ["florida-to-north-carolina", "/moving-routes/florida-to-north-carolina", "/es/rutas/florida-a-carolina-del-norte"],
  ["moving-routes", "/moving-routes", "/es/rutas"],
] as const;

export type WebsitePage = { path: string; content_id: string; locale: "en" | "es" };
export function websitePage(path: unknown): WebsitePage | undefined {
  if (typeof path !== "string") return;
  const clean = path.replace(/\/$/, "") || "/";
  for (const [content_id, en, es] of pagePairs) {
    if (clean === en || clean === es) return { path: clean, content_id, locale: clean === es ? "es" : "en" };
  }
}

export const CAMPAIGN_SOURCES = ["google", "bing", "facebook", "instagram", "newsletter", "partner", "review", "unknown"] as const;
export const CAMPAIGN_MEDIA = ["organic", "cpc", "social", "email", "referral", "review", "unknown"] as const;
// No growth campaign or experiment is activated. Only the isolated qualification tag is issued.
export const CAMPAIGN_NAMES = ["preview-qualification", "unknown"] as const;
export const REFERRING_HOSTS = ["google.com", "bing.com", "duckduckgo.com", "facebook.com", "instagram.com", "chatgpt.com", "perplexity.ai", "other", "none"] as const;
export type WebsiteTouch = WebsitePage & {
  occurred_at: string;
  channel: "direct" | "organic_search" | "referral" | "campaign";
  referring_host: typeof REFERRING_HOSTS[number];
  campaign?: { source: typeof CAMPAIGN_SOURCES[number]; medium: typeof CAMPAIGN_MEDIA[number]; name: typeof CAMPAIGN_NAMES[number] };
};
export type WebsiteAttribution = {
  version: 1;
  first_touch: WebsiteTouch;
  latest_non_direct_touch?: WebsiteTouch;
  capture_page: WebsitePage;
  design: typeof WEBSITE_DESIGN;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function member<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}
function touch(value: unknown, now: number): WebsiteTouch | undefined {
  const item = object(value);
  if (!item) return;
  const page = websitePage(item.path);
  const at = typeof item.occurred_at === "string" ? Date.parse(item.occurred_at) : NaN;
  if (!page || !Number.isFinite(at) || at > now + 60_000 || now - at > ATTRIBUTION_MAX_AGE_MS) return;
  if (!member(item.channel, ["direct", "organic_search", "referral", "campaign"]) || !member(item.referring_host, REFERRING_HOSTS)) return;
  const result: WebsiteTouch = { ...page, occurred_at: new Date(at).toISOString(), channel: item.channel, referring_host: item.referring_host };
  if (item.channel === "campaign") {
    const campaign = object(item.campaign);
    if (!campaign || !member(campaign.source, CAMPAIGN_SOURCES) || !member(campaign.medium, CAMPAIGN_MEDIA) || !member(campaign.name, CAMPAIGN_NAMES)) return;
    result.campaign = { source: campaign.source, medium: campaign.medium, name: campaign.name };
  }
  return result;
}

/** Discard malformed measurement, never reject an otherwise valid Lead. No raw strings survive. */
export function parseWebsiteAttribution(value: unknown, now = Date.now()): WebsiteAttribution | undefined {
  try {
    const input = object(value);
    if (!input || input.version !== 1) return;
    const design = object(input.design);
    if (design?.id !== WEBSITE_DESIGN.id || design.version !== WEBSITE_DESIGN.version) return;
    const first = touch(input.first_touch, now);
    const capture = websitePage(object(input.capture_page)?.path);
    const latest = input.latest_non_direct_touch === undefined ? undefined : touch(input.latest_non_direct_touch, now);
    if (!first || !capture || (input.latest_non_direct_touch !== undefined && !latest)) return;
    if (latest && (latest.channel === "direct" || Date.parse(latest.occurred_at) < Date.parse(first.occurred_at))) return;
    return { version: 1, first_touch: first, ...(latest ? { latest_non_direct_touch: latest } : {}), capture_page: capture, design: WEBSITE_DESIGN };
  } catch { return; }
}
