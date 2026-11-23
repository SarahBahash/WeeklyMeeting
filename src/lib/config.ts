import "server-only";

export const isProduction = process.env.NODE_ENV === "production";

/**
 * TEST / DEMO deployments with SYNTHETIC data only. Enables password sign-in for the
 * synthetic test accounts and shows a permanent warning banner. Never enable it on an
 * environment that holds real Internal Audit information – production uses SSO only.
 */
export const demoMode = process.env.DEMO_MODE === "true";

function int(name: string, fallback: number) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  sessionIdleMinutes: int("SESSION_IDLE_MINUTES", 60),
  sessionAbsoluteHours: int("SESSION_ABSOLUTE_HOURS", 10),
  /** Local password login is for development with synthetic data only. It can never be enabled in production. */
  localAuthEnabled: demoMode || (!isProduction && process.env.AUTH_LOCAL_ENABLED === "true"),
  oidc: {
    issuer: process.env.OIDC_ISSUER_URL ?? "",
    clientId: process.env.OIDC_CLIENT_ID ?? "",
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
    scopes: process.env.OIDC_SCOPES ?? "openid email profile",
    requireMfa: process.env.OIDC_REQUIRE_MFA !== "false",
    mfaAmrValues: (process.env.OIDC_MFA_AMR_VALUES ?? "mfa,otp,hwk,swk,fido,phr,phrh").split(",").map((s) => s.trim()).filter(Boolean),
    displayName: process.env.OIDC_DISPLAY_NAME ?? "Company Single Sign-On",
  },
  maxUploadBytes: int("IMPORT_MAX_UPLOAD_BYTES", 10 * 1024 * 1024),
};

export function oidcConfigured() {
  return Boolean(config.oidc.issuer && config.oidc.clientId && config.oidc.clientSecret);
}

export const SESSION_COOKIE = isProduction ? "__Host-iahub_session" : "iahub_session";
