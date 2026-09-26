import assert from "node:assert/strict";
import { test } from "node:test";
import { attentionStorageIndexProductionRefusal, ATTENTION_STORAGE_PRODUCTION_FLAG } from "./attention-storage-guard";

test("Attention artifact DDL requires explicit production acknowledgement", () => {
  assert.match(attentionStorageIndexProductionRefusal("vantagemovers", [])!, /without --allow-production/);
  assert.equal(attentionStorageIndexProductionRefusal("vantagemovers", [ATTENTION_STORAGE_PRODUCTION_FLAG]), null);
  assert.equal(attentionStorageIndexProductionRefusal("testvantagemovers_attention", []), null);
});
