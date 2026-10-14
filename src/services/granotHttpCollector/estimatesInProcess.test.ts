import assert from "node:assert/strict";
import { test } from "node:test";
import { collectVerifiedEstimates, verifyEstimatesForm } from "./estimatesCollection";
import { normalizeGranotReceipt } from "../granotLifecycle/normalization";
import type { GranotAutomationCompatibilitySource } from "../granotLifecycle/automationCompatibility";
import { buildGranotStatementFromCollectedRow } from "./lifecycleStatement";
import {
  collectEstimatesInProcess,
  estimatesRouteForMatches,
  parseEstimatesInProcessHtml,
} from "./estimatesInProcess";
import { assembleEstimatesPlan } from "./runWorkflow";
import type { GranotFormPlan } from "./formWorkflow";
import type { GranotSourceCollection } from "./index";

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

test("estimates parser keeps the prior digit and drops the totals row", () => {
  const parsed = parseEstimatesInProcessHtml(ESTIMATES_HTML);
  assert.equal(parsed.recognized, true);
  const rows = parsed.sources[0]?.sections.followUpEstimates ?? [];
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.values.job_no, "P5562366");
  assert.equal(rows[0]?.values.priority, "0");
  assert.equal(rows[0]?.values.phone, "555-0100");
  assert.equal(rows[0]?.values.est_cf, "250");
  assert.equal(rows[0]?.values.user, "DEV");
  assert.equal(rows[0]?.values.from, "Miami, FL");
  assert.equal(rows[0]?.values.phone2, "555-0199");
  assert.equal(rows[0]?.values.miles, undefined);
  assert.equal(rows[0]?.values.open_date, "10/12/2026");
  assert.equal(rows[1]?.values.priority, undefined);
  assert.equal(rows[1]?.values.prior, undefined);

  const statement = buildGranotStatementFromCollectedRow({
    row: rows[0]!,
    sourceLabel: "Top10 Inbounds",
    section: "followUpEstimates",
  });
  assert.equal(statement.priority, "0");
  assert.equal(statement.from_city, "Miami");
  assert.equal(statement.from_state, "FL");
  assert.equal(statement.user, "DEV");
  assert.equal(statement.est_cf, "250");
  assert.equal(statement.event_type, undefined);
});

test("estimates collector posts Follow-Up Estimates and does not request mprep", async () => {
  const token = "A04F50BA-B981-44A9-9930-9E7FEC2B8201";
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const responses = [
    response(`<form action="/network-login"></form>`),
    response(`<form action="/user-login"></form>`),
    response(`<a href="/wc.dll?mv~mainmenuwc~${token}~LOGIN">Menu</a>`),
    response(ESTIMATES_FORM),
    response(ESTIMATES_HTML),
  ];
  const fakeFetch: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : undefined,
    });
    const next = responses.shift();
    assert.ok(next, `unexpected request to ${String(input)}`);
    return next;
  };

  let guardedRequests = 0;
  const sources = await collectEstimatesInProcess(
    {
      beforeRequest: () => { guardedRequests++; },
      dateWindow: { from: "10/12/2026", to: "10/13/2026" },
      credentials: {
        networkUsername: "network-user",
        networkPassword: "network-password",
        username: "crm-user",
        password: "crm-password",
      },
    },
    { fetch: fakeFetch },
  );

  assert.equal(guardedRequests, requests.length * 2);
  assert.equal(sources[0]?.sections.followUpEstimates.length, 2);
  assert.ok(requests.every((request) => !request.url.includes("mprep")));
  const posted = requests.find((request) => request.url.includes("estprocessret"));
  assert.ok(posted);
  assert.equal(posted.method, "POST");
  const body = new URLSearchParams(posted.body);
  assert.equal(body.get("STATUS"), "V9");
  assert.equal(body.get("TYPEDTE"), "OPEN");
  assert.equal(body.get("DATE1"), "10/12/2026");
  assert.equal(body.get("DATE2"), "10/13/2026");
  assert.equal(body.get("FUSTATUS"), "10");
  assert.equal(body.get("USER"), "");
  assert.equal(body.get("DEPT"), "ALL");
  assert.equal(body.get("TYPE"), "V1");
  assert.equal(body.get("SORT"), "V6");
  assert.ok(requests.some((request) => request.url.includes("estprocesswc")));
  assert.equal(body.get("STATUS") === "V15", false);
});

test("a label that permits both routes, or neither, stays in the plan and is not approvable", async () => {
  const seen: { form: string[]; call: string[] } = { form: [], call: [] };
  const plan = await assembleEstimatesPlan(
    [
      collection("Form Only", "P1"),
      collection("Call Only", "P2"),
      collection("Both", "P3"),
      collection("Missing", "P4"),
    ],
    {
      runId: "507f1f77bcf86cd799439011",
      lookup: async (label) => {
        if (label === "Form Only") return [registrySource("a".repeat(24), ["FormLead"])];
        if (label === "Call Only") return [registrySource("b".repeat(24), ["CallLead"])];
        if (label === "Both") return [registrySource("c".repeat(24), ["FormLead", "CallLead"])];
        return [];
      },
      planForm: async (sources) => {
        seen.form = sources.map((source) => source.sourceLabel);
        return emptyFormPlan(sources);
      },
      planCall: async (sources) => {
        seen.call = sources.map((source) => source.sourceLabel);
        return {
          kind: "call_leads",
          schema_version: 1,
          actions: sources.flatMap((source) =>
            source.sections.followUpEstimates.map((row) => ({
              action_id: `enrichment:${source.sourceLabel}:${row.id}`,
              operation: "enrichment" as const,
              row: { row_id: `${source.sourceLabel}:${row.id}`, row_index: row.rowIndex },
              preview: { status: "updateable" },
              syncable: true,
              target_binding: {
                call_lead_id: null,
                call_lead_updated_at: null,
                booking_id: null,
                booking_updated_at: null,
                receiver_username: null,
                expected_receiver_agent: null,
                target_receiver_agent: null,
              },
            })),
          ),
          counters: { updateable: sources.length },
        };
      },
    },
  );

  assert.deepEqual(seen.form, ["Form Only"]);
  assert.deepEqual(seen.call, ["Call Only"]);
  assert.equal(plan.kind, "estimates_in_process");
  assert.equal(plan.schema_version, 2);
  const unresolved = plan.actions.filter((action) => action.action_id.startsWith("unresolved:"));
  assert.equal(unresolved.length, 2);
  assert.ok(unresolved.every((action) => "syncable" in action && action.syncable === false));
  assert.equal(plan.counters.both_routes, 1);
  assert.equal(plan.counters.missing_registry, 1);
  assert.ok(
    plan.actions.every(
      (action) =>
        action.lifecycle_apply?.operation_kind === "lead_snapshot_apply" &&
        action.lifecycle_apply.granot_statement.event_type == null,
    ),
  );
});

test("registry route is unresolved when both operations are ready", () => {
  const both = estimatesRouteForMatches([registrySource("c".repeat(24), ["FormLead", "CallLead"])]);
  assert.deepEqual(both, { route: "unresolved", reason: "both_routes" });
  const call = estimatesRouteForMatches([registrySource("b".repeat(24), ["CallLead"])]);
  assert.equal(call.route, "call_leads");
  const missing = estimatesRouteForMatches([]);
  assert.equal(missing.reason, "missing_registry");
});

test("matched unchanged Form and Call snapshots still enter lifecycle priority decisions", async () => {
  const form = collection("Form Only", "P100");
  const call = collection("Call Only", "P200");
  const plan = await assembleEstimatesPlan([form, call], {
    runId: "507f1f77bcf86cd799439011",
    lookup: async (label) => [registrySource("a".repeat(24), [label === "Form Only" ? "FormLead" : "CallLead"])],
    planForm: async (sources) => {
      const planned = emptyFormPlan(sources);
      planned.actions[0]!.classification = "unchanged";
      planned.actions[0]!.lead_id = "b".repeat(24);
      planned.counters.no_match = 0;
      planned.counters.unchanged = 1;
      return planned;
    },
    planCall: async () => ({
      kind: "call_leads",
      schema_version: 1,
      actions: [{
        action_id: `enrichment:Call Only:${call.sections.followUpEstimates[0]!.id}`,
        operation: "enrichment",
        row: { row_id: `Call Only:${call.sections.followUpEstimates[0]!.id}`, row_index: 1 },
        preview: { status: "unchanged" },
        syncable: false,
        target_binding: {
          call_lead_id: "c".repeat(24), call_lead_updated_at: null,
          booking_id: null, booking_updated_at: null, receiver_username: "DEV",
          expected_receiver_agent: "d".repeat(24), target_receiver_agent: null,
        },
      }],
      counters: { unchanged: 1 },
    }),
  });
  const [formAction, callAction] = plan.actions;
  assert.ok(formAction && "classification" in formAction);
  assert.equal(formAction.classification, "update");
  assert.equal(formAction.reason, "lifecycle_snapshot_check");
  assert.ok(callAction && "syncable" in callAction);
  assert.equal(callAction.syncable, true);
  assert.equal(formAction.lifecycle_apply?.granot_statement.priority, "0");
  assert.equal(callAction.lifecycle_apply?.granot_statement.priority, "0");
  assert.equal(plan.counters.update, 1);
  assert.equal(plan.counters.unchanged, 1);
});

function collection(label: string, job: string): GranotSourceCollection {
  return {
    sourceLabel: label,
    contentHash: label,
    sectionSchemas: { bookedJobs: "missing", followUpEstimates: "table" },
    sections: {
      bookedJobs: [],
      followUpEstimates: [{
        id: `estimates:1:${job}`,
        rowIndex: 1,
        values: { job_no: job, source: label, customer: "Sample Customer", phone: "555-0100", prior: "0", priority: "0" },
      }],
    },
  };
}

function emptyFormPlan(sources: GranotSourceCollection[]): GranotFormPlan {
  const actions = sources.flatMap((source) =>
    source.sections.followUpEstimates.map((row) => ({
      action_id: `${source.sourceLabel}:${row.id}`,
      row_id: row.id,
      source_label: source.sourceLabel,
      table_section: "followUpEstimates" as const,
      classification: "no_match" as const,
    })),
  );
  return {
    kind: "form_leads",
    schema_version: 1,
    actions,
    counters: { update: 0, unchanged: 0, conflict: 0, no_match: actions.length, invalid: 0 },
  };
}

function registrySource(
  id: string,
  models: Array<"FormLead" | "CallLead">,
): GranotAutomationCompatibilitySource {
  return {
    id,
    enabled: true,
    lifecycle_enabled: true,
    lifecycle_disposition: "source_scoped_lead",
    lifecycle_routes: models.map((lead_model) => ({ lead_model })),
  };
}

function response(body: string): Response {
  return new Response(body, { status: 200 });
}

test("Estimates requires mapped columns and direct row alignment", () => {
  const missing = parseEstimatesInProcessHtml('<table><tr><th>job_no</th><th>customer</th></tr><tr><td>P1</td><td>Sample</td></tr></table>');
  assert.equal(missing.recognized, false);
  assert.ok(missing.diagnostics.includes('required_headers_missing_or_ambiguous'));
  const shifted = parseEstimatesInProcessHtml(ESTIMATES_HTML.replace('<td>555-0100</td>', ''));
  assert.equal(shifted.recognized, false);
  assert.ok(shifted.diagnostics.includes('data_row_cell_count_mismatch'));
});

test("ambiguous/malformed priority remains held and blank fields are accepted", () => {
  for (const priority of ['prior: 0 prior: 1', 'prior: 10', 'prior: nope prior: 1', 'prior: 1.5', 'prior: 1x', 'prior: 1_2', 'prior: Poolish', 'prior: Pool.5', 'prior: Pool prior: 1']) {
    const parsed = parseEstimatesInProcessHtml(ESTIMATES_HTML.replace('prior: 0', priority));
    assert.equal(parsed.recognized, true);
    const row = parsed.sources[0]!.sections.followUpEstimates[0]!;
    assert.equal(row.values.priority, undefined);
    assert.equal(row.values.estimates_hold_reason, 'missing_or_ambiguous_priority');
  }
  const parsed = parseEstimatesInProcessHtml(ESTIMATES_HTML.replace('<td>001REF</td>', '<td></td>'));
  assert.equal(parsed.recognized, true);
  assert.equal(parsed.sources[0]!.sections.followUpEstimates[0]!.values.ref_no, undefined);
  assert.equal(parseEstimatesInProcessHtml(ESTIMATES_HTML).sources[0]!.sections.followUpEstimates[0]!.values.ref_no, '001REF');
});

test("explicit empty and pagination summaries are validated", () => {
  assert.equal(parseEstimatesInProcessHtml('<h1>Follow-Up Estimates, Total of: 0 Transactions</h1>').recognized, true);
  assert.equal(parseEstimatesInProcessHtml('<h1>No leads</h1>').recognized, false);
  const pager = parseEstimatesInProcessHtml(ESTIMATES_HTML + '<a href="/page2">Next</a>');
  assert.equal(pager.recognized, false);
  assert.ok(pager.diagnostics.includes('unsupported_pagination'));
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


test("actual provider form shapes and timestamp Open Date remain verified", () => {
  const form = ESTIMATES_FORM.replace('action="/wc.dll?mv~estprocessret~SYNTHETIC"', 'name="theForm"').replace('value="ALL">ALL', '>ALL').replace('value="">All users', '></option><option value="EXAMPLE">Example') + '<script>document.theForm.action="/wc.dll?mv~estprocessret~SYNTHETIC";</script>';
  assert.equal(verifyEstimatesForm(form), true);
  const parsed = parseEstimatesInProcessHtml(ESTIMATES_HTML.replaceAll('10/12/2026', '10/12/2026 12:44:11 am'));
  const row = parsed.sources[0]!.sections.followUpEstimates[0]!;
  assert.equal(row.values.open_date, '10/12/2026');
  assert.equal(row.values.open_date_evidence, '10/12/2026 12:44:11 am');
  assert.equal(row.values.estimates_hold_reason, undefined);
});


test("unsupported large renderer splits but incomplete single-day renderer fails closed", async () => {
  const broad = '<h1>Follow-Up Estimates, Total of: 4 Transactions</h1><pre>Synthetic fixed-width report</pre>';
  const pages = [ESTIMATES_FORM, broad, ESTIMATES_HTML, ESTIMATES_HTML.replaceAll('P556236','P856236').replaceAll('10/12/2026','10/13/2026')];
  const sources = await collectVerifiedEstimates({ sessionToken:'SYNTHETIC', request:async () => pages.shift()! }, { from:'10/12/2026', to:'10/13/2026' }, {});
  assert.equal(sources[0]!.sections.followUpEstimates.length,4);
  const singleDay = [ESTIMATES_FORM, broad];
  await assert.rejects(collectVerifiedEstimates({ sessionToken:'SYNTHETIC', request:async () => singleDay.shift()! }, { from:'10/12/2026', to:'10/12/2026' }, {}), /schema invalid/);
});

test("provider ignoring requested Open Date partitions fails closed", async () => {
  const pages = [ESTIMATES_FORM, ESTIMATES_HTML];
  await assert.rejects(collectVerifiedEstimates({ sessionToken:'SYNTHETIC', request:async () => pages.shift()! }, { from:'10/13/2026', to:'10/13/2026' }, {}), /outside the requested/);
});


test("verified Granot Pool label is canonical priority 9 without importing membership policy", () => {
  const parsed = parseEstimatesInProcessHtml(ESTIMATES_HTML.replace('prior: 0','prior: Pool'));
  const row = parsed.sources[0]!.sections.followUpEstimates[0]!;
  assert.equal(row.values.priority,'9');
  assert.equal(row.values.prior,'9');
  assert.equal(row.values.estimates_hold_reason,undefined);
  assert.equal(verifyEstimatesForm(ESTIMATES_FORM.replace('value="9">Pool','value="9">Other')),false);
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

test("invalid provider move date stays held rather than becoming a guessed valid date", () => {
  for (const cell of ['02/30/2026<br> / /', 'nonsense<br>10/22/2026', '10/20/2026junk<br> / /']) {
    const parsed = parseEstimatesInProcessHtml(ESTIMATES_HTML.replace('<td>10/20/2026</td>', `<td>${cell}</td>`));
    const row = parsed.sources[0]!.sections.followUpEstimates[0]!;
    assert.equal(row.values.estimates_hold_reason,'invalid_move_date');
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

test("blank primary email is not replaced by a provider annotation", () => {
  const row = parseEstimatesInProcessHtml(ESTIMATES_HTML.replace('<td>sample@example.test</td>', '<td><br><b>LABEL</b></td>')).sources[0]!.sections.followUpEstimates[0]!;
  assert.equal(row.values.email,undefined);
  assert.equal(row.values.email_annotation_evidence,'LABEL');
});
