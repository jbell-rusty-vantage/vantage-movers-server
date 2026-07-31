import assert from "node:assert/strict";
import test from "node:test";
import { classifyHistoricalLeads, type CanonicalLead } from "./classification";

function lead(overrides: Partial<CanonicalLead> & Pick<CanonicalLead, "id" | "kind" | "timestamp">): CanonicalLead {
  return { source_company_id: "company-a", source_granularity_id: "granularity-a", normalized_phone: "5551112222", normalized_email: null, ...overrides };
}

test("Form duplicate classification isolates cutoff cohorts and exact granularities", () => {
  const result = classifyHistoricalLeads([
    lead({ id: "pre-1", kind: "form", timestamp: "2026-04-29T12:00:00.000Z" }),
    lead({ id: "pre-2", kind: "form", timestamp: "2026-04-29T13:00:00.000Z" }),
    lead({ id: "modern-1", kind: "form", timestamp: "2026-04-30T04:00:00.000Z" }),
    lead({ id: "modern-other-granularity", kind: "form", timestamp: "2026-04-30T05:00:00.000Z", source_granularity_id: "granularity-b" }),
  ]);
  assert.equal(result.find((entry) => entry.id === "pre-1")?.duplicate, false);
  assert.equal(result.find((entry) => entry.id === "pre-2")?.duplicate, true);
  assert.equal(result.find((entry) => entry.id === "modern-1")?.duplicate, false);
  assert.equal(result.find((entry) => entry.id === "modern-other-granularity")?.duplicate, false);
});

test("matched modern production duplicate outcome is preserved", () => {
  const [result] = classifyHistoricalLeads([lead({ id: "modern", kind: "form", timestamp: "2026-05-01T12:00:00.000Z", duplicate: true, preserve_duplicate: true })]);
  assert.equal(result?.duplicate, true);
});

test("Call duplicates use earlier non-duplicate anchors in inclusive 90-day exact-granularity window", () => {
  const result = classifyHistoricalLeads([
    lead({ id: "call-1", kind: "call", timestamp: "2026-01-01T12:00:00.000Z" }),
    lead({ id: "call-2", kind: "call", timestamp: "2026-04-01T12:00:00.000Z" }),
    lead({ id: "call-3", kind: "call", timestamp: "2026-06-30T12:00:00.000Z" }),
  ]);
  assert.equal(result.find((entry) => entry.id === "call-2")?.duplicate, true);
  assert.equal(result.find((entry) => entry.id === "call-3")?.duplicate, false, "a duplicate does not become an anchor");
});

test("Form Fill is time-unbounded and Source Company scoped after Form classification", () => {
  const result = classifyHistoricalLeads([
    lead({ id: "call", kind: "call", timestamp: "2024-01-01T12:00:00.000Z", source_granularity_id: "call-granularity" }),
    lead({ id: "form", kind: "form", timestamp: "2026-06-01T12:00:00.000Z", source_granularity_id: "form-granularity" }),
  ]);
  assert.equal(result.find((entry) => entry.id === "call")?.form_fill, true);
});

test("classification fails closed without exact granularity", () => {
  assert.throws(() => classifyHistoricalLeads([lead({ id: "missing", kind: "form", timestamp: "2026-01-01T00:00:00.000Z", source_granularity_id: "" })]), /exact Source Granularity/);
});
