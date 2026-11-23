# Deployment and environment configuration

> Deploy only to an environment approved by IT and Information Security. Do not use a public
> AI website builder or any unapproved platform for confidential audit data.

## Environment variables

See `.env.example` for the full list.

| Variable | Required (prod) | Description |
|---|:-:|---|
| `DATABASE_URL` | ✓ | PostgreSQL URL. Append `&sslmode=require` in production. Inject from the secret manager. |
| `APP_URL` | ✓ | Public HTTPS URL. Used to build the SSO redirect URI. |
| `OIDC_ISSUER_URL` | ✓ | OIDC issuer (discovery at `/.well-known/openid-configuration`). Must be HTTPS. |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | ✓ | Confidential client registered with the IdP. The secret comes from the secret manager. |
| `OIDC_SCOPES` | | Default `openid email profile`. |
| `OIDC_REQUIRE_MFA` | | Default `true`. The ID token's `amr` claim must contain one of `OIDC_MFA_AMR_VALUES`. Configure Conditional Access / MFA policy at the IdP as well. |
| `OIDC_DISPLAY_NAME` | | Text on the sign-in button. |
| `SESSION_IDLE_MINUTES` / `SESSION_ABSOLUTE_HOURS` | | Defaults 60 min idle, 10 h absolute. |
| `IMPORT_MAX_UPLOAD_BYTES` | | Default 10 MB. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_NAME` | first run | Creates the first administrator, who signs in via SSO. |
| `AUTH_LOCAL_ENABLED`, `SEED_DEV_PASSWORD`, `OIDC_ALLOW_INSECURE_HTTP_FOR_TESTING` | | **Development and testing only. Ignored when `NODE_ENV=production`.** |

## SSO registration

1. In the corporate IdP, create a **web / confidential** OIDC application.
2. Redirect URI: `https://<APP_URL>/api/auth/oidc/callback`.
3. Grant type: authorization code. PKCE (S256) is always used. Request the `openid email profile` scopes.
4. Make sure the ID token includes `email` and `amr` (Entra ID includes `amr` in v1 tokens; on some IdPs you add it as an optional claim).
5. Enforce MFA with IdP policy (e.g. Conditional Access).
6. Users have no access until an administrator adds them (Administration → Users & Roles) with the same email address. On first sign-in the IdP subject (`sub`) is linked to the user.

SAML-only IdPs: use the IdP's OIDC endpoint or an approved SAML-to-OIDC broker such as Keycloak.
The application deliberately has only one federation protocol to maintain.

## Release steps

```bash
npm ci
```

```bash
npx prisma migrate deploy          # run as the migration (owner) role
```

```bash
SEED_ADMIN_EMAIL=head.of.ia@company.example npm run db:seed   # first release only (reference data + first admin)
```

```bash
npm run build
```

```bash
NODE_ENV=production npm start      # or the standalone server / container image (see Dockerfile)
```

Behind the reverse proxy or load balancer:

- terminate TLS (HTTPS only) and forward `X-Forwarded-For` / `X-Forwarded-Host`
- the app sends HSTS, CSP (nonce-based), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and `Permissions-Policy`
- session cookie in production: `__Host-iahub_session`, `HttpOnly`, `Secure`, `SameSite=Lax`
- set the request body limit to at least 11 MB for `/api/admin/import`
- add WAF / rate limiting if running more than one instance (the built-in limiter is per instance)

## Monitoring

- Application errors go to stdout with a short reference ID that is also shown to the user. Stack traces never reach the client.
- Security and administrative events are in `system_audit_logs` (Administration → System Audit Log). Forward them to the SIEM if required, e.g. through a read-only DB replica or a scheduled extract.
- Health: `GET /login` returns 200 when the app is up. Database reachability can be checked with any authenticated API call.

## Updates

Use the normal CI/CD pipeline: dependency audit → build → test (unit + integration against a disposable DB) →
image scan → deploy to staging → business smoke test → production. Run migrations before switching traffic.
