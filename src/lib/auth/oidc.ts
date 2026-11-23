import "server-only";
import * as client from "openid-client";
import { config, isProduction } from "../config";

let cached: Promise<client.Configuration> | null = null;

/** Enterprise SSO via the organisation's OIDC identity provider (Entra ID, Okta, Ping, ADFS, Keycloak …). */
export function getOidcConfiguration() {
  // Plain-HTTP issuers are only allowed for local testing with a mock IdP – never in production.
  const insecure = !isProduction && process.env.OIDC_ALLOW_INSECURE_HTTP_FOR_TESTING === "true";
  cached ??= client.discovery(
    new URL(config.oidc.issuer), config.oidc.clientId, config.oidc.clientSecret, undefined,
    insecure ? { execute: [client.allowInsecureRequests] } : undefined,
  ).catch((e) => {
    cached = null;
    throw e;
  });
  return cached;
}

export const OIDC_COOKIE = "iahub_oidc_tx";
export const redirectUri = () => new URL("/api/auth/oidc/callback", config.appUrl).toString();
export { client };
