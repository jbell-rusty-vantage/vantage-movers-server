# Ask The Company Google Identity What US State A Five-Digit ZIP Belongs To, And If Google Cannot Answer Stay Silent So The Leftover Zip Book Can Try Zippopotam.us; Separately Prove That Same Identity Can Still Turn A Test ZIP Into A State Without Throwing — Never Call Zippopotam.us From This File, Never Decide Move Type, Never Write not_found, Never Invent The Owner Drive Token

- Status: reviewed starter, 2026-10-29
- Target: `src/services/googleMaps/geocoding.ts`
- Current declared exports: `GoogleMapsGeocodingHealth`, `GoogleGeocodeResponse`, `getGoogleStateCodeForZip`, `checkGoogleMapsGeocodingHealth`, `extractStateCodeFromGoogleGeocodeResponse`.
- Evidence: `src/services/googleMaps/geocoding.ts`, `.cursor/story-refactor-workspace/DIRECTIVE.md`

## Recommendation

Keep `checkGoogleMapsGeocodingHealth` as the public seam; consider a shorter story name only if it improves the live callers, and retain an exact compatibility alias. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

The historical database, Operational Events and Lead Conversations were retired. Keep only effects and dependencies present in the live module; do not restore retired side effects.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: extractStateCodeFromGoogleGeocodeResponse uses postal address state code; extractStateCodeFromGoogleGeocodeResponse converts state component name. See `src/services/googleMaps/geocoding.test.ts`.

## Source-verified implementation constraints (2026-10-29)

Keep operational ZIP lookup, detailed health and pure response extraction separate. Invalid ZIP returns undefined without Google; operational HTTP/auth/parse errors log and return undefined, while health reports staged auth/token/geocoding detail and defaults invalid probe ZIP to 10001. Preserve service-account project requirement and X-Goog-User-Project, cached auth invalidation on failure and postal-address state precedence over component fallback. Prove valid/invalid ZIP, no-state reply and staged health failure rather than changing this into a throwing location validator.
