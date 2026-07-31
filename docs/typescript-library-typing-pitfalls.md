# TypeScript library typing pitfalls (Mongoose ObjectId, AWS S3, googleapis)

This document explains a recurring class of CI/Vercel TypeScript failures that look like real type errors but are usually **wrong library/interface usage** (or unstable transitive type resolution), not broken business logic.

Do not “fix” these by weakening types (`any`, `@ts-ignore`, random double-casts) unless a nearby comment explains a known SDK typing gap and a safer project-local pattern is impossible.

Related Cursor rule: `.cursor/rules/library-typing.mdc`.

## Symptom clusters from recent builds

| Cluster | Typical codes | What it looks like |
| --- | --- | --- |
| A. Mongoose `ObjectId` | `TS2554`, `TS2339` | `Expected 0 arguments, but got 1` on `new mongoose.Types.ObjectId(...)`; `createFromHexString` / `isValid` missing on `typeof ObjectId` |
| B. AWS S3 sender wrapper | `TS2339`, `TS2352` | `Body` missing on `PutObjectCommandOutput`; `S3Client` cannot cast to a hand-written `send` interface |
| C. googleapis client factory | `TS2769`, `TS2339` | `auth` does not exist on `Options`; `.data` missing because the call was typed as `void` |

These have shown up across services such as:

- `leadMessaging`, `leadSourceCompanies`, `operationsRegistry/*`, `employeeBookings/*`, `leads/*`, `agents/*`, `adminBrowse`, `testimonials`
- `granotCrmCsv/storage.ts`
- `googleDriveOAuth/spreadsheet.service.ts`

Runtime Mongoose 9 still has `new Types.ObjectId(hex)`, `ObjectId.isValid`, and `createFromHexString`. The failure is almost always **TypeScript’s view of the constructor/statics**, not Node at runtime.

---

## Cluster A — `mongoose.Types.ObjectId`

### What the bad code looks like

```ts
new mongoose.Types.ObjectId(someIdString);
mongoose.Types.ObjectId.isValid(someIdString);
mongoose.Types.ObjectId.createFromHexString(someIdString);
```

### Why TypeScript complains

`mongoose.Types.ObjectId` is declared as a thin subclass of the driver/`bson` `ObjectId`. Under pnpm + TypeScript 6 + Vercel’s typecheck, that base class is sometimes not wired the way editors/`tsc` locally see it. Then TypeScript treats `Types.ObjectId` like a near-empty constructor type:

- construct signature collapses to **0 arguments** → `TS2554 Expected 0 arguments, but got 1`
- statics like `isValid` / `createFromHexString` disappear → `TS2339`

Do **not** confuse this with `Schema.Types.ObjectId` (a schema field type). Schema types are for schema definitions; value construction/validation belongs on the value ObjectId helpers below.

### Canonical fixes

#### 1. Validate with Mongoose’s helper (preferred)

```ts
import mongoose from "mongoose";

if (!mongoose.isValidObjectId(id)) {
  throw new BadRequestError("Invalid id");
}
```

Use this instead of `Types.ObjectId.isValid(...)`. The codebase already does this in places such as `src/routes/v1.routes.ts`.

#### 2. Construct with a project helper, not ad-hoc statics

Prefer one shared helper (recommended location: `src/utils/objectId.ts`) so every service does not re-negotiate SDK typings:

```ts
import mongoose, { Types } from "mongoose";

export function isObjectIdString(value: string): boolean {
  return mongoose.isValidObjectId(value);
}

export function toObjectId(value: string): Types.ObjectId {
  if (!mongoose.isValidObjectId(value)) {
    throw new Error(`Invalid ObjectId: ${value}`);
  }
  // If `new Types.ObjectId(value)` itself fails typecheck in CI,
  // construct via the mongodb package export (see #3) and return as Types.ObjectId.
  return new Types.ObjectId(value);
}
```

Then replace scattered call sites:

```ts
// before
lead_source_company: mongoose.Types.ObjectId.createFromHexString(company.id),
receiver_agent: new mongoose.Types.ObjectId(agent.id),

// after
lead_source_company: toObjectId(company.id),
receiver_agent: toObjectId(agent.id),
```

`createFromHexString` and `new ObjectId(hex)` are equivalent for normal 24-char hex ids. Prefer the helper; do not mix three different construction styles in one PR.

#### 3. If CI still cannot see Mongoose’s constructor/statics: depend on `mongodb` directly

`mongodb` is currently only a **transitive** dependency of `mongoose` (pnpm-nested). That is a common root of flaky ObjectId typing on Vercel.

Durable package-level fix:

1. Add a direct dependency on `mongodb` matching Mongoose’s range (`mongoose@9` depends on `mongodb@~7.2`).
2. Import the value class from `mongodb` (or keep returning `Types.ObjectId` at API boundaries):

```ts
import { ObjectId } from "mongodb";
import type { Types } from "mongoose";

export function toObjectId(value: string): Types.ObjectId {
  return new ObjectId(value) as Types.ObjectId;
}
```

Do **not** import ObjectId from random deep paths under `mongoose/node_modules`.

#### 4. Generate vs parse

| Intent | Do this |
| --- | --- |
| New id | `new Types.ObjectId()` / `toObjectId` only when you already have a hex string |
| Parse trusted hex | `toObjectId(id)` |
| Validate untrusted input | `mongoose.isValidObjectId(id)` before parse |
| Schema field | `Schema.Types.ObjectId` in model schemas only |

### Anti-patterns

- Casting `as any` around every `ObjectId` call.
- Using `Schema.Types.ObjectId` as a value constructor.
- Copying `createFromHexString` into new files while neighboring code uses `new Types.ObjectId`.
- Assuming “it typechecks in the IDE” means Vercel is wrong — treat CI as the source of truth and centralize the helper.

---

## Cluster B — AWS S3 (`@aws-sdk/client-s3`)

### What the bad code looks like

In `src/services/granotCrmCsv/storage.ts`:

```ts
type GranotCrmS3Sender = {
  send(command: PutObjectCommand): Promise<PutObjectCommandOutput>;
  send(command: GetObjectCommand): Promise<GetObjectCommandOutput>;
};

function getGranotCrmS3Sender(): GranotCrmS3Sender {
  return getGranotCrmS3Client() as GranotCrmS3Sender;
}

const response = await getGranotCrmS3Sender().send(new GetObjectCommand(...));
return response.Body?.transformToString() ?? "";
```

### Why TypeScript complains

1. Hand-written `send` overloads do **not** match `S3Client.send`’s generic signature, so the cast is rejected (`TS2352`) or resolves the wrong overload.
2. When the wrong overload wins, a `GetObjectCommand` call is typed as `PutObjectCommandOutput`.
3. `PutObjectCommandOutput` has no `Body`. `Body` exists on **get/read** outputs (`GetObjectCommandOutput`), not put outputs.

### Canonical fixes

Use `S3Client` directly (or a thin wrapper that preserves generics):

```ts
export async function getGranotCrmObjectText(key: string): Promise<string> {
  const response = await getGranotCrmS3Client().send(
    new GetObjectCommand({
      Bucket: getGranotCrmCsvBucket(),
      Key: key,
    }),
  );
  return response.Body?.transformToString() ?? "";
}
```

If a test double is needed, mock `S3Client` / `send` with the same generic shape — do not invent a narrower dual-overload interface and force-cast the real client into it.

### Command/output cheat sheet

| Command | Output type | Has `Body`? |
| --- | --- | --- |
| `PutObjectCommand` | `PutObjectCommandOutput` | No |
| `GetObjectCommand` | `GetObjectCommandOutput` | Yes |

---

## Cluster C — `googleapis` Drive/Sheets factories

### What the bad code looks like

```ts
const auth = await getConnectedGoogleOAuthClient(); // Auth.OAuth2Client
const drive = google.drive({ version: "v3", auth });
const sheets = google.sheets({ version: "v4", auth });
const created = await drive.files.create({ ... });
created.data.id; // error: Property 'data' does not exist on type 'void'
```

### Why TypeScript complains

`google.drive` / `google.sheets` have overloads (`version` string vs `Options` object). When the `auth` value’s type does not line up with the `Options.auth` union TypeScript is currently seeing, overload resolution falls through to a useless `Options` shape (`auth` “does not exist”) and downstream calls collapse toward `void`.

This is an SDK typing/overload problem. The project already has a known local workaround in Sheets service-account auth:

```54:57:src/services/googleSheets/auth.ts
  cachedSheetsClient = google.sheets({
    version: "v4",
    auth,
  } as unknown as sheets_v4.Options);
```

### Canonical fixes

1. **Prefer the existing cast pattern** when constructing authenticated clients, with an explicit comment that googleapis overload resolution is the reason:

```ts
import { google, type drive_v3, type sheets_v4 } from "googleapis";

const drive = google.drive({
  version: "v3",
  auth,
} as unknown as drive_v3.Options);

const sheets = google.sheets({
  version: "v4",
  auth,
} as unknown as sheets_v4.Options);
```

2. Type the stored client as `drive_v3.Drive` / `sheets_v4.Sheets` (or `ReturnType<typeof google.sheets>` only after the factory call typechecks).
3. Do not “fix” missing `.data` by asserting the response; fix the client factory typing first — `.data` disappearing is a cascade.

### Anti-patterns

- Spreading new googleapis call sites that omit the cast while `googleSheets/auth.ts` already documents the gap.
- Importing conflicting `Options` types from unrelated packages (`google-spreadsheet`, etc.).
- Widening `auth` to `any` globally.

---

## Prevention checklist (for new code and reviews)

1. **ObjectIds**
   - Validate with `mongoose.isValidObjectId`.
   - Construct/parse through one shared helper (`toObjectId`), not `createFromHexString` sprinkled everywhere.
   - If CI fails on `Types.ObjectId` construct/statics, add direct `mongodb` dependency and construct from there inside the helper only.
2. **AWS SDK v3**
   - Call `client.send(new XxxCommand(...))` on the real client type.
   - Never invent overload-only `send` facades that require casting `S3Client`.
   - Know which command outputs include `Body`.
3. **googleapis**
   - Construct Drive/Sheets clients with the `as unknown as <api>.Options` pattern already used for Sheets auth when overload matching fails.
   - If `.data` is `void`, fix the client creation types before touching call sites.
4. **Verification**
   - Run `pnpm run typecheck` locally.
   - Treat Vercel/TS build output as authoritative when local and CI disagree; stabilize with direct deps + helpers, not per-file ignores.
5. **Escape hatches**
   - Allowed only at SDK boundaries, with a one-line comment naming the library gap.
   - Forbidden as a substitute for learning the correct command/output or ObjectId helper.

## Remediation status

Implemented:

1. Direct `mongodb@~7.2` dependency and `src/utils/objectId.ts` (`isObjectIdString`, `toObjectId`, `toObjectIdOrUndefined`).
2. Failing service/route call sites migrated off `ObjectId.isValid` / `createFromHexString` / `new Types.ObjectId(id)`.
3. `granotCrmCsv/storage.ts` uses `S3Client.send` directly (no custom sender facade).
4. `googleDriveOAuth/spreadsheet.service.ts` uses the Sheets-style `as unknown as drive_v3.Options` / `sheets_v4.Options` cast.

For new code, keep using the helper and patterns above rather than reintroducing raw SDK statics.

Also avoid `new mongoose.mongo.ObjectId(id)` in app code — use `toObjectId(id)` instead so construction stays centralized.

`pnpm run typecheck` excludes `scripts/dev_ops/**` (one-off ops tooling). Runtime/API code under `src/`, `api/`, and non-dev_ops scripts must stay clean.
