import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { expectedCallSubject, type ResyncSubject } from "./numbers-v2-desk-resync";

describe("desk-resync step 2: the expected credited subject (olr C2cd review fix)", () => {
  const at = (iso: string) => new Date(iso);
  const call = at("2026-10-08T15:00:00Z");
  const subjects = new Map<string, ResyncSubject>([
    ["FormLead:x", { id: "sx", activation_at: at("2026-10-10T15:00:00Z") }], // number Lead, enrolled after the call
    ["FormLead:y", { id: "sy", activation_at: at("2026-10-01T15:00:00Z") }], // shadow, active at the call
    ["CallLead:z", { id: "sz", activation_at: at("2026-10-02T15:00:00Z") }], // second shadow, active
    ["FormLead:active", { id: "sa", activation_at: at("2026-10-01T15:00:00Z") }],
  ]);
  const base = { started_at: call, subject_by_lead: subjects };

  test("number_lead (rule absent or explicit): only the number Lead's subject active at the call", () => {
    for (const rule of [undefined, "number_lead"] as const) {
      assert.equal(expectedCallSubject({ ...base, rule, number_lead: "FormLead:active", other_leads: ["FormLead:y"] }), "sa");
      assert.equal(expectedCallSubject({ ...base, rule, number_lead: "FormLead:x", other_leads: ["FormLead:y"] }), null, "shadow credit would be drift");
      assert.equal(expectedCallSubject({ ...base, rule, number_lead: null, other_leads: ["FormLead:y"] }), null);
    }
  });

  test("single_active_subject_on_link: a shadow-credited call is expected, not drift", () => {
    const rule = "single_active_subject_on_link" as const;
    assert.equal(expectedCallSubject({ ...base, rule, number_lead: "FormLead:x", other_leads: ["FormLead:y"] }), "sy", "number Lead enrolled after the call");
    assert.equal(expectedCallSubject({ ...base, rule, number_lead: "FormLead:none", other_leads: ["FormLead:y", "FormLead:none"] }), "sy", "number Lead not enrolled");
    assert.equal(expectedCallSubject({ ...base, rule, number_lead: "FormLead:active", other_leads: ["FormLead:y"] }), "sa", "an active number Lead wins");
    assert.equal(expectedCallSubject({ ...base, rule, number_lead: "FormLead:x", other_leads: ["FormLead:y", "CallLead:z"] }), null, "two shadows: ambiguous");
    assert.equal(expectedCallSubject({ ...base, rule, number_lead: "FormLead:x", other_leads: [] }), null);
  });
});
