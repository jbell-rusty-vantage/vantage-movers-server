import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDirectoryLookup } from "./directory";
import { directoryDigest, normalizeDirectory, ringCentralDirectoryFetcher } from "./directorySync";

const raw = () => ({
  extensions: [
    { id: 902, extensionNumber: "102", type: "User", name: "Rep Two", status: "Enabled" },
    { id: "901", extensionNumber: "101", type: "User", name: "Rep One", status: "Enabled" },
    { id: "950", extensionNumber: "201", type: "Department", name: "Sales Queue", status: "Enabled" },
    { id: "960", extensionNumber: "300", type: "IvrMenu", name: "Main Menu" },
    { noId: true },
  ],
  phoneNumbers: [
    { id: "n1", phoneNumber: "+15550100101", usageType: "DirectNumber", extension: { id: "901" }, features: ["CallerId", "SmsSender"] },
    { id: "n2", phoneNumber: "(555) 010-0100", usageType: "MainCompanyNumber", features: ["CallerId"] },
    { id: "n3", phoneNumber: "+15550100102", usageType: "DirectNumber", extension: { id: "902" } },
    { id: "bad", phoneNumber: "abc" },
  ],
  queues: [{ id: "950", extensionNumber: "201", name: "Sales Queue" }],
  queueMembers: new Map<string, unknown[]>([["950", [{ id: "902" }, { id: "901" }]]]),
});

test("normalizeDirectory reduces provider records to the snapshot shape deterministically; digest is order-independent", () => {
  const normalized = normalizeDirectory(raw());
  assert.deepEqual(normalized.counts, { extensions: 4, users: 2, departments: 1, company_numbers: 3, queues: 1 });
  assert.deepEqual(normalized.extensions.map((e) => e.id), ["901", "902", "950", "960"], "sorted by id; numeric ids stringified; rows without id dropped");
  const rep1 = normalized.extensions.find((e) => e.id === "901")!;
  assert.deepEqual(rep1.direct_numbers, ["+15550100101"]);
  assert.deepEqual(rep1.sms_sender_numbers, ["+15550100101"]);
  assert.equal(normalized.extensions.find((e) => e.id === "960")!.status, "Unknown", "missing status is not invented as Enabled");
  assert.deepEqual(normalized.company_numbers.map((n) => n.e164), ["+15550100100", "+15550100101", "+15550100102"], "E.164 normalized, malformed dropped");
  assert.equal(normalized.company_numbers[0]!.extension_id, null);
  assert.deepEqual(normalized.queues[0]!.member_extension_ids, ["901", "902"]);

  const shuffled = raw();
  shuffled.extensions.reverse();
  shuffled.phoneNumbers.reverse();
  assert.equal(directoryDigest(normalizeDirectory(shuffled)), directoryDigest(normalized), "same directory, same digest");
  const changed = raw();
  changed.extensions.push({ id: "903", extensionNumber: "103", type: "User", name: "Rep Three", status: "Enabled" });
  assert.notEqual(directoryDigest(normalizeDirectory(changed)), directoryDigest(normalized));

  // The CSI-02 lookup consumes exactly this shape.
  const lookup = buildDirectoryLookup({ provider_account_id: "800000000001", taken_at: new Date(), ...normalized });
  assert.equal(lookup.extensionByNumber("101")?.id, "901");
  assert.equal(lookup.companyNumberByE164("+15550100100")?.usage_type, "MainCompanyNumber");
  assert.equal(lookup.isQueueExtension("950"), true);
  assert.equal(lookup.isQueueExtension("901"), false);
});

test("fetcher issues the documented account, extension, phone-number and call-queue reads over the shared client", async () => {
  const calls: string[] = [];
  const fetcher = ringCentralDirectoryFetcher((async (method: string, endpoint: string) => {
    calls.push(`${method} ${endpoint}`);
    return { records: [] };
  }) as never);
  await fetcher.account();
  await fetcher.extensions(2);
  await fetcher.phoneNumbers(1);
  await fetcher.callQueues(1);
  await fetcher.callQueueMembers("9 50");
  assert.deepEqual(calls, [
    "GET /restapi/v1.0/account/~",
    "GET /restapi/v1.0/account/~/extension?perPage=1000&page=2",
    "GET /restapi/v1.0/account/~/phone-number?perPage=1000&page=1",
    "GET /restapi/v1.0/account/~/call-queues?perPage=1000&page=1",
    "GET /restapi/v1.0/account/~/call-queues/9%2050/members?perPage=1000",
  ]);
});
