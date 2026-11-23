# Security controls

| Requirement | Implementation | Verified by |
|---|---|---|
| No public signup or anonymous access | Users are pre-provisioned by admins. Every page layout and every API route validates the server-side session. The middleware redirects to /login. | Integration tests: 401 on all business APIs without a session |
| Enterprise SSO + MFA | OIDC authorization code + PKCE, state and nonce (`openid-client`). Optional `amr` MFA check (on by default). Unknown users are rejected. | Manual run against a mock IdP: success, `mfa_required` and `not_provisioned` rejections |
| No fake login | Local password sign-in exists only for development. `config.localAuthEnabled` is hard-wired to `false` when `NODE_ENV=production`. Passwords are bcrypt (cost 12). | Code review (`src/lib/config.ts`) |
| Secure sessions | Random 256-bit token. Only its SHA-256 is stored. Idle and absolute expiry. `HttpOnly`, `SameSite=Lax`, `Secure` + `__Host-` prefix in production. Sessions are revoked when a user is deactivated or changes role. | Code review |
| Server-side authorization / least privilege | `apiRoute({ permissions })` (default deny) plus checks inside the services. | Tests: viewer PATCH/POST → 403; editor admin APIs → 403; editor cannot start meetings or correct original dates |
| IDOR | Every action-point query is filtered through `visibleActionPoints(user)`. Restricted records return 404 to non-admins by ID, in history, lists, exports and meetings. | Test "restricted items are invisible…" |
| CSRF | Writes to `/api/*` require an `Origin` matching the host (middleware), plus SameSite cookies and JSON bodies. | Test: cross-site and missing Origin → 403 |
| XSS | React escaping, no `dangerouslySetInnerHTML`, nonce-based CSP with `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`. | Header test; browser run shows no CSP violations |
| SQL injection | Prisma parameterised queries only. The two raw queries use tagged templates (parameterised). | Code review |
| Input validation | Zod schemas on every write (lengths, enums, real calendar dates). Body size limits. | Tests: invalid status / date / empty title → 400 |
| Upload security | `.xlsx` only, ≤10 MB, ZIP structure check before parsing, entry count, expanded size and compression-ratio limits (zip-bomb), macro workbooks (`vbaProject.bin`) rejected, formulas never evaluated, rate-limited, admin only, preview before commit. | Unit + integration tests |
| Formula injection | Text starting with `= + - @ TAB CR` (and full-width variants) is prefixed with `'` in every export. | Test "neutralises spreadsheet formula injection" |
| Export authorization + logging | Permission check before generation. Restricted data excluded. `export_logs` + audit log record user, time, report and parameters. | Tests |
| Audit log integrity | `system_audit_logs` and all history tables are append-only (DB triggers). There is no update or delete API. | Test "history tables are append-only" |
| Error handling | Generic error with a reference ID to the client. Details only in server logs. Prisma errors mapped to 404/409. | Code review |
| Duplicate submissions / data loss | Buttons disabled while in flight. Idempotent creates (`clientRequestId`). Unique meeting date. Import row keys + row-locked commit. Optimistic locking. Unsaved-changes warnings. | Tests: concurrent commit, repeated create, stale version |
| Rate limits | Login (5/min per IP+email, 30/5 min per IP), import, export. | Code review |
| Security headers | CSP, HSTS (prod), X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP. `X-Powered-By` removed. | Test "sets security headers" |
| No external AI / third-party processing | The app makes no calls to external services other than the configured IdP. | Code review |

## Known limitations / to review before go-live

- The rate limiter is in-memory. With multiple instances, use a WAF or a shared store.
- `style-src 'unsafe-inline'` is allowed (needed for small inline style attributes, such as the progress bar width).
- `npm audit` lists advisories in development and build tooling. Review them before release.
- SSO has not been tested against the organisation's real IdP.
