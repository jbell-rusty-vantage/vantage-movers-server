# Design source inventory

Source root: `vantage-sales-intelligence/`, preserved intact. No Git revision; SHA-256 before adaptation. Destination root: `vantage-admin/components/sales-intelligence/`. Attention/followup/ownership/detail-panel are adapted from the corresponding organisms/molecule/template; badge/CSS are copied; button wraps host primitive; format keeps display-only helpers. No export integration, demo or API adapter copied.

| Source | SHA-256 | Destination/adaptation |
| --- | --- | --- |
| components/sales-intelligence/styles/sales-intelligence.css | 69c48b81d42c05b9436efab718d7f755466b59da6e71b6649532464bce9cb70c | Admin scoped presentation; adapt imports/DTOs and remove unavailable controls |
| components/sales-intelligence/organisms/attention.tsx | 57512bf5aa3643e294fec54616ef4c53048745f4d082765be095edf9f937930a | Admin scoped presentation; adapt imports/DTOs and remove unavailable controls |
| components/sales-intelligence/organisms/followup-card.tsx | 1932fc82cd22e83e82b4a787882e65844f3edde98a720f63686967de008bd82b | Admin scoped presentation; adapt imports/DTOs and remove unavailable controls |
| components/sales-intelligence/molecules/ownership.tsx | 755bd8445b3bae0456d41a468143e80cd5c56fda2dd3660af7e95fe885660d98 | Admin scoped presentation; adapt imports/DTOs and remove unavailable controls |
| components/sales-intelligence/templates/side-panel.tsx | b2413b718a905385b6c8c2b6c51a99509d00340ec819a2190cfea31ef3342902 | Admin scoped presentation; adapt imports/DTOs and remove unavailable controls |
| components/sales-intelligence/atoms/badge.tsx | dbbb2b3e0136451d6b20ea02cb8b8f07359f0e647c9accef03045fb96dcb553a | Admin scoped presentation; adapt imports/DTOs and remove unavailable controls |
| components/sales-intelligence/atoms/button.tsx | c44af1b115b4f735daacb49ac42d9eebe4e522c01e2ef278f763dba697c82a7d | Admin scoped presentation; adapt imports/DTOs and remove unavailable controls |
| components/sales-intelligence/lib/format.ts | c4365180d6b3c5c5a06b7003ebdc5025b8fca86797e9234bc5a86536d8b664f9 | Admin scoped presentation; adapt imports/DTOs and remove unavailable controls |

## Intake documentation (read-only export)

- DESIGN-HANDOFF.md : b1b4428e776d0af17e21d744970d002876772b26df3b3dd451e9e02dc3b1c894
- INTEGRATION.md : 6083231bf7d71e5796394ce7641bcc1286953330db066f4cee5d5fcfc7f8b2f3
- CONTRACT-GAPS.md : 97b20323b5e075d2485998322660bcce5dbc161f3e86a02c6abe292d84971688
- VALIDATION.md : 88ff044ba32edeaab8e6c587e8df4d4497323d069ab90b11b2c9650ee256be32

Exact component destinations under Admin: `organisms/attention.tsx` → `components/sales-intelligence/attention.tsx`; `organisms/followup-card.tsx` → `components/sales-intelligence/followup-card.tsx`; `molecules/ownership.tsx` → `components/sales-intelligence/ownership.tsx`; `templates/side-panel.tsx` → `components/sales-intelligence/detail-panel.tsx`. The CSS, atoms and format helper retain their relative paths. `workspace.tsx`, typed consumer and query hook are host integration written against inspected server contracts, not copied export adapters.
