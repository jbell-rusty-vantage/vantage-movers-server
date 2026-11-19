import assert from "node:assert/strict";
import { test } from "node:test";
import { collectVerifiedEstimates, verifyEstimatesForm } from "./estimatesCollection";
import { normalizeGranotReceipt } from "../granotLifecycle/normalization";
import { buildGranotStatementFromCollectedRow } from "./lifecycleStatement";
import {
  parseEstimatesInProcessHtml,
} from "./estimatesInProcess";

const ESTIMATES_FORM = `<form action="/wc.dll?mv~estprocessret~SYNTHETIC" method="post">
<input name="STATUS" value="V9"><select name="TYPEDTE"><option value="OPEN">Open Date</option></select>
<input name="DATE1"><input name="DATE2"><select name="FUSTATUS"><option value="10">ALL</option><option value="9">Pool</option></select>
<select name="USER"><option value="">All users</option></select><select name="DEPT"><option value="ALL">ALL</option></select>
<select name="TYPE"><option value="V1">All types</option></select><select name="SORT"><option value="V6">Priority</option></select></form>`;
const ESTIMATES_HTML = `<h1>Follow-Up Estimates, Total of: 2 Transactions</h1>
<table>
  <tr>
    <th>job_no</th><th>open_date</th><th>follow_up</th><th>user</th>
    <th>customer</th><th>email</th><th>phone1</th><th>phone2</th>
    <th>from_city</th><th>from_state</th><th>from_zip</th>
    <th>to_city</th><th>to_state</th><th>to_zip</th><th>move_date</th><th>ref_no</th><th>cf</th><th>miles</th><th>lbs</th><th>rate</th><th>source</th>
    <th><table><tr><th>nested header</th></tr></table></th>
  </tr>
  <tr>
    <td>P5562366</td><td>10/12/2026</td><td>prior: 0</td><td>DEV</td>
    <td>Sample Customer</td><td>sample@example.test</td><td>555-0100</td><td>555-0199</td>
    <td>Miami</td><td>FL</td><td>33101</td>
    <td>Tampa</td><td>FL</td><td>33601</td><td>10/20/2026</td><td>001REF</td><td>250</td><td>12</td><td>400</td><td>1.5</td><td>Top10 Inbounds</td>
    <td>123 Example St</td>
  </tr>
  <tr>
    <td></td><td></td><td></td><td></td>
    <td>Totals</td><td></td><td></td><td></td>
    <td></td><td></td><td></td>
    <td></td><td></td><td></td><td></td><td></td><td>900</td><td>40</td><td>1000</td><td>3</td><td></td>
    <td></td>
  </tr>
  <tr>
    <td>P5562367</td><td>10/12/2026</td><td>called yesterday</td><td>DEV</td>
    <td>No Priority</td><td></td><td>555-0101</td><td></td>
    <td>Orlando</td><td>FL</td><td>32801</td>
    <td></td><td></td><td></td><td></td><td></td><td>10</td><td></td><td></td><td></td><td>Top10 Inbounds</td>
    <td></td>
  </tr>
</table>`;

test("Pool selection posts verified priority9 and refuses a non-Pool returned row", async () => {
  const posted: string[] = [];
  let result = ESTIMATES_HTML.replace('prior: 0', 'prior: Pool').replace('called yesterday', 'prior: 9');
  const session = { sessionToken: 'SYNTHETIC', request: async (_path: string, init?: { body?: unknown }) => {
    if (!init) return ESTIMATES_FORM;
    posted.push(String(init.body));
    return result;
  }};
  const rows = await collectVerifiedEstimates(session, { from: '10/12/2026', to: '10/12/2026' }, { selection: 'pool' });
  assert.equal(new URLSearchParams(posted[0]).get('FUSTATUS'), '9');
  assert.equal(rows[0]?.sections.followUpEstimates.length, 2);
  result = result.replace('prior: Pool', 'prior: 1');
  await assert.rejects(() => collectVerifiedEstimates(session, { from: '10/12/2026', to: '10/12/2026' }, { selection: 'pool' }), /non-Pool/);
});


test("collection verifies selectors, same-session pagination, counts and capture time", async () => {
  assert.equal(verifyEstimatesForm(ESTIMATES_FORM), true);
  assert.equal(verifyEstimatesForm(ESTIMATES_FORM.replace('value="10">ALL', 'value="10">Pool')), false);
  const first = ESTIMATES_HTML.replace('2 Transactions', '4 Transactions') + '<p>Page 1 of 2</p><a rel="next" href="/wc.dll?mv~estprocessret~SYNTHETIC~2">Next</a>';
  const second = ESTIMATES_HTML.replace('2 Transactions', '4 Transactions').replaceAll('P556236', 'P656236') + '<p>Page 2 of 2</p>';
  const pages = [ESTIMATES_FORM, first, second];
  let summary: unknown;
  const sources = await collectVerifiedEstimates({ sessionToken:'SYNTHETIC', request:async () => pages.shift()! }, { from:'10/12/2026', to:'10/13/2026' }, { onCoverage: s => { summary=s; } });
  assert.equal(sources[0]!.sections.followUpEstimates.length, 4);
  assert.ok(sources[0]!.sections.followUpEstimates.every(row => row.collectedAt && Number.isFinite(Date.parse(row.collectedAt))));
  assert.equal((summary as { rows:number }).rows, 4);
  assert.equal((summary as { requests:number }).requests, 3);
  const unsafe = [ESTIMATES_FORM, first.replace('/wc.dll?mv~estprocessret~SYNTHETIC~2', 'https://evil.invalid/page')];
  await assert.rejects(collectVerifiedEstimates({ sessionToken:'SYNTHETIC', request:async () => unsafe.shift()! }, { from:'10/12/2026', to:'10/12/2026' }, {}), /unsafe/);
});

test("truncated multi-day reports split to complete bounded same-session windows", async () => {
  const pages = [ESTIMATES_FORM, ESTIMATES_HTML.replace('2 Transactions','3 Transactions'), ESTIMATES_HTML, ESTIMATES_HTML.replaceAll('P556236','P756236').replaceAll('10/12/2026','10/13/2026')];
  let count = 0;
  const sources = await collectVerifiedEstimates({ sessionToken:'SYNTHETIC', request:async () => { count++; return pages.shift()!; } }, { from:'10/12/2026', to:'10/13/2026' }, {});
  assert.equal(count, 4);
  assert.equal(sources[0]!.sections.followUpEstimates.length, 4);
  const truncated = [ESTIMATES_FORM, ESTIMATES_HTML.replace('2 Transactions','3 Transactions')];
  await assert.rejects(collectVerifiedEstimates({ sessionToken:'SYNTHETIC', request:async () => truncated.shift()! }, { from:'10/12/2026', to:'10/12/2026' }, {}), /row count/);
});


test("provider ignoring requested Open Date partitions fails closed", async () => {
  const pages = [ESTIMATES_FORM, ESTIMATES_HTML];
  await assert.rejects(collectVerifiedEstimates({ sessionToken:'SYNTHETIC', request:async () => pages.shift()! }, { from:'10/13/2026', to:'10/13/2026' }, {}), /outside the requested/);
});


test("provider multiline move date extracts canonical start and preserves end evidence", () => {
  for (const [cell, expected, end] of [
    ['<b>10/20/2026<br> / / </b>','10/20/2026','/ /'],
    ['<b>10/20/2026<br>10/22/2026</b>','10/20/2026','10/22/2026'],
    ['<b>1/2/2027<br> / / </b>','01/02/2027','/ /'],
    ['<b> / / <br> / / </b>',undefined,'/ /'],
    ['',undefined,undefined],
  ] as const) {
    const parsed = parseEstimatesInProcessHtml(ESTIMATES_HTML.replace('<td>10/20/2026</td>', `<td>${cell}</td>`));
    const row = parsed.sources[0]!.sections.followUpEstimates[0]!;
    assert.equal(row.values.move_date, expected);
    assert.equal(row.values.move_date_end_evidence, end);
    const statement = buildGranotStatementFromCollectedRow({ row, sourceLabel: 'Top10 Inbounds', section: 'followUpEstimates' });
    // Use a complete synthetic contact so the assertion checks actual canonical receipt compatibility.
    statement.phone = '3055550123';
    const normalized = normalizeGranotReceipt({ observation_channel:'granot_http_automation', captured_at:new Date('2026-10-14T12:00:00Z'), channel_operation_kind:'lead_snapshot_apply', channel_operation_id:'synthetic:move-date', payload:statement });
    assert.equal(normalized.issues.some(issue => issue.code === 'invalid_move_date'),false);
    assert.equal(normalized.normalization_result,'valid');
  }
});

test("provider job links and email annotations keep primary identity and contact separate", () => {
  const html = ESTIMATES_HTML.replace('<td>P5562366</td>','<td>\n  <a href="/synthetic-job">P5562366</a>\n  <br><br><b>FLAG</b>\n</td>').replace('<td>sample@example.test</td>', '<td>\n  sample@example.test\n  <br><b>LABEL</b>\n</td>');
  const row = parseEstimatesInProcessHtml(html).sources[0]!.sections.followUpEstimates[0]!;
  assert.equal(row.values.job_no,'P5562366');
  assert.equal(row.values.job_no_annotation_evidence,'FLAG');
  assert.equal(row.values.email,'sample@example.test');
  assert.equal(row.values.email_annotation_evidence,'LABEL');
  const statement = buildGranotStatementFromCollectedRow({ row, sourceLabel:'Top10 Inbounds', section:'followUpEstimates' });
  statement.phone = '3055550123';
  const normalized = normalizeGranotReceipt({ observation_channel:'granot_http_automation', captured_at:new Date('2026-10-14T12:00:00Z'), channel_operation_kind:'lead_snapshot_apply', channel_operation_id:'synthetic:annotations', payload:statement });
  assert.equal(normalized.normalization_result,'valid');
  assert.equal(normalized.identity.normalized_job_no,'P5562366');
  assert.equal(normalized.issues.some(issue => issue.code === 'invalid_email'),false);
});
