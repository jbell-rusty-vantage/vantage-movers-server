import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { GranotCollectorError, type GranotSourceCollection, type GranotAuthenticatedSession } from "./index";
import { parseEstimatesInProcessHtml } from "./estimatesInProcess";

export type EstimatesCoverage = {
  complete: true;
  captured_at: string;
  requests: number;
  rows: number;
  windows: Array<{ from: string; to: string; pages: number; rows: number; reportedTotal: number }>;
};
export type EstimatesCollectionCoverage = EstimatesCoverage;

export type EstimatesCollectionControls = {
  additionalDateWindows?: Array<{ from: string; to: string }>;
  maxRequests?: number;
  maxPages?: number;
  chunkDays?: number;
  beforeRequest?: () => void | Promise<void>;
  onCoverage?: (coverage: EstimatesCoverage) => void | Promise<void>;
};

/** Check the actual form, including enabled options, before posting fixed business selectors. */
export function verifyEstimatesForm(html: string): boolean {
  const $ = cheerio.load(html);
  const priority = $('select[name="FUSTATUS"]');
  const form = priority.closest('form');
  if (priority.length !== 1 || form.length !== 1 || priority.is('[disabled]')) return false;
  const poolOptions = priority.find("option").filter((_i, el) => !$(el).is('[disabled]') && ($(el).attr("value") ?? $(el).text().trim()) === "9");
  if (poolOptions.length !== 1 || !/^pool$/i.test(poolOptions.text().trim())) return false;
  const action = form.attr('action');
  const scriptActions = [...html.matchAll(/document\.theForm\.action\s*=\s*["'](\/wc\.dll\?mv~estprocessret~[A-Za-z0-9-]+)["']/g)];
  const actionVerified = action ? /^\/wc\.dll\?mv~estprocessret~[A-Za-z0-9-]+$/.test(action) : form.attr('name') === 'theForm' && scriptActions.length === 1;
  if (!actionVerified || (form.attr('method') ?? 'get').toLowerCase() !== 'post') return false;
  for (const [name, value] of Object.entries({ STATUS: 'V9', TYPEDTE: 'OPEN', FUSTATUS: '10', USER: '', DEPT: 'ALL', TYPE: 'V1', SORT: 'V6' })) {
    const controls = $(`[name="${name}"]`).filter((_i, el) => !$(el).is('[disabled]'));
    if (controls.filter("select").length > 1) return false;
    const options = controls.filter('select').find("option").filter((_i, el) => !$(el).is('[disabled]') && ($(el).attr("value") ?? $(el).text().trim()) === value);
    const inputs = controls.filter(`input[value="${value}"]`);
    if (options.length + inputs.length !== 1) return false;
    if (name === 'FUSTATUS' && !/^all$/i.test(options.text().trim())) return false;
  }
  return ['DATE1', 'DATE2'].every(name => $(`input[name="${name}"]:not([disabled])`).length === 1);
}

const fail = (message: string): never => { throw new GranotCollectorError('schema_drift', message); };
const date = (value: string) => { const [m, d, y] = value.split('/'); return Date.UTC(Number(y), Number(m) - 1, Number(d)); };
const format = (value: number) => { const d = new Date(value); return `${String(d.getUTCMonth()+1).padStart(2,'0')}/${String(d.getUTCDate()).padStart(2,'0')}/${d.getUTCFullYear()}`; };
const DAY = 86400000;

export async function collectVerifiedEstimates(
  session: GranotAuthenticatedSession,
  window: { from: string; to: string },
  controls: EstimatesCollectionControls,
): Promise<GranotSourceCollection[]> {
  const maxRequests = controls.maxRequests ?? 128, maxPages = controls.maxPages ?? 32, chunkDays = controls.chunkDays ?? 7;
  if (![maxRequests, maxPages, chunkDays].every(n => Number.isInteger(n) && n > 0 && n <= 1024)) throw new GranotCollectorError('invalid_request', 'Invalid Estimates collection budget');
  const coverage: EstimatesCoverage = { complete: true, captured_at: '', requests: 0, rows: 0, windows: [] };
  const request = async (path: string, init?: Parameters<GranotAuthenticatedSession['request']>[1]) => {
    if (++coverage.requests > maxRequests) fail('Estimates collection request budget exhausted');
    await controls.beforeRequest?.();
    const html = await session.request(path, init);
    await controls.beforeRequest?.();
    if (/security alert|network login|user login|close window/i.test(cheerio.load(html)('body').text())) throw new GranotCollectorError('invalid_session', 'Granot Estimates session expired');
    return html;
  };
  const form = await request(`/wc.dll?mv~estprocesswc~${session.sessionToken}`);
  if (!verifyEstimatesForm(form)) fail('Granot Estimates form controls could not be verified');
  const sources: GranotSourceCollection[] = [];
  const collectWindow = async (from: number, to: number): Promise<void> => {
    const body = new URLSearchParams({ STATUS:'V9', TYPEDTE:'OPEN', DATE1:format(from), DATE2:format(to), FUSTATUS:'10', USER:'', DEPT:'ALL', TYPE:'V1', SORT:'V6' });
    let html: string;
    try { html = await request(`/wc.dll?mv~estprocessret~${session.sessionToken}`, { method:'POST', body }); }
    catch (error) {
      if (error instanceof GranotCollectorError && error.code === 'response_too_large' && from < to) { await split(); return; }
      throw error;
    }
    const pages: GranotSourceCollection[] = [], seen = new Set<string>();
    let total: number | null = null, rowCount = 0, pageCount = 0;
    for (;;) {
      const parsed = parseEstimatesInProcessHtml(html);
      if (!parsed.recognized && parsed.reportedTotal !== null && parsed.reportedTotal > 0 && parsed.diagnostics.length === 1 && parsed.diagnostics[0] === "expected_results_table_missing" && from < to) {
        await split(); return;
      }
      if (!parsed.recognized || parsed.diagnostics.length) fail(`Granot Estimates schema invalid: ${parsed.diagnostics.join(',')}`);
      if (parsed.reportedTotal === null) fail('Granot Estimates transaction total missing');
      if (total !== null && total !== parsed.reportedTotal) fail('Granot Estimates transaction total changed across pages');
      total = parsed.reportedTotal;
      pageCount++;
      if (parsed.pageNumber !== null && parsed.pageNumber !== pageCount) fail('Granot Estimates page sequence mismatch');
      const fingerprint = JSON.stringify(parsed.sources.map(source => [source.sourceLabel, source.sections.followUpEstimates.map(row => row.values)]));
      if (seen.has(fingerprint) && parsed.rowCount) fail('Granot Estimates repeated report page');
      seen.add(fingerprint);
      const collectedAt = new Date().toISOString();
      for (const source of parsed.sources) for (const row of source.sections.followUpEstimates) {
        if (row.values.open_date) {
          const opened = date(row.values.open_date);
          if (opened < from || opened > to) fail('Granot Estimates returned a row outside the requested Open Date partition');
        }
        row.collectedAt = collectedAt;
        row.id = `estimates:${format(from)}:${pageCount}:${row.id}`;
      }
      pages.push(...parsed.sources); rowCount += parsed.rowCount;
      if (parsed.pageCount === null || parsed.pageNumber === parsed.pageCount) break;
      if (pageCount >= maxPages) { if (from < to) { await split(); return; } fail('Granot Estimates page budget exhausted'); }
      const $ = cheerio.load(html);
      const next = $('a').filter((_i, el) => $(el).attr('rel') === 'next' || /^(next|>)$/i.test($(el).text().trim()));
      const path = next.length === 1 ? next.attr('href') ?? '' : '';
      if (!path.startsWith(`/wc.dll?mv~estprocessret~${session.sessionToken}~`) || path.includes('#') || /[\r\n]/.test(path)) fail('Granot Estimates next page link is missing or unsafe');
      html = await request(path);
    }
    if (rowCount !== total) { if (from < to) { await split(); return; } fail('Granot Estimates rendered row count does not match transaction total'); }
    sources.push(...pages);
    coverage.windows.push({ from:format(from), to:format(to), pages:pageCount, rows:rowCount, reportedTotal:total! });
    coverage.rows += rowCount;
    async function split() { const mid = from + Math.floor((to-from)/DAY/2)*DAY; await collectWindow(from, mid); await collectWindow(mid+DAY, to); }
  };
  const ranges = [window, ...(controls.additionalDateWindows ?? [])].map(w => ({ from:date(w.from), to:date(w.to) })).sort((a,b) => a.from-b.from);
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to + DAY) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  for (const range of merged) for (let from = range.from; from <= range.to; from += chunkDays * DAY) await collectWindow(from, Math.min(range.to, from+(chunkDays-1)*DAY));
  coverage.captured_at = new Date().toISOString();
  await controls.onCoverage?.(coverage);
  // Chunking preserves every observation, including repeated jobs; identity ambiguity stays visible to planning.
  const grouped = new Map<string, GranotSourceCollection>();
  for (const source of sources) {
    const existing = grouped.get(source.sourceLabel);
    if (existing) existing.sections.followUpEstimates.push(...source.sections.followUpEstimates);
    else grouped.set(source.sourceLabel, source);
  }
  return [...grouped.values()].map(source => ({ ...source, contentHash: createHash("sha256").update(JSON.stringify({ sourceLabel:source.sourceLabel, sections:source.sections })).digest("hex") }));
}
