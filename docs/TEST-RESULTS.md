# Test results

Run on 23 Nov 2026 in the development sandbox (Node 22, PostgreSQL 16, Chromium/Playwright) with
**synthetic data only** (`samples/SYNTHETIC-IA-Weekly-Meeting-Action-points.xlsx`: 23 In Progress, 4 Completed/Complete,
2 Closed, a repeated title and header block, blank stages, "Ongoing"/"TBD"/"Q1 2027" in date columns, Excel serial
dates, text dates, Delays formulas, and a historical sheet with near-duplicates).

| Suite | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | pass |
| Production build (`next build`) | pass |
| Unit tests (`npm test`) | **38 / 38 passed** |
| End-to-end API tests (`npm run test:integration`, real server + PostgreSQL) | **44 / 44 passed** |

## End-to-end tests

```
 ✓ security > rejects unauthenticated access to business data
 ✓ security > rejects wrong passwords and unknown users with the same message
 ✓ security > blocks cross-site state-changing requests (CSRF)
 ✓ security > sets security headers
 ✓ security > viewer and editor cannot use admin APIs
 ✓ Excel import > rejects files that are not real .xlsx workbooks
 ✓ Excel import > previews the main tracker: headers, repeated rows, statuses, dates
 ✓ Excel import > commits the import and preserves original values
 ✓ Excel import > retrying the same commit or re-importing the same workbook cannot duplicate records
 ✓ Excel import > concurrent confirmations of one preview commit exactly once
 ✓ Excel import > imports the historical sheet for review without merging
 ✓ Excel import > creates an audit-stage template from Sheet1 (not action points)
 ✓ dashboard > counts match the database
 ✓ dashboard > filters by status, owner and search; blank-stage items appear
 ✓ dashboard > never marks undated / 'Ongoing' items overdue
 ✓ quick edit and deadline history > viewer cannot modify records through the API
 ✓ quick edit and deadline history > editor quick-edits, history is recorded, version increments
 ✓ quick edit and deadline history > concurrent edits cannot silently overwrite each other
 ✓ quick edit and deadline history > rejects invalid edits
 ✓ quick edit and deadline history > logs every deadline revision and protects original target dates
 ✓ quick edit and deadline history > history tables are append-only in the database
 ✓ restricted records (IDOR protection) > restricted items are invisible to non-admins by list, id and export
 ✓ Sunday meeting > only organizers can start meetings
 ✓ Sunday meeting > creates a meeting with every In Progress item (audit and non-audit, blank stages)
 ✓ Sunday meeting > prevents duplicate meetings
 ✓ Sunday meeting > Save & Next persists updates, marks reviewed and keeps the snapshot
 ✓ Sunday meeting > detects concurrent edits during the meeting
 ✓ Sunday meeting > revises a deadline in the meeting, skips an item, saves a draft
 ✓ Sunday meeting > adds a new action during the meeting (idempotent) and reorders the agenda
 ✓ Sunday meeting > warns about unreviewed items, then finalizes with a stored summary
 ✓ Sunday meeting > finalized meetings are immutable; corrections become revisions
 ✓ Sunday meeting > completed items are excluded from the next meeting's default agenda
 ✓ Excel export > viewer cannot export
 ✓ Excel export > exports all statuses as a real, formatted .xlsx
 ✓ Excel export > exports only IN_PROGRESS when one status is selected
 ✓ Excel export > exports only COMPLETED when one status is selected
 ✓ Excel export > exports only CLOSED when one status is selected
 ✓ Excel export > exports only ON_HOLD when one status is selected
 ✓ Excel export > exports only NOT_STARTED when one status is selected
 ✓ Excel export > separates each status into its own worksheet
 ✓ Excel export > admin can export by original imported status (Complete vs Completed)
 ✓ Excel export > neutralises spreadsheet formula injection
 ✓ Excel export > exports a historical meeting as recorded
 ✓ Excel export > logs every export
```

## Manual / scripted verification

| Check | Result |
|---|---|
| Browser walkthrough of every page (Playwright, 1600×1000) | No script errors or CSP violations. Screenshots in `docs/screenshots/` |
| Viewer opening `/admin` | Redirected to `/forbidden` |
| Phone width (390 px) | No horizontal page scroll (tables scroll inside their cards) |
| SSO with a mock OIDC IdP | Successful login (PKCE/state/nonce) → dashboard; ID token without MFA `amr` → `mfa_required`; unknown user → `not_provisioned`; all events audit-logged |
| Production mode (`NODE_ENV=production`) | Local sign-in refused even with `AUTH_LOCAL_ENABLED=true`; HSTS and `X-Frame-Options: DENY` sent; login page shows SSO only |
| Backup → restore into an empty database | Identical row counts; append-only triggers still active after restore |
| Generated `.xlsx` files | Valid OOXML (ZIP `PK` signature), re-opened with ExcelJS in tests: headers, frozen row, AutoFilter, typed dates, no formulas |

## Not yet verified (needs organisational infrastructure)

- Opening the exports in **Microsoft Excel desktop** (no Excel in the sandbox; the files are standard OOXML written by ExcelJS). Include this in business acceptance testing.
- SSO against the organisation's **real IdP**, and MFA policy enforcement there.
- Import of the **real workbook** (intentionally not done: not an approved environment).
- Container image build, load and penetration testing, accessibility audit with assistive technology, business acceptance testing.
