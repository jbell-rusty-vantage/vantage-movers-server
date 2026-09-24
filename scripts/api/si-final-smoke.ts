/**
 * Read-only production smoke for the Sales Intelligence final data model (S1–S4). Every call is a signed
 * Owner GET; each response is parsed with the server's own DTO schema where one exists. The media probe
 * (`--media`) issues ranged GETs on one retained recording, which writes the route's `media_played` audit row.
 *
 *   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/api/si-final-smoke.ts [--media]
 *
 * Prints status lines only; never secrets or response bodies beyond counts.
 */
import { attentionPageDtoSchema } from "../../src/services/salesIntelligence/dto";
import { buildAdminActorHeaders, buildVantageApiUrl, loadVantageApiConfig, vantageApi } from "./vantageApi";

const PREFIX = "/api/v1/admin/sales-intelligence";
type Envelope = { as_of?: string; data?: Record<string, unknown> } & Record<string, unknown>;
let failures = 0;
const line = (ok: boolean, label: string, detail: string) => { if (!ok) failures += 1; console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(44)} ${detail}`); };

async function get(path: string, query?: Record<string, string>) {
  const response = await vantageApi<Envelope>({ path: `${PREFIX}${path}`, query, signAdmin: true });
  const body = (response.data && typeof response.data === "object" ? response.data : {}) as Envelope;
  return { status: response.status, body, data: ((body as { data?: unknown }).data ?? body) as Record<string, unknown> };
}

async function main() {
  const desk = await get("/attention", { limit: "25" });
  // The route wraps the DTO in `{ ok: true, ... }`; the DTO schema is strict, so parse without the envelope key.
  const { ok: _ok, ...dto } = desk.body as Record<string, unknown>;
  const parsed = attentionPageDtoSchema.safeParse(dto);
  const items = (desk.data.items as Array<Record<string, unknown>> | undefined) ?? [];
  line(desk.status === 200 && parsed.success, "GET /attention", `status ${desk.status}, schema ${parsed.success ? "ok" : "FAILED"}, items ${items.length}/${String(desk.data.total_items)}, snapshot ${String(desk.data.status)}, metrics ${desk.data.metrics ? "yes" : "no"}`);
  const withFacts = items.filter(item => (item.outreach as { facts?: unknown } | null)?.facts).length;
  line(withFacts > 0, "desk rows carry facts", `${withFacts}/${items.length}`);
  const closed = await get("/attention", { view: "closed", limit: "5" });
  line(closed.status === 200, "GET /attention?view=closed", `status ${closed.status}, total ${String(closed.data.total_items)}`);

  const record = items.map(item => item.outreach as { id?: string; primary_number?: { id?: string } | null } | null).find(outreach => outreach?.id && outreach.primary_number?.id);
  if (!record?.id) { line(false, "an Outreach row with a Number", "none on the first page"); return; }
  for (const path of [`/outreach/${record.id}`, `/outreach/${record.id}/assessment`, `/outreach/${record.id}/findings`]) {
    const read = await get(path);
    line(read.status === 200, `GET ${path.replace(record.id, ":id")}`, `status ${read.status}`);
  }
  const timeline = await get(`/outreach/${record.id}/timeline`, { limit: "20" });
  line([200, 404].includes(timeline.status), "GET /outreach/:id/timeline", `status ${timeline.status}${timeline.status === 404 ? " (TIMELINE_V2 off)" : `, items ${String((timeline.data.items as unknown[] | undefined)?.length)}`}`);

  const numberId = record.primary_number!.id!;
  const numbers = await get("/numbers", { sort: "last_call", limit: "10" });
  line(numbers.status === 200, "GET /numbers?sort=last_call", `status ${numbers.status}, items ${String((numbers.data.items as unknown[] | undefined)?.length)}`);
  const number = await get(`/numbers/${numberId}`);
  line(number.status === 200, "GET /numbers/:id", `status ${number.status}, attached_lead_progress ${number.data.attached_lead_progress ? "yes" : "no"}`);
  const conversations = await get(`/numbers/${numberId}/conversations`);
  const convItems = (conversations.data.items as unknown[] | undefined) ?? [];
  line(conversations.status === 200, "GET /numbers/:id/conversations", `status ${conversations.status}, items ${convItems.length}`);

  if (!process.argv.includes("--media")) return;
  await mediaProbe();
}

/** Ranged reads on one retained recording: every response must be at most one bounded chunk. */
async function mediaProbe() {
  const config = loadVantageApiConfig();
  const numbers = await get("/numbers", { sort: "last_call", has_recording: "true", limit: "25" });
  for (const row of (numbers.data.items as Array<{ id: string }> | undefined) ?? []) {
    const conversations = await get(`/numbers/${row.id}/conversations`);
    for (const conversation of (conversations.data.items as Array<Record<string, unknown>> | undefined) ?? []) {
      if (!conversation.conversation_id || conversation.media_available !== true) continue;
      const path = `${PREFIX}/conversations/${String(conversation.conversation_id)}/media`;
      const fetchRange = async (range: string | null) => {
        const headers: Record<string, string> = { "x-api-secret": config.apiSecret, ...buildAdminActorHeaders(config.admin!, "GET", path), ...(range ? { Range: range } : {}) };
        const started = Date.now();
        const response = await fetch(buildVantageApiUrl(config.baseUrl, path), { headers });
        const bytes = (await response.arrayBuffer()).byteLength;
        return { status: response.status, bytes, ms: Date.now() - started, contentRange: response.headers.get("content-range"), type: response.headers.get("content-type") };
      };
      const first = await fetchRange("bytes=0-");
      if (first.status === 404) continue;
      line([200, 206].includes(first.status) && first.bytes <= 2 * 1024 * 1024, "media bytes=0-", `status ${first.status}, ${first.bytes} B, ${first.ms} ms, ${first.contentRange ?? "no Content-Range"}, ${first.type}`);
      const total = Number(/\/(\d+)$/.exec(first.contentRange ?? "")?.[1] ?? first.bytes);
      if (total > first.bytes) {
        const next = await fetchRange(`bytes=${first.bytes}-`);
        line(next.status === 206 && next.bytes > 0, "media next range", `status ${next.status}, ${next.bytes} B, ${next.ms} ms, ${next.contentRange}`);
      }
      const whole = await fetchRange(null);
      line([200, 206].includes(whole.status) && whole.bytes <= 2 * 1024 * 1024, "media without Range", `status ${whole.status}, ${whole.bytes} B of ${total}, ${whole.ms} ms`);
      return;
    }
  }
  line(false, "media probe", "no retained recording found on the first 25 Numbers with recordings");
}

main().then(() => { console.log(failures ? `${failures} failure(s)` : "all checks passed"); process.exitCode = failures ? 1 : 0; },
  error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
