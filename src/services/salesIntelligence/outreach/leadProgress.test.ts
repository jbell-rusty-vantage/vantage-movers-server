import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import { closureBasisFor, dispositionFor, evidenceMatchesCurrent, priorityLabel, progressExplanation, projectLeadProgress, selectProgressEvidence, type ProgressEvidence } from "./leadProgress";
import { attentionSortKeys, sortAttentionRows } from "./attention";
import { changeTriggersAttachment, outreachChangeNomination, outreachRepairNomination } from "./worker";

const now = new Date("2026-09-22T12:00:00Z"), id = () => new mongoose.Types.ObjectId();
const change = (fields: ProgressEvidence["fields"], over: Partial<ProgressEvidence> = {}): ProgressEvidence =>
  ({ change_id: id(), applied_at: new Date("2026-09-22T11:00:00Z"), source_system: "granot", fields, ...over });
/** One accepted change offered for both fields; `projectLeadProgress` keeps only what vouches per field. */
const evidence = (fields: ProgressEvidence["fields"], over: Partial<ProgressEvidence> = {}) => { const one = change(fields, over); return { priority: one, quoted: one }; };

test("§3.3 Owner-confirmed meanings; unmapped and unknown codes carry no invented meaning", () => {
  assert.equal(dispositionFor("0"), "fresh"); assert.equal(dispositionFor("1"), "quoted"); assert.equal(dispositionFor("3"), "rep_discretion");
  assert.equal(dispositionFor("7"), "crm_bad_unusable"); assert.equal(dispositionFor("8"), "crm_dead");
  assert.equal(dispositionFor("5"), "unmapped"); assert.equal(dispositionFor("9"), "unmapped"); assert.equal(dispositionFor(null), "unknown"); assert.equal(dispositionFor("abc"), "unknown");
  assert.equal(priorityLabel(null), "Not set"); assert.equal(priorityLabel("5"), "Unknown meaning"); assert.equal(priorityLabel("8"), "CRM dead opportunity");
  assert.equal(closureBasisFor("crm_bad_unusable"), "granot_bad_unusable"); assert.equal(closureBasisFor("crm_dead"), "granot_dead_opportunity"); assert.equal(closureBasisFor("quoted"), null);
});
test("accepted 1/3 assignment establishes work with a known time; 0, unmapped and quoted=false do not", () => {
  const assigned = projectLeadProgress({ lead: { granot_priority: "1", quoted: false }, prior: null, evidence: evidence([{ path: "granot_priority", after: "1" }]), now });
  assert.equal(assigned.work_observed, true); assert.equal(assigned.basis, "priority_assigned"); assert.equal(assigned.provenance, "accepted");
  assert.equal(assigned.last_progress_at?.toISOString(), "2026-09-22T11:00:00.000Z"); assert.equal(assigned.first_work_observed_at?.toISOString(), "2026-09-22T11:00:00.000Z");
  const changed = projectLeadProgress({ lead: { granot_priority: "3", quoted: false }, prior: null, evidence: evidence([{ path: "granot_priority", before: "0", after: "3" }]), now });
  assert.equal(changed.basis, "priority_changed"); assert.equal(changed.disposition, "rep_discretion");
  for (const code of ["0", "5", "9", null]) {
    const row = projectLeadProgress({ lead: { granot_priority: code, quoted: false }, prior: null, evidence: evidence([{ path: "granot_priority", after: code }]), now });
    assert.equal(row.work_observed, false, `code ${code}`); assert.equal(row.basis, null);
  }
  assert.equal(projectLeadProgress({ lead: { granot_priority: "1", quoted: false }, prior: null, evidence: null, now }).work_observed, false, "uncertain provenance establishes nothing");
});
test("stored quoted=true is work evidence even with unknown time; identical redelivery keeps the fingerprint and time", () => {
  const first = projectLeadProgress({ lead: { granot_priority: null, quoted: true }, prior: null, evidence: null, now });
  assert.equal(first.work_observed, true); assert.equal(first.basis, "historical_snapshot"); assert.equal(first.provenance, "uncertain");
  assert.equal(first.last_progress_at, null); assert.equal(first.first_work_observed_at, null);
  const again = projectLeadProgress({ lead: { granot_priority: null, quoted: true }, prior: first, evidence: null, now: new Date(+now + 60_000) });
  assert.equal(again.fingerprint, first.fingerprint); assert.equal(again.last_progress_at, null);
  const known = projectLeadProgress({ lead: { granot_priority: "1", quoted: true }, prior: null, evidence: evidence([{ path: "quoted", before: false, after: true }, { path: "granot_priority", after: "1" }]), now });
  assert.equal(known.basis, "quoted"); assert.equal(known.provenance, "accepted");
  assert.equal(progressExplanation(known), "Quoted · No next step set");
  const granot = projectLeadProgress({ lead: { granot_priority: "3", quoted: false }, prior: null, evidence: evidence([{ path: "granot_priority", after: "3" }]), now });
  assert.equal(progressExplanation(granot), "Lead updated in Granot · No next step set");
  assert.equal(progressExplanation({ ...granot, source_origin: "vantage" }), "Lead updated · No next step set");
});
test("1 → 8 keeps stored Quoted and earlier work history, closes by disposition; 7 ↔ 8 changes only the basis", () => {
  const quoted = projectLeadProgress({ lead: { granot_priority: "1", quoted: true }, prior: null, evidence: evidence([{ path: "granot_priority", after: "1" }, { path: "quoted", after: true }]), now });
  const dead = projectLeadProgress({ lead: { granot_priority: "8", quoted: true }, prior: quoted, evidence: evidence([{ path: "granot_priority", before: "1", after: "8" }]), now });
  assert.equal(dead.disposition, "crm_dead"); assert.equal(dead.quoted, true); assert.equal(dead.work_observed, true, "earlier work is history, not erased");
  assert.equal(dead.first_work_observed_at?.toISOString(), quoted.first_work_observed_at?.toISOString());
  assert.notEqual(dead.disposition_revision, quoted.disposition_revision);
  const bad = projectLeadProgress({ lead: { granot_priority: "7", quoted: true }, prior: dead, evidence: evidence([{ path: "granot_priority", before: "8", after: "7" }]), now });
  assert.equal(closureBasisFor(bad.disposition), "granot_bad_unusable");
});
test("explicit correction that removes the only work evidence turns work off; a routine reset to 0 does not", () => {
  const quoted = projectLeadProgress({ lead: { granot_priority: null, quoted: true }, prior: null, evidence: evidence([{ path: "quoted", after: true }]), now });
  const corrected = projectLeadProgress({ lead: { granot_priority: null, quoted: false }, prior: quoted, evidence: evidence([{ path: "quoted", before: true, after: false }], { source_system: "vantage" }), now });
  assert.equal(corrected.work_observed, false); assert.equal(corrected.first_work_observed_at?.toISOString(), quoted.first_work_observed_at?.toISOString(), "audit keeps when work was first observed");
  const worked = projectLeadProgress({ lead: { granot_priority: "1", quoted: false }, prior: null, evidence: evidence([{ path: "granot_priority", after: "1" }]), now });
  const reset = projectLeadProgress({ lead: { granot_priority: "0", quoted: false }, prior: worked, evidence: evidence([{ path: "granot_priority", before: "1", after: "0" }]), now });
  assert.equal(reset.disposition, "fresh"); assert.equal(reset.work_observed, true, "resetting to 0 never erases legitimate earlier work");
});
test("override binds to the disposition revision: identical redelivery keeps it, a semantic change expires it", () => {
  const override = { reason: "Owner keeps working it", instruction_id: id(), disposition_revision: "", decided_at: now, decided_by: "owner" };
  const closed = projectLeadProgress({ lead: { granot_priority: "8", quoted: false }, prior: null, evidence: evidence([{ path: "granot_priority", after: "8" }]), now });
  const withOverride = { ...closed, override: { ...override, disposition_revision: closed.disposition_revision } };
  assert.ok(projectLeadProgress({ lead: { granot_priority: "8", quoted: false }, prior: withOverride, evidence: evidence([{ path: "granot_priority", after: "8" }]), now }).override);
  assert.equal(projectLeadProgress({ lead: { granot_priority: "7", quoted: false }, prior: withOverride, evidence: evidence([{ path: "granot_priority", before: "8", after: "7" }]), now }).override, null);
});
test("evidence must vouch per field; a stale or partial change never regresses or lends provenance", () => {
  assert.equal(evidenceMatchesCurrent(change([{ path: "granot_priority", after: "1" }]), { granot_priority: "8" }), false);
  assert.equal(evidenceMatchesCurrent(change([{ path: "quoted", after: true }]), { granot_priority: "8", quoted: true }), true);
  // F-03: a creation change carrying quoted:false does not vouch for a change-less Priority 8.
  const creation = change([{ path: "quoted", after: false }], { source_system: "vantage" });
  const lead8 = { granot_priority: "8", quoted: false };
  const set = selectProgressEvidence([creation], lead8);
  assert.equal(set.priority, null); assert.equal(set.quoted, creation);
  const row = projectLeadProgress({ lead: lead8, prior: null, evidence: set, now });
  assert.equal(row.provenance, "uncertain"); assert.equal(row.disposition, "crm_dead");
  assert.equal(projectLeadProgress({ lead: { granot_priority: "1", quoted: false }, prior: null, evidence: selectProgressEvidence([creation], { granot_priority: "1", quoted: false }), now }).work_observed, false);
  // F-02: out-of-order delivery — the latest change that agrees with the current value wins, whichever job arrived last.
  const to1 = change([{ path: "granot_priority", before: null, after: "1" }], { applied_at: new Date("2026-09-22T10:00:00Z") });
  const to8 = change([{ path: "granot_priority", before: "1", after: "8" }], { applied_at: new Date("2026-09-22T11:00:00Z") });
  const current8 = { granot_priority: "8", quoted: false };
  assert.equal(selectProgressEvidence([to8, to1], current8).priority, to8);
  assert.equal(selectProgressEvidence([to1], current8).priority, null, "a stale change never vouches");
  // F-06: legacy quoted=true plus a later Priority-only reset to 0 keeps the unknown work time.
  const reset0 = change([{ path: "granot_priority", before: "1", after: "0" }]);
  const legacy = projectLeadProgress({ lead: { granot_priority: "0", quoted: true }, prior: null, evidence: selectProgressEvidence([reset0], { granot_priority: "0", quoted: true }), now });
  assert.equal(legacy.basis, "historical_snapshot"); assert.equal(legacy.first_work_observed_at, null); assert.equal(legacy.provenance, "accepted");
  // F-05: evidence is recorded whatever the record state; the caller gates the transition.
  const recorded = projectLeadProgress({ lead: { granot_priority: "1", quoted: true }, prior: null, evidence: evidence([{ path: "granot_priority", after: "1" }, { path: "quoted", after: true }]), now });
  assert.equal(recorded.work_observed, true);
});
test("H2/H3 nominations: change id rides in input_refs; contact and eligibility paths trigger attachment; fingerprint follows the flag", () => {
  const change = { _id: id(), entity: { model: "FormLead", id: String(id()) }, revision_after: 3, revision_before: 2, changed_paths: ["granot_priority"] };
  const nomination = outreachChangeNomination(change);
  assert.deepEqual(nomination.input_refs, [change.entity.id, String(change._id)]);
  assert.equal(nomination.dedupe_key, `csi:outreach:entity-change:v2:${change._id}`);
  assert.equal(changeTriggersAttachment(change), false);
  assert.equal(changeTriggersAttachment({ ...change, revision_before: 0 }), true, "a create evaluates the match set");
  assert.equal(changeTriggersAttachment({ ...change, changed_paths: ["granot_contact_snapshot.normalized_phone_number"] }), true);
  assert.equal(changeTriggersAttachment({ ...change, changed_paths: ["duplicate"] }), true);
  assert.equal(changeTriggersAttachment({ ...change, changed_paths: ["cpl", "notes"] }), false);
  const lead = { _id: id(), booked: null, cancelled: null, duplicate: false, bad_lead: null, no_sync: false, granot_priority: "1", quoted: true };
  const before = process.env.SALES_INTELLIGENCE_LEAD_PROGRESS;
  try {
    delete process.env.SALES_INTELLIGENCE_LEAD_PROGRESS;
    const off = outreachRepairNomination("FormLead", lead)!, offChanged = outreachRepairNomination("FormLead", { ...lead, granot_priority: "8" })!;
    assert.equal(off.dedupe_key, offChanged.dedupe_key, "flag off keeps the old fingerprint: no mass re-nomination");
    process.env.SALES_INTELLIGENCE_LEAD_PROGRESS = "true";
    const on = outreachRepairNomination("FormLead", lead)!, onChanged = outreachRepairNomination("FormLead", { ...lead, granot_priority: "8" })!;
    assert.notEqual(on.dedupe_key, onChanged.dedupe_key, "flag on: a Priority change re-nominates within one lap");
    assert.equal(outreachRepairNomination("FormLead", { ...lead, name: "edited" } as never)!.dedupe_key, on.dedupe_key);
  } finally { if (before === undefined) delete process.env.SALES_INTELLIGENCE_LEAD_PROGRESS; else process.env.SALES_INTELLIGENCE_LEAD_PROGRESS = before; }
});
test("§14.1 sort keys and global order: nulls last both ways, ties on subject_key, Attention order untouched", () => {
  const row = (subject_key: string, keys: Partial<ReturnType<typeof attentionSortKeys>>) => ({ subject_key, sort_keys: { next_action_due: null, lead_received: null, last_human_contact: null, last_lead_progress: null, ...keys } });
  const rows = [row("c", { last_lead_progress: "2026-09-20T00:00:00.000Z" }), row("a", { last_lead_progress: null }), row("b", { last_lead_progress: "2026-09-21T00:00:00.000Z" }), row("d", { last_lead_progress: "2026-09-21T00:00:00.000Z" })];
  assert.deepEqual(sortAttentionRows(rows, "last_lead_progress", "desc").map(r => r.subject_key), ["b", "d", "c", "a"]);
  assert.deepEqual(sortAttentionRows(rows, "last_lead_progress", "asc").map(r => r.subject_key), ["c", "b", "d", "a"]);
  assert.deepEqual(sortAttentionRows(rows, "attention", "asc").map(r => r.subject_key), ["c", "a", "b", "d"]);
  const keys = attentionSortKeys({ derived: { attention_band: 2 } as never, outreach: { state: "unworked", subject: { kind: "lead", model: "FormLead", id: "x" }, first_action_due_at: "2026-09-22T12:30:00.000Z", trigger_at: "2026-09-22T12:00:00.000Z",
    last_meaningful_contact_at: null, lead_progress: { last_progress_at: "2026-09-22T11:00:00.000Z" },
    followups: [{ status: "open", attention_due_at: "2026-09-23T00:00:00.000Z" }, { status: "cancelled", attention_due_at: "2026-09-01T00:00:00.000Z" }] } as never });
  assert.equal(keys.next_action_due, "2026-09-22T12:30:00.000Z", "unworked Form Lead uses the earlier first-action deadline; cancelled actions are ignored");
  assert.equal(keys.lead_received, "2026-09-22T12:00:00.000Z"); assert.equal(keys.last_human_contact, null); assert.equal(keys.last_lead_progress, "2026-09-22T11:00:00.000Z");
});
