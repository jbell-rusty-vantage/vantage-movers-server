import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGranotOperationPayloads,
  collectGranotReport,
  parseGranotSourceReport,
  type GranotSourceCollection,
} from "./index";

const SOURCE_REPORT_HTML = `
<!doctype html>
<html>
  <body>
    <h2>Booked Jobs</h2>
    <table>
      <tr>
        <th>no</th><th>job_no</th><th>source</th><th>prior</th>
        <th>book_date</th><th>customer</th><th>phone</th><th>user</th>
      </tr>
      <tr>
        <td>1</td><td>90001</td><td>TBM Forms Prime</td><td>1</td>
        <td>08/04/2026</td><td>Sample Customer</td><td>555-0100</td><td>DEV</td>
      </tr>
      <tr><td colspan="8">Totals</td></tr>
    </table>
    <h2>Follow Up Estimates</h2>
    <table>
      <tr>
        <th>no</th><th>job_no</th><th>source</th><th>customer</th>
        <th>phone</th><th>email</th><th>from</th><th>from_zip</th>
        <th>to</th><th>to_zip</th><th>est_cf</th><th>rep</th>
      </tr>
      <tr>
        <td>2</td><td>90002</td><td>TBM Forms Prime</td><td>Another Customer</td>
        <td>555-0101</td><td>sample@example.test</td><td>Miami, FL</td><td>33101</td>
        <td>Orlando, FL</td><td>32801</td><td>1,250</td><td>DEV</td>
      </tr>
    </table>
  </body>
</html>`;

test("source report parsing returns both Granot lead sections with job numbers", () => {
  const result: GranotSourceCollection = parseGranotSourceReport(
    SOURCE_REPORT_HTML,
    "TBM Forms Prime",
  );

  assert.equal(result.sourceLabel, "TBM Forms Prime");
  assert.equal(result.sections.bookedJobs.length, 1);
  assert.equal(result.sections.followUpEstimates.length, 1);
  assert.equal(result.sections.bookedJobs[0]?.values.job_no, "90001");
  assert.equal(result.sections.followUpEstimates[0]?.values.job_no, "90002");
  assert.equal(result.sections.followUpEstimates[0]?.values.est_cf, "1,250");
});

test("source report parsing finds Granot's nested tables after centered headings", () => {
  const nestedHtml = SOURCE_REPORT_HTML.replaceAll(
    /<h2>(.*?)<\/h2>\s*<table>([\s\S]*?)<\/table>/g,
    "<center><b><h3>$1</h3></b></center><table><tr><td><center><table>$2</table></center></td></tr></table>",
  );

  const result = parseGranotSourceReport(nestedHtml, "TBM Forms Prime");

  assert.equal(result.sections.bookedJobs[0]?.values.job_no, "90001");
  assert.equal(result.sections.followUpEstimates[0]?.values.job_no, "90002");
});

test("content hashes ignore per-login Granot session tokens", () => {
  const first = parseGranotSourceReport(
    `${SOURCE_REPORT_HTML}<a href="/wc.dll?download~AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA">CSV</a>`,
    "TBM Forms Prime",
  );
  const second = parseGranotSourceReport(
    `${SOURCE_REPORT_HTML}<a href="/wc.dll?download~BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB">CSV</a>`,
    "TBM Forms Prime",
  );

  assert.equal(first.contentHash, second.contentHash);
});

test("collected rows map to existing call-lead endpoint payloads", () => {
  const collection = parseGranotSourceReport(
    SOURCE_REPORT_HTML,
    "TBM Forms Prime",
  );

  const payloads = buildGranotOperationPayloads([collection]);

  assert.deepEqual(payloads.enrichmentRows[0], {
    row_id: "TBM Forms Prime:followUpEstimates:1:90002",
    row_index: 1,
    job_no: "90002",
    source: "TBM Forms Prime",
    customer: "Another Customer",
    phone: "555-0101",
    granot_crm_username: "DEV",
    email: "sample@example.test",
    from: "Miami, FL",
    from_zip: "33101",
    to: "Orlando, FL",
    to_zip: "32801",
    est_cf: "1,250",
  });
  assert.equal(payloads.bookedReconciliationRows[0]?.job_no, "90001");
  assert.equal(payloads.bookedReconciliationRows[0]?.section, "bookedJobs");
});

test("call-lead payloads never expose or interpret Granot ref_no", () => {
  const collection = parseGranotSourceReport(
    SOURCE_REPORT_HTML.replace(
      "<th>phone</th><th>email</th>",
      "<th>phone</th><th>email</th><th>ref_no</th>",
    ).replace(
      "<td>555-0101</td><td>sample@example.test</td>",
      "<td>555-0101</td><td>sample@example.test</td><td>mongo-looking-ref</td>",
    ),
    "TBM Forms Prime",
  );
  assert.equal(
    collection.sections.followUpEstimates[0]?.values.ref_no,
    "mongo-looking-ref",
  );
  const payloads = buildGranotOperationPayloads([collection]);
  assert.equal("ref_no" in (payloads.enrichmentRows[0] ?? {}), false);
  assert.equal(
    JSON.stringify(payloads).includes("mongo-looking-ref"),
    false,
  );
});

test("collector follows the Granot report flow and records absent sources", async () => {
  const requests: Array<{ url: string; method: string; cookie?: string }> = [];
  const sourceCheckpoints: string[] = [];
  const token = "A04F50BA-B981-44A9-9930-9E7FEC2B8201";
  const responses = [
    response(
      `<form action="/network-login"><input name="CUSTID" value="VANTAGE"></form>`,
      { "set-cookie": "network=one; Path=/; HttpOnly" },
    ),
    response(`<form action="/user-login"><input name="LOCATION" value="1"></form>`),
    response(`<a href="/wc.dll?mprep~repmenuwc~${token}">Reports</a>`),
    response(`<html><body>Reports</body></html>`),
    response(`<form><input name="DATE1"><input name="DATE2"></form>`),
    response(
      `<html><body><h1>All Leads and Advertising</h1>
       <a href="/wc.dll?mprep~adverlistwc~${token}~TBM%20Forms%20Prime">TBM Forms Prime</a>
       <a href="/wc.dll?mprep~adverlistwc~${token}~TBM%20Forms%20Prime~USERLIST">Reps</a>
       </body></html>`,
    ),
    response(SOURCE_REPORT_HTML),
  ];
  const fakeFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      cookie: headers.get("cookie") ?? undefined,
    });
    const next = responses.shift();
    assert.ok(next, `unexpected request to ${String(input)}`);
    return next;
  };

  const result = await collectGranotReport(
    {
      dateWindow: { from: "08/03/2026", to: "08/04/2026" },
      sourceLabels: ["TBM Forms Prime", "Main Site Forms"],
      credentials: {
        networkUsername: "network-user",
        networkPassword: "network-password",
        username: "crm-user",
        password: "crm-password",
      },
    },
    {
      fetch: fakeFetch,
      beforeSource: async (sourceLabel) => {
        sourceCheckpoints.push(sourceLabel);
      },
    },
  );

  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.discoveredSourceLabels, ["TBM Forms Prime"]);
  assert.deepEqual(result.notObservedSourceLabels, ["Main Site Forms"]);
  assert.equal(result.sources[0]?.sections.bookedJobs[0]?.values.job_no, "90001");
  assert.equal(requests[1]?.method, "POST");
  assert.equal(requests[2]?.cookie, "network=one");
  assert.equal(requests[5]?.method, "POST");
  assert.match(requests[6]?.url ?? "", /TBM%20Forms%20Prime$/);
  assert.deepEqual(sourceCheckpoints, ["TBM Forms Prime"]);
});

test("collector retries the full flow when the source page expires the session", async () => {
  const token = "A04F50BA-B981-44A9-9930-9E7FEC2B8201";
  const successfulFlow = [
    response(`<form action="/network-login"></form>`),
    response(`<form action="/user-login"></form>`),
    response(`<a href="/wc.dll?mprep~repmenuwc~${token}">Reports</a>`),
    response("Reports"),
    response(`<input name="DATE1"><input name="DATE2">`),
    response(
      `<a href="/wc.dll?mprep~adverlistwc~${token}~TBM%20Forms%20Prime">TBM Forms Prime</a>`,
    ),
    response(SOURCE_REPORT_HTML),
  ];
  const responses = [
    response(`<form action="/network-login"></form>`),
    response(`<form action="/user-login"></form>`),
    response(`<a href="/wc.dll?mprep~repmenuwc~${token}">Reports</a>`),
    response("Reports"),
    response(`<input name="DATE1"><input name="DATE2">`),
    response(
      `<a href="/wc.dll?mprep~adverlistwc~${token}~TBM%20Forms%20Prime">TBM Forms Prime</a>`,
    ),
    response("<html><body>Close Window</body></html>"),
    ...successfulFlow,
  ];
  const requestedUrls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    requestedUrls.push(String(input));
    const next = responses.shift();
    assert.ok(next, `unexpected request to ${String(input)}`);
    return next;
  };

  const result = await collectGranotReport(
    {
      dateWindow: { from: "08/03/2026", to: "08/04/2026" },
      sourceLabels: ["TBM Forms Prime"],
      credentials: {
        networkUsername: "network-user",
        networkPassword: "network-password",
        username: "crm-user",
        password: "crm-password",
      },
    },
    { fetch: fakeFetch },
  );

  assert.equal(result.sources.length, 1);
  assert.equal(
    requestedUrls.filter((url) => url.includes("NetLogonWc")).length,
    2,
  );
});

test("collector rejects impossible date windows before contacting Granot", async () => {
  let requests = 0;
  await assert.rejects(
    collectGranotReport(
      {
        dateWindow: { from: "02/30/2026", to: "02/01/2026" },
        sourceLabels: [],
        credentials: {
          networkUsername: "network-user",
          networkPassword: "network-password",
          username: "crm-user",
          password: "crm-password",
        },
      },
      {
        fetch: async () => {
          requests += 1;
          return response("");
        },
      },
    ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "invalid_request",
  );
  assert.equal(requests, 0);
});

function response(
  body: string,
  headers?: HeadersInit,
): Response {
  return new Response(body, { status: 200, headers });
}
