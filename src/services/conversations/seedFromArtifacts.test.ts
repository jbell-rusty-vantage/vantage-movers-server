import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSeededTranscript,
  extractSummarySection,
  hasCrmMismatch,
  parseConversationArtifact,
} from "./seedFromArtifacts";

const ARTIFACT = `
# P5562014

## Summary

**Conversation overview:**
Patrick priced a small move.

**What the customer wanted:**
Texas by the 28th.

**Quote / money / dates discussed:**
$2,114 total.

**Outcome and next steps:**
Email the portal.

**Anything the agent promised or still needs:**
Send the pay link.

**Mismatch vs CRM:**
There is no contradiction between the transcript and the CRM record.

## Transcript

Best email is pat@example.com. Card 4111-1111-1111-1111.
`.trim();

test("parseConversationArtifact splits summary and transcript", () => {
  const parsed = parseConversationArtifact(ARTIFACT);
  assert.equal(
    extractSummarySection(parsed.summary_markdown, "Conversation overview")
      ?.includes("Patrick priced"),
    true,
  );
  assert.equal(hasCrmMismatch(parsed.summary_markdown), false);
  assert.equal(parsed.transcript.includes("Best email"), true);
});

test("buildSeededTranscript redacts before the text is stored", () => {
  const parsed = parseConversationArtifact(ARTIFACT);
  const transcript = buildSeededTranscript(parsed.transcript, new Date("2026-08-19T00:00:00.000Z"));
  assert.equal(transcript.text.includes("4111"), false);
  assert.equal(transcript.text.includes("pat@example.com"), false);
  assert.equal(transcript.text.includes("[REDACTED:CARD]"), true);
  assert.equal(transcript.redactions >= 2, true);
});

test("hasCrmMismatch is true only when the section contradicts CRM", () => {
  assert.equal(
    hasCrmMismatch("Mismatch vs CRM:\nDeposit on the call was $500, CRM has $814."),
    true,
  );
});
