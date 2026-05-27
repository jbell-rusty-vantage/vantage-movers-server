/**
 * Shared service-layer error used by the v1 service facade and every
 * domain service folder it re-exports from.
 *
 * Lives in its own file so individual service folders (e.g. `leads/`,
 * future `bookings/`, `cancellations/`, etc.) can import it without a
 * circular dependency on `v1.service.ts`, which itself re-exports this
 * class for backward compatibility with route imports.
 */
export class V1ServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "V1ServiceError";
  }
}
