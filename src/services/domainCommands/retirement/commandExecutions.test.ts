import assert from "node:assert/strict";
import test from "node:test";
import { commandExecutionVerdict, type CommandFacts } from "./commandExecutions";

const lead = "a".repeat(24), link = "b".repeat(24), receipt = "c".repeat(24), observation = "d".repeat(24), self = "e".repeat(24);
const at = new Date("2026-11-01T00:00:00.000Z");
const granot = { _id: self, origin: "granot_lifecycle", idempotency_key: `granot:synchronize-lead:${observation}`, applied_at: at,
  actor: { actor_id: "granot-lifecycle-processor" }, provenance: { source_receipt_id: receipt, observation_id: observation },
  entity_refs: [{ model: "CallLead", id: lead }, { model: "GranotRecordLink", id: link }] };
const sheet = { _id: self, origin: "external_sheet_ingestion", idempotency_key: "create_form_lead:forms:lead:x", applied_at: at,
  actor: { actor_id: "best-relocation-ingestion" }, provenance: {}, entity_refs: [{ model: "FormLead", id: lead }] };
const facts = (over: Partial<CommandFacts> = {}): CommandFacts => ({ until: new Date(+at + 1000), hot: new Set(),
  live: new Set([`CallLead:${lead}`, `FormLead:${lead}`, `GranotRecordLink:${link}`]), ...over });

test("a command receipt retires only when no producer can replay its key and its records exist (phase 2)", () => {
  for (const [name, row, given, expected] of [
    ["external sheet ingestion is billing evidence", sheet, facts(), "billing_evidence_best_relocation"],
    ["phase 2: processor key, receipt and Observation retired", granot, facts(), "retire"],
    ["phase 2: create-lead key", { ...granot, idempotency_key: `granot:create-lead:${observation}` }, facts(), "retire"],
    ["Owner key on a Granot command", { ...granot, idempotency_key: "4eddbefb-eeb4-4869-a39c-a0d3d07979e3" }, facts(), "key_not_receipt_bound"],
    ["scheduled-estimate key", { ...granot, idempotency_key: `scheduled-estimate:${receipt}` }, facts(), "key_not_receipt_bound"],
    ["key names another Observation", { ...granot, idempotency_key: `granot:synchronize-lead:${"f".repeat(24)}` }, facts(), "key_not_receipt_bound"],
    ["not the processor actor", { ...granot, actor: { actor_id: "owner" } }, facts(), "key_not_receipt_bound"],
    ["source receipt still hot", granot, facts({ hot: new Set([receipt]) }), "source_receipt_hot"],
    ["Observation still hot", granot, facts({ hot: new Set([observation]) }), "source_observation_hot"],
    ["RingCentral and Admin keys wait for phases 3–4", { ...sheet, origin: "ringcentral" }, facts(), "origin_out_of_scope"],
    ["a referenced Lead is gone", granot, facts({ live: new Set([`GranotRecordLink:${link}`]) }), "entity_ref_missing"],
    ["an unsupported reference", { ...granot, entity_refs: [{ model: "BookedLead", id: lead }] }, facts(), "entity_ref_unsupported"],
    ["only its own execution referenced", { ...granot, entity_refs: [{ model: "CommandExecution", id: self }] }, facts(), "no_entity_refs"],
    ["still settling", granot, facts({ until: at }), "settling"],
  ] as const) {
    const verdict = commandExecutionVerdict(row, given);
    assert.equal(verdict.verdict === "retire" ? "retire" : verdict.reason, expected, name);
  }
});
