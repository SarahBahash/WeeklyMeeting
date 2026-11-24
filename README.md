# IA Weekly Meeting Hub

A web application that replaces the Internal Audit department's Excel action-point tracker
and runs the weekly **Sunday Meeting**.

> **Status: working application, development environment, synthetic data only.**
> It is **not production-ready** until the items in
> [Pending production prerequisites](#pending-production-prerequisites) are complete
> (security review, approved hosting, SSO registration, business acceptance testing).

## What it does

| Area | Highlights |
|---|---|
| **Dashboard** | Summary cards from live data (Total, In Progress, Completed, Closed, On Hold, Overdue, Due Soon), one-click status filter, search, filters for status, activity type, project, owner, priority and stage. **Start / Resume Sunday Meeting** button. |
| **Sunday Meeting** | Starts a meeting dated today (Asia/Riyadh, editable) and loads every *In Progress* item, audit and non-audit, including blank stages, in tracker order. An immutable snapshot is saved first. Three-panel screen: agenda, current item, update form. Buttons: **Previous, Save Draft, Save & Next, Mark Reviewed, Skip for Now, Add New Action, Finish Meeting, Export Meeting to Excel**. Shows a progress bar, lets organizers reorder the agenda and add items, and supports draft/resume. Detects conflicting edits. Warns about unreviewed items. Stores a permanent summary. |
| **All Action Points** | Excel-like **quick edit** (status, owner, stage, priority, target date subject to permission, revised date), an expanded feedback editor, and a full edit form. Every change is validated on the server and logged. |
| **Action point page** | Original imported values, a change-history timeline (who, when, old → new, meeting), deadline history, and meeting updates. |
| **Deadline history** | Every revision is stored permanently: previous and new deadline, who, when and reason. Corrections to the original target date (admins only, reason required) are logged separately. Overdue days and extension days are calculated separately. Undated or "Ongoing" items are never overdue. |
| **Audit Reviews & Stages** | Configurable stage templates (the 14-step Accounts Receivable lifecycle is seeded; admins can add stages such as *Testing Phase*). Per-project stage timeline with owner, status, target and actual dates, and linked action points. Several stages can be active at once. Never forced on non-audit work. |
| **Meeting History** | Searchable by date, project, activity type and owner. Shows the snapshot, the outcome, recorded updates and the summary. Corrections after finalization are stored as **revisions**; the original is never rewritten. |
| **Excel Reports** | Real `.xlsx` (ExcelJS) generated on the server: full tracker, any single status, a separate sheet per status, the weekly or a historical meeting, plus optional Update History, Deadline History and Audit Stages sheets. Formatted headers, AutoFilter, frozen header row, date formats, wrapped feedback, a Report Info sheet with the export time. Protected against formula injection. Every export is logged. |
| **Administration** | Import wizard (preview, column mapping, duplicate review, confirm or cancel), review of historical (IA-MOM (2)) records with merge / retain / skip, users and roles, activity types, and a read-only system audit log. |

## Technology

Next.js 15 (App Router) with TypeScript · Tailwind CSS · PostgreSQL 16 · Prisma ORM with SQL migrations ·
ExcelJS for server-side `.xlsx` import and export · `openid-client` for OIDC SSO with PKCE · Zod validation · Vitest and Playwright.

All business logic and authorization run on the server (`src/lib/services`, `src/lib/api.ts`).
The browser never stores business data. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quick start (development, synthetic data)

Prerequisites: Node.js 22, PostgreSQL 14+.

```bash
npm install
```

```bash
cp .env.example .env    # then edit DATABASE_URL; set AUTH_LOCAL_ENABLED="true" and SEED_DEV_PASSWORD for local sign-in
```

```bash
npx prisma migrate deploy
```

```bash
npm run db:seed          # activity types, default stage template, synthetic test users
```

```bash
npm run synthetic:workbook   # writes samples/SYNTHETIC-IA-Weekly-Meeting-Action-points.xlsx
```

```bash
npm run dev              # http://localhost:3000
```

Sign in as `admin@example.test` with the `SEED_DEV_PASSWORD` you set. The other test users are
`organizer@example.test` (Editor and meeting organizer), `editor@example.test` and `viewer@example.test`.
Then go to **Administration → Import Data** and import the synthetic workbook.

Local password sign-in is a **development-only** feature. It is switched off automatically when
`NODE_ENV=production`, whatever `AUTH_LOCAL_ENABLED` says. Production uses SSO only.

## Try the demo in GitHub Codespaces (synthetic data only)

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/SarahBahash/WeeklyMeeting?quickstart=1)

Click the button, then **Create codespace**. GitHub starts a private copy of the app with PostgreSQL
and the synthetic sample data, and after about 3–5 minutes opens the site in a new tab (or open it from the
**PORTS** tab, port 3000). Sign in with `admin@example.test` / `Demo-Synthetic-2026!`; the other roles are
`organizer@`, `editor@` and `viewer@example.test` with the same password. See `.devcontainer/DEMO.md`.
Stop the codespace when you are done to save your free monthly hours.

## Test deployment on Render (synthetic data only)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/SarahBahash/WeeklyMeeting)

`render.yaml` creates a free PostgreSQL database and the web app in Render's Frankfurt region.
On first start the app creates the tables, the test accounts and the synthetic sample data.
`DEMO_MODE=true` turns on password sign-in for the four synthetic test accounts (password chosen
during setup) and shows a "TEST ENVIRONMENT" banner on every page.
**Never use a demo-mode site for real Internal Audit data.** Render's free database expires after 30 days.

## Tests

```bash
npm test                                   # 38 unit tests (dates, delays, statuses, parsers, upload guard, sheet names)
```

```bash
# 44 end-to-end API tests against a running server and a DISPOSABLE database whose name ends in _test
DATABASE_URL=postgresql://…/iahub_test npx next dev -p 3001 &
DATABASE_URL=postgresql://…/iahub_test TEST_BASE_URL=http://localhost:3001 INTEGRATION_ALLOW_RESET=1 npm run test:integration
```

Results and what was verified manually are in [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): structure, data model, key design decisions
- [docs/DATABASE.md](docs/DATABASE.md): schema, migrations, integrity rules, backup and restore
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): environment configuration, SSO setup, deployment steps
- [docs/SECURITY.md](docs/SECURITY.md): security controls and how they are enforced
- [docs/FIRST-IMPORT.md](docs/FIRST-IMPORT.md): step-by-step first approved Excel import
- [docs/TEST-RESULTS.md](docs/TEST-RESULTS.md): test evidence

## Pending production prerequisites

1. **Hosting approval.** IT and Information Security must approve the hosting environment and data-handling process. Until then, use synthetic data only.
2. **SSO registration.** Register an OIDC client with the corporate IdP (Entra ID, Okta, Ping, ADFS…) and enforce MFA there. The flow has been tested against a mock IdP only. For SAML-only IdPs, use the IdP's OIDC endpoint or an approved SAML-to-OIDC broker.
3. **Secrets.** `OIDC_CLIENT_SECRET` and the DB credentials must come from the approved secret manager.
4. **HTTPS / TLS** at the load balancer or reverse proxy. Use TLS to PostgreSQL (`sslmode=require`). Storage encryption at rest is provided by the database platform.
5. **Database roles.** Run migrations with a privileged role and run the application with a least-privilege role (see [docs/DATABASE.md](docs/DATABASE.md)).
6. **Rate limiting** is in-memory per instance. With more than one instance, enforce limits at the WAF or proxy, or use a shared store.
7. **Backups.** Schedule `scripts/backup.sh` (or platform snapshots) to approved encrypted storage, and run a periodic restore test.
8. **Retention.** Confirm the data-retention period with Compliance. Nothing is purged automatically.
9. **Dependency review.** `npm audit` reports advisories in development tooling (vitest, the Prisma CLI's `effect`, Next's build-time `postcss`). Review them with the security team and update before go-live.
10. **Container image.** The `Dockerfile` has not been built in this sandbox. Build and scan it in the approved CI.
11. **Security review, penetration test and business acceptance testing.**
