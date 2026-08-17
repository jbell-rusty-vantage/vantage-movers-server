import assert from "node:assert/strict";
import { test } from "node:test";
import {
  trustedGranotCallLeadCreateSchema,
  trustedGranotFormLeadCreateSchema,
} from "./trustedLeadCreateValidation";

test("[AC-07] trusted Granot Form validator may omit move_size and forces post_to_granot=false", () => {
  const parsed = trustedGranotFormLeadCreateSchema.parse({
    job_no: "P5556278",
    name: "Synthetic User",
    phone_number: "5550100100",
    pickup_zip: "10001",
    destination_zip: "94105",
    pickup_state: "NY",
    delivery_state: "CA",
    post_to_granot: false,
  });
  assert.equal(parsed.post_to_granot, false);
  assert.equal(parsed.ingestion_origin, "granot_lead_created");
  assert.equal(parsed.move_size, undefined);
});

test("[AC-07] trusted Granot Form validator rejects caller override of post_to_granot", () => {
  const parsed = trustedGranotFormLeadCreateSchema.safeParse({
    job_no: "P5556278",
    name: "Synthetic User",
    phone_number: "5550100100",
    pickup_zip: "10001",
    destination_zip: "94105",
    post_to_granot: true,
  });
  assert.equal(parsed.success, false);
});

test("[AC-07] trusted Granot Call validator allows Job Number without phone and forces post_to_granot=false", () => {
  const parsed = trustedGranotCallLeadCreateSchema.parse({
    job_no: "P5556278",
  });
  assert.equal(parsed.post_to_granot, false);
  assert.equal(parsed.ingestion_origin, "granot_lead_created");
  assert.equal(parsed.phone_number, undefined);
});

test("[AC-07] trusted Granot validators reject public lifecycle metadata keys", () => {
  assert.equal(
    trustedGranotFormLeadCreateSchema.safeParse({
      job_no: "P5556278",
      name: "Synthetic User",
      phone_number: "5550100100",
      pickup_zip: "10001",
      destination_zip: "94105",
      ingestion_origin: "wordpress_form",
    }).success,
    false,
  );
  assert.equal(
    trustedGranotCallLeadCreateSchema.safeParse({
      job_no: "P5556278",
      ringcentral_convergence: { state: "pending" },
    }).success,
    false,
  );
});
