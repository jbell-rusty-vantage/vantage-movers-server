import assert from "node:assert/strict";
import { test } from "node:test";
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

const ESTIMATES_HTML = `
<table>
  <tr>
    <th>job_no</th><th>open_date</th><th>follow_up</th><th>user</th>
    <th>customer</th><th>email</th><th>phone1</th><th>phone2</th>
    <th>from_city</th><th>from_state</th><th>from_zip</th>
    <th>cf</th><th>miles</th><th>lbs</th><th>rate</th><th>source</th>
    <th><table><tr><th>nested header</th></tr></table></th>
  </tr>
  <tr>
    <td>P5562366</td><td>10/12/2026</td><td>prior: 0</td><td>DEV</td>
    <td>Sample Customer</td><td>sample@example.test</td><td>555-0100</td><td>555-0199</td>
    <td>Miami</td><td>FL</td><td>33101</td>
    <td>250</td><td>12</td><td>400</td><td>1.5</td><td>Top10 Inbounds</td>
    <td>123 Example St</td>
  </tr>
  <tr>
    <td></td><td></td><td></td><td></td>
    <td>Totals</td><td></td><td></td><td></td>
    <td></td><td></td><td></td>
    <td>900</td><td>40</td><td>1000</td><td>3</td><td></td>
    <td></td>
  </tr>
  <tr>
    <td>P5562367</td><td>10/12/2026</td><td>called yesterday</td><td>DEV</td>
    <td>No Priority</td><td></td><td>555-0101</td><td></td>
    <td>Orlando</td><td>FL</td><td>32801</td>
    <td>10</td><td></td><td></td><td></td><td>Top10 Inbounds</td>
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
  assert.equal(rows[0]?.values.phone2, undefined);
  assert.equal(rows[0]?.values.miles, undefined);
  assert.equal(rows[0]?.values.open_date, undefined);
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
    response(`<html><body>Estimates</body></html>`),
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

  const sources = await collectEstimatesInProcess(
    {
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
