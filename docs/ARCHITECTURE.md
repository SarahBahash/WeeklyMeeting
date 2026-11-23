# Architecture

```
src/
  middleware.ts            Edge: nonce-based CSP, CSRF origin check for API writes, login redirect
  app/
    login/                 SSO button (+ dev-only local sign-in)
    (app)/                 Authenticated pages (server layout validates the session)
      page.tsx             Dashboard
      meeting/             Start / resume Sunday meeting
      meetings/            History, meeting record, meetings/[id]/run = meeting mode
      action-points/       All action points, detail + history
      audits/              Projects, stage timelines, stage templates
      exports/             Excel Reports
      admin/               Import wizard, historical records, users, activity types, audit log
    api/                   Route handlers – every one wrapped by apiRoute() (auth + permissions)
  lib/
    api.ts                 apiRoute(): authentication, default-deny permission check, rate limit, safe errors
    auth/                  Sessions (DB-backed, hashed tokens), permissions matrix, OIDC
    services/              action-points (update/create + history), meetings, stages
    import/                xlsx-guard (zip-bomb/macro checks), cell parsing, sheet parsers, import service
    export/workbook.ts     ExcelJS workbook builders
    visibility.ts          Row-level filter (restricted records) used by every query
    domain.ts / dates.ts   Shared status/priority definitions, delay calculation, Riyadh dates
```

## Key design decisions

- **The database is the source of truth.** Excel is used once, for the initial import, and afterwards only for exports. There is no two-way synchronization.
- **IDs.** Every record has an internal `cuid`. The Excel `SN` is kept as `legacySn`, a display and reference field only.
- **Original values are preserved.** Imported status text (e.g. `" In Progress"`, `"Complete"`), the Delays value, non-date text in date columns (e.g. `"Ongoing"`) and the source sheet and row are stored in `source*` fields and never modified afterwards.
- **Activity types are never guessed.** Imported rows are *Unclassified* until an editor or admin classifies them. Stage controls appear only for types that support stages.
- **Optimistic concurrency.** Every action point has a `version`. Updates use `UPDATE … WHERE id AND version`. A stale write returns HTTP 409 with the latest record, and the UI offers "reload" or "re-apply my changes". Nothing is silently overwritten.
- **One change, one history group.** `applyUpdate()` is the only write path, used by quick edit, the form and meetings. It writes field-level `action_point_changes` rows and `deadline_changes` rows in the same transaction.
- **Meeting snapshots.** Agenda items store `snapshot` (when the item entered the agenda) and `finalSnapshot` (after the meeting). Historical meeting views and exports use these, never today's values.
- **Finalized meetings are immutable.** Enforced by database triggers. Corrections go to `meeting_revisions`.
- **Dates.** Business dates are PostgreSQL `DATE` values with no time zone. "Today" is computed in Asia/Riyadh.

## Permission model (server-side, default deny)

| Permission | Viewer | Editor | Editor + organizer | Admin |
|---|:-:|:-:|:-:|:-:|
| Read action points / meetings / stages | ✓ | ✓ | ✓ | ✓ |
| Edit action points, quick edit, participate in meeting | | ✓ | ✓ | ✓ |
| Start / reorder / finish meetings | | | ✓ | ✓ |
| Manage project stages | | ✓ | ✓ | ✓ |
| Export Excel | | ✓ | ✓ | ✓ |
| Correct original target dates, restricted records, export by original status | | | | ✓ |
| Correct finalized meetings (revisions) | | | | ✓ |
| Import, users, templates, activity types, audit log | | | | ✓ |

`src/lib/auth/permissions.ts` defines the matrix. `apiRoute({ permissions })` checks it on every API call,
and the services check it again. Restricted records are filtered by `visibleActionPoints(user)` in every
query, including exports and meeting views, so changing a URL or record ID returns 404.
