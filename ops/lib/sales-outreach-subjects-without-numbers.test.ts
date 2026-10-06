import assert from "node:assert/strict";
import { test } from "node:test";
import type { Document } from "mongodb";
import { SYNTHETIC_COMPANY_DID } from "../../src/services/numberActivity/fixtures";
import type { DeskStateReader } from "./sales-outreach-desk-state";
import {
  classifyNumberless, collectSubjectsWithoutNumbers, maskE164, parseDiagnosticArgs, shadowingLead, type DiagnosticNumber,
} from "./sales-outreach-subjects-without-numbers";

/** Just enough of Mongo's matcher for the diagnostic's filters (equality, $ne, $gt, $in, $or). */
function matches(doc: Document, filter: Document): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === "$or") return (condition as Document[]).some((clause) => matches(doc, clause));
    const value = key.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as Document)[k] : undefined), doc);
    if (condition && typeof condition === "object" && !Array.isArray(condition)) {
      const c = condition as Document;
      if ("$ne" in c) return String(value) !== String(c.$ne);
      if ("$gt" in c) return String(value) > String(c.$gt);
      if ("$in" in c) return (c.$in as unknown[]).map(String).includes(String(value));
    }
    return String(value) === String(condition);
  });
}

function memoryReader(collections: Record<string, Document[]>, log: string[] = []): DeskStateReader {
  return {
    count: async (name, filter = {}) => (collections[name] ?? []).filter((doc) => matches(doc, filter)).length,
    aggregate: async () => { throw new Error("not used"); },
    findOne: async (name, filter) => (collections[name] ?? []).find((doc) => matches(doc, filter)) ?? null,
    find: async (name, filter, { sort, limit }) => {
      log.push(name);
      let rows = (collections[name] ?? []).filter((doc) => matches(doc, filter));
      if (sort?._id === 1) rows = [...rows].sort((a, b) => String(a._id).localeCompare(String(b._id)));
      if (sort?.taken_at === -1) rows = [...rows].sort((a, b) => +b.taken_at - +a.taken_at);
      return rows.slice(0, limit);
    },
  };
}

const number = (id: string, e164: string, extra: Partial<DiagnosticNumber> = {}): DiagnosticNumber => ({ _id: id, e164, purged_at: null, lead: null,
  other_leads: [], lead_link: { excluded: [] }, ...extra });

test("diagnostic args: target required, read-only, unknown flags refused; phones masked to the last four digits", () => {
  assert.deepEqual(parseDiagnosticArgs(["--target=testdb"]), { target: "testdb", out: null, pretty: false });
  assert.deepEqual(parseDiagnosticArgs(["--target=vantagemovers", "--out=x.json", "--pretty"]), { target: "vantagemovers", out: "x.json", pretty: true });
  assert.throws(() => parseDiagnosticArgs([]), /--target/);
  assert.throws(() => parseDiagnosticArgs(["--target=x", "--apply"]), /read-only/);
  assert.throws(() => parseDiagnosticArgs(["--target=x", "--force"]), /Unknown argument/);
  assert.equal(maskE164("+12025550100"), "…0100");
  assert.equal(maskE164(null), null);
});

test("numberless reasons, in order, from the All Numbers link rules", () => {
  const directory = { companyNumberByE164: (e164: string) => (e164 === SYNTHETIC_COMPANY_DID ? { id: "1", e164, usage_type: null, extension_id: null } : null) } as never;
  const lead = (extra: Document = {}) => ({ _id: "L1", normalized_phone_number: "2025550100", ...extra });
  const classify = (leadRow: Document | null, numbers: DiagnosticNumber[] = []) => classifyNumberless({ lead_model: "CallLead", lead_id: "L1", lead: leadRow,
    numbersByE164: new Map(numbers.map((n) => [n.e164, n])), directory }).reason;
  assert.equal(classify(null), "lead_missing");
  assert.equal(classify(lead({ normalized_phone_number: null })), "no_phone");
  assert.equal(classify(lead({ normalized_phone_number: "12" })), "phone_not_e164");
  assert.equal(classify(lead({ normalized_phone_number: SYNTHETIC_COMPANY_DID.slice(2) })), "company_number");
  assert.equal(classify(lead({ duplicate: true })), "lead_not_candidate");
  assert.equal(classify(lead({ bad_lead: "spam" })), "lead_not_candidate");
  assert.equal(classify(lead()), "no_contact_number");
  assert.equal(classify(lead(), [number("N1", "+12025550100", { purged_at: new Date() })]), "number_purged");
  assert.equal(classify(lead(), [number("N1", "+12025550100", { other_leads: [{ model: "CallLead", id: "L1" }] })]), "stale_subject");
  assert.equal(classify(lead(), [number("N1", "+12025550100", { lead_link: { excluded: [{ model: "CallLead", id: "L1" }] } })]), "excluded_by_owner");
  assert.equal(classify(lead(), [number("N1", "+12025550100", { other_leads: Array.from({ length: 10 }, (_, i) => ({ model: "FormLead", id: `F${i}` })) })]), "link_truncated");
  assert.equal(classify(lead(), [number("N1", "+12025550100")]), "link_pending");
  assert.equal(classify(lead({ normalized_phone_number: null, ringcentral: { original_caller: { normalized_phone_number: "2025550100" } } })), "no_contact_number",
    "the original caller is a phone path too");
});

test("shadowed: the subject's numbers credit another Lead (or none)", () => {
  assert.deepEqual(shadowingLead("CallLead", "L1", [number("N1", "+1", { lead: { model: "CallLead", id: "L1" } })]), { shadowed: false });
  assert.deepEqual(shadowingLead("CallLead", "L1", [number("N2", "+2", { lead: { model: "FormLead", id: "F9" }, other_leads: [{ model: "CallLead", id: "L1" }] })]),
    { shadowed: true, lead: { model: "FormLead", id: "F9" }, e164: "+2" });
  assert.deepEqual(shadowingLead("CallLead", "L1", [number("N3", "+3")]), { shadowed: true, lead: null, e164: "+3" });
});

test("collector: counts every open subject by reason and shadow state; lists masked rows; reads only", async () => {
  const at = new Date("2026-08-01T12:00:00Z");
  const subject = (id: string, lead_model: string, lead_id: string, contact_number_ids: string[] = [], status = "active") =>
    ({ _id: id, status, lead_model, lead_id, received_at: at, contact_number_ids });
  const reads: string[] = [];
  const summary = await collectSubjectsWithoutNumbers(memoryReader({
    sales_outreach_subjects: [
      subject("S1", "CallLead", "C1"), subject("S2", "CallLead", "C2"), subject("S3", "FormLead", "F3"),
      subject("S4", "CallLead", "C4", ["N4"]), subject("S5", "CallLead", "C5", ["N5"]), subject("S6", "CallLead", "C6", ["N6"]),
      subject("S7", "FormLead", "F7", ["N7"]), subject("S8", "CallLead", "C8", [], "review"), subject("S9", "CallLead", "C9", [], "closed"),
      subject("S10", "FormLead", "F10", [], "closed"),
    ],
    call_leads: [
      { _id: "C1", normalized_phone_number: "2025550101" }, { _id: "C2", normalized_phone_number: "2025550102" },
      { _id: "C8", normalized_phone_number: null },
    ],
    form_leads: [{ _id: "F3", normalized_phone_number: "2025550103" }],
    contact_numbers: [
      number("N2", "+12025550102", { lead: { model: "FormLead", id: "F99" }, other_leads: [{ model: "CallLead", id: "C2" }] }),
      number("N4", "+12025550104", { lead: { model: "CallLead", id: "C4" } }),
      number("N5", "+12025550105", { lead: { model: "FormLead", id: "F7" }, other_leads: [{ model: "CallLead", id: "C5" }] }),
      number("N6", "+12025550106", { lead: { model: "CallLead", id: "C9" }, other_leads: [{ model: "CallLead", id: "C6" }] }),
      number("N7", "+12025550107", { lead: { model: "FormLead", id: "F404" }, other_leads: [{ model: "FormLead", id: "F7" }] }),
    ],
    ringcentral_directory_snapshots: [],
  }, reads), { database: "testdb", now: at, account: null });

  assert.equal(summary.open_subjects_checked, 8, "closed subjects are not checked");
  assert.equal(summary.without_numbers.total, 4);
  assert.equal(summary.without_numbers.by_reason.no_contact_number, 2, "C1 and F3: no row for their phone");
  assert.equal(summary.without_numbers.by_reason.stale_subject, 1, "C2: the link holds it, the subject was not re-synced");
  assert.equal(summary.without_numbers.by_reason.no_phone, 1);
  assert.deepEqual(summary.without_numbers.by_status, { active: 3, review: 1 });
  assert.equal(summary.active_without_number_lead_has_phone, 3, "no_phone never counts; the review subject is not active");
  assert.deepEqual(summary.shadowed.by_state, { active_subject: 1, closed_subject: 1, not_enrolled: 1, no_lead: 0 },
    "S5 shadowed by F7 (open subject), S6 by C9 (closed subject), S7 by F404 (no subject); S4 is credited");
  assert.equal(summary.rows.length, 7);
  const s1 = summary.rows.find((row) => row.subject_id === "S1")!;
  assert.deepEqual(s1, { subject_id: "S1", status: "active", lead_model: "CallLead", lead_id: "C1", received_at: at.toISOString(),
    reason: "no_contact_number", shadow_state: null, e164_masked: "…0101" });
  assert.equal(summary.rows.find((row) => row.subject_id === "S5")!.shadow_state, "active_subject");
  assert.ok(!JSON.stringify(summary).includes("2025550101"), "no full phone leaves the collector");
  assert.equal(summary.directory_loaded, false);
  assert.ok(reads.every((name) => ["sales_outreach_subjects", "call_leads", "form_leads", "contact_numbers", "ringcentral_directory_snapshots"].includes(name)));
});
