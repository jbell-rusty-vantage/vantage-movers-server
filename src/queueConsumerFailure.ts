import { logger } from "./logger";

/**
 * Queue consumers receive wake-ups only: MongoDB holds every job, and each topic has a cron
 * safety net that drains the same work (Sheet Sync, Lead Messaging, Granot automation,
 * Granot lifecycle, Sales Intelligence job recovery). Rethrowing makes Vercel redeliver the
 * wake-up every 30 seconds until the message expires.
 *
 * That retry is right for a transient outage and wrong when MongoDB rejects this deployment's
 * credentials. A deployment's environment is frozen at build time, and Vercel keeps delivering
 * a message to the deployment that published it. After a credential change, a superseded
 * deployment can never succeed: on November 20, 2026 the November 19 deployment retried
 * Sales Intelligence and Granot lifecycle wake-ups about 176 times an hour for six hours.
 * Acknowledging the wake-up loses nothing, because the cron on the current deployment claims
 * the same Mongo work.
 *
 * The check cannot tell a superseded deployment from the current one. If the current
 * deployment briefly sees a rejection (for example while Atlas propagates a rotated password),
 * its work waits for the next cron (at most 5 minutes) instead of a 30-second redelivery.
 */
export function acknowledgeWhenCredentialsRejected(consumer: string, error: unknown): boolean {
  if (!isMongoCredentialRejection(error)) return false;
  logger.error({
    msg: "queue.consumer.mongo_credentials_rejected",
    consumer,
    vercel_deployment_id: process.env.VERCEL_DEPLOYMENT_ID?.trim() || null,
  }, "MongoDB rejected this deployment's credentials; the wake-up is acknowledged and the cron drains the work");
  return true;
}

/** MongoDB error code 18 (`AuthenticationFailed`), found anywhere on the error's `cause` chain. */
export function isMongoCredentialRejection(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; codeName?: unknown; cause?: unknown };
    if (candidate.code === 18 || candidate.codeName === "AuthenticationFailed") return true;
    current = candidate.cause;
  }
  return false;
}
