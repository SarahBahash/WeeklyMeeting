# Database

PostgreSQL 14+ (tested on 16). Schema: `prisma/schema.prisma`. Migrations: `prisma/migrations/`.

## Tables

| Table | Purpose |
|---|---|
| `users`, `sessions` | Provisioned users (role, organizer flag, SSO subject) and server-side sessions (SHA-256 token hashes only) |
| `activity_types` | Audit Review, Management Meeting, General Task, Other Activity (admin-extensible; `supportsStages`) |
| `projects` | Optional grouping (e.g. an audit engagement). Items are never merged because they share a project |
| `audit_stage_templates`, `audit_stage_template_stages` | Configurable lifecycle blueprints (seeded 14-step template) |
| `project_stages` | A project's own stages: owner, status, target date, actual completion date, version |
| `action_points` | The tracker. Internal ID, `legacySn`, current values, `source*` original import values, `importKey` (unique), `version`, `restricted` |
| `action_point_changes` | Field-level change history (append-only) |
| `deadline_changes` | Every deadline revision and original-date correction (append-only) |
| `meetings` | One per date (unique). Draft or finalized, organizer, attendees, permanent `summary` |
| `meeting_agenda_items` | Agenda order, review state, immutable `snapshot`, `finalSnapshot` |
| `meeting_updates` | Feedback and changes recorded per agenda item (append-only) |
| `meeting_revisions` | Corrections to finalized meetings (append-only) |
| `import_batches` | Upload preview and commit records (file SHA-256, sheet, summary) |
| `legacy_history_records` | Raw rows of the historical tracker, with the admin's merge/retain/skip decision |
| `export_logs` | Who exported what and when (append-only) |
| `system_audit_logs` | Security and administrative events (append-only) |

## Integrity rules enforced in the database

Migration `20261123130000_append_only_logs` installs triggers that:

- reject `UPDATE`/`DELETE` on `system_audit_logs`, `action_point_changes`, `deadline_changes`,
  `meeting_updates`, `meeting_revisions` and `export_logs`
- reject `DELETE` on `action_points` (completed and closed items always remain in reports)
- reject changes to the agenda of a finalized meeting, and any change to an agenda `snapshot`
- reject deleting meetings and editing a finalized meeting's summary, date, organizer, attendees or notes

Unique constraints: `action_points.importKey` (one workbook row is imported at most once),
`action_points.clientRequestId` (idempotent creates), `meetings.meetingDate`, and
`meeting_agenda_items(meetingId, actionPointId)`.

## Recommended production roles

- `iahub_migrator`: owns the schema and runs `prisma migrate deploy` during release.
- `iahub_app`: `SELECT, INSERT, UPDATE` on the application tables, `DELETE` only on `sessions`,
  `import_batches`, `project_stages` and `audit_stage_template_stages`. It does not own the tables,
  so it cannot disable the triggers.

## Backup and restore

```bash
DATABASE_URL=postgresql://… scripts/backup.sh /secure/backup/location
```

```bash
TARGET_DATABASE_URL=postgresql://…/empty_db scripts/restore.sh /secure/backup/location/iahub-<stamp>.dump
```

These were tested in development. A full dump was restored into an empty database, the row counts in all
key tables matched, and the append-only triggers were still active after the restore. Schedule backups
on the approved platform and run a restore test regularly.
