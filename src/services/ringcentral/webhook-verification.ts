import { timingSafeEqual } from "node:crypto";
import { findStoredSubscriptionVerificationToken, recordStoredSubscriptionDeliveryRefusal } from "./webhook-subscriptions";

/**
 * Delivery verification (RINGCENTRAL-CAPTURE §3, §9.2). A subscription created or updated by this
 * application carries a generated `deliveryMode.verificationToken`; RingCentral then sends it on every
 * delivery as the `Verification-Token` header (matched case-insensitively). A delivery that names one
 * of our token-bearing subscriptions must carry exactly that token, otherwise it is refused before
 * anything is stored or fanned out.
 *
 * Transitional and foreign cases stay accepted exactly as before: a validation handshake (no
 * subscription id yet), a subscription we hold no token for (the `calls` subscription until the
 * operator adds one), or a subscription that is not ours.
 */
export type DeliveryVerification =
  | { ok: true; reason: "verified" | "no_subscription_id" | "not_owned" | "no_token_on_record" }
  | { ok: false; reason: "token_missing" | "token_mismatch" };

/** `undefined` = not our subscription; `null` = ours without a token; string = the expected token. */
export type ExpectedTokenLookup = (subscriptionId: string) => Promise<string | null | undefined>;

export function compareVerificationToken(expected: string, provided: string | null | undefined): DeliveryVerification {
  const value = provided?.trim() ?? "";
  if (!value) return { ok: false, reason: "token_missing" };
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return { ok: false, reason: "token_mismatch" };
  return { ok: true, reason: "verified" };
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 64;
const cache = new Map<string, { at: number; value: string | null | undefined }>();

/** Stored token per subscription, cached for a minute (a delivery burst costs one read). */
export const cachedExpectedTokenLookup: ExpectedTokenLookup = async (subscriptionId) => {
  const now = Date.now();
  const hit = cache.get(subscriptionId);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await findStoredSubscriptionVerificationToken(subscriptionId);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(subscriptionId, { at: now, value });
  return value;
};

let lookupOverride: ExpectedTokenLookup | null = null;

/** Test seams: clear the cache; inject a lookup (`null` restores the stored-subscription lookup). */
export function clearVerificationTokenCache(): void {
  cache.clear();
}
export function setVerificationTokenLookupForTests(lookup: ExpectedTokenLookup | null): void {
  lookupOverride = lookup;
}

export async function verifyRingCentralDelivery(
  input: { subscriptionId: string | null; providedToken: string | null | undefined },
  lookup: ExpectedTokenLookup = lookupOverride ?? cachedExpectedTokenLookup,
): Promise<DeliveryVerification> {
  if (!input.subscriptionId) return { ok: true, reason: "no_subscription_id" };
  const expected = await lookup(input.subscriptionId);
  if (expected === undefined) return { ok: true, reason: "not_owned" };
  if (expected === null) return { ok: true, reason: "no_token_on_record" };
  return compareVerificationToken(expected, input.providedToken);
}

// ---------------------------------------------------------------------------
// Refusal counter (olr CW2)
// ---------------------------------------------------------------------------

/** Counts one refused delivery against the named subscription. */
export type DeliveryRefusalRecorder = (input: { subscriptionId: string; reason: "token_missing" | "token_mismatch"; at: Date }) => Promise<unknown>;

const storedRefusalRecorder: DeliveryRefusalRecorder = ({ subscriptionId, reason, at }) =>
  recordStoredSubscriptionDeliveryRefusal(subscriptionId, reason, at);

let refusalRecorderOverride: DeliveryRefusalRecorder | null = null;

/** Test seam: inject a recorder (`null` restores the stored-subscription counter). */
export function setDeliveryRefusalRecorderForTests(recorder: DeliveryRefusalRecorder | null): void {
  refusalRecorderOverride = recorder;
}

/**
 * olr CW2 (incident 2026-10-06): the route counts every delivery it refuses on the subscription's
 * metadata row, so the subscription health check can report a subscription the provider calls Active
 * while every delivery is refused (`deliveries_refused`). Best effort: a store failure never changes
 * the 403 the route answers.
 */
export async function recordDeliveryRefusal(input: { subscriptionId: string | null; reason: "token_missing" | "token_mismatch"; at: Date }): Promise<void> {
  if (!input.subscriptionId) return;
  await (refusalRecorderOverride ?? storedRefusalRecorder)({ subscriptionId: input.subscriptionId, reason: input.reason, at: input.at });
}
