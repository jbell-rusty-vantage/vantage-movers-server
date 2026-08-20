# Unit 33 extension installed-client inventory template

Status: **template only — not release evidence until completed and signed by an Owner**  
Purpose: prove that no supported Granot Sync extension client older than `0.2.8` remains installed or authorized for use.

## Evidence boundary

The server's existing `browser_extension` receipts do not record extension version. Their allowlisted `user-agent` identifies the browser family, not the installed extension build. Repository/package version and a sample of active clients are therefore insufficient.

This inventory is acceptable only when it defines the complete supported-client universe, accounts for every member of that universe, and is signed by an Owner. Use stable device/operator aliases rather than contact data. Do not include browser storage, access tokens, customer payloads, names, phone numbers, email addresses, or Granot records.

## Inventory metadata

- Inventory ID:
- Inventory UTC timestamp:
- Inventory owner alias:
- Supported-client universe source (for example, managed-device roster or complete Owner-maintained workstation list):
- Universe record count:
- Inventory row count:
- Evidence storage location:
- Evidence retention owner:

The universe record count and inventory row count must match. Every excluded, retired, unavailable, or lost device must still have a row and a disposition.

## Installed-client rows

For each supported installation, open the installed extension popup diagnostics and record the displayed manifest version and browser. A screenshot or equivalent immutable evidence should show the diagnostics version and capture time; store it outside this repository under the normal access-control policy and record only its checksum/reference here.

| Device/client alias | Browser | Installed version | Runtime-ID hash/reference | Verified UTC | Evidence checksum/reference | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  | `active_0.2.8` / `retired` / `blocked_from_use` |

Acceptance rules:

1. Every supported installation is represented exactly once.
2. Every active installation reports exactly `0.2.8` or a later separately approved compatible version.
3. Any installation below `0.2.8`, unverifiable installation, or missing universe row blocks Unit 33.
4. A retired or blocked installation includes dated evidence that it can no longer call the supported extension apply surface.
5. Counts reconcile and no row contains payload, credential, or contact data.

## Owner attestation

> I attest that this inventory accounts for every supported Granot Sync browser-extension installation, not merely recently active clients. Every active supported installation reports version `0.2.8` or a later separately approved compatible version. Every older, missing, or unverifiable installation has been retired or blocked from the supported apply surface. To the best of my knowledge, zero supported pre-`0.2.8` clients remain.

- Owner alias:
- Owner role:
- Signed UTC timestamp:
- Signature or approved change-record reference:

## Unit 33 review

- Reviewer alias:
- Reviewed UTC timestamp:
- Universe count equals inventory count: yes / no
- Active pre-`0.2.8` count:
- Missing/unverifiable count:
- Retired/blocked evidence complete: yes / no
- Approved as Unit 33 compatibility-removal evidence: yes / no
- Approval record/reference:

Until the completed inventory is Owner-signed and approved, compatibility result translation and supported compatibility endpoints remain in place and Unit 33 remains blocked.
