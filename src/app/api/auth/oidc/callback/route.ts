import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { config, oidcConfigured } from "@/lib/config";
import { client, getOidcConfiguration, OIDC_COOKIE } from "@/lib/auth/oidc";
import { createSession, requestMeta } from "@/lib/auth/session";
import { auditLog } from "@/lib/audit";

const fail = (code: string) => {
  const res = NextResponse.redirect(new URL(`/login?error=${code}`, config.appUrl));
  res.cookies.delete({ name: OIDC_COOKIE, path: "/api/auth/oidc" });
  return res;
};

export async function GET(req: NextRequest) {
  if (!oidcConfigured()) return fail("sso_not_configured");
  const meta = await requestMeta();
  const raw = req.cookies.get(OIDC_COOKIE)?.value;
  if (!raw) return fail("sso_expired");
  let tx: { codeVerifier: string; state: string; nonce: string };
  try { tx = JSON.parse(raw); } catch { return fail("sso_expired"); }
  try {
    const cfg = await getOidcConfiguration();
    // Use the public URL (the app may sit behind a reverse proxy).
    const current = new URL(req.nextUrl.pathname + req.nextUrl.search, config.appUrl);
    const tokens = await client.authorizationCodeGrant(cfg, current, {
      pkceCodeVerifier: tx.codeVerifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims?.sub) return fail("sso_failed");
    if (config.oidc.requireMfa) {
      const amr = Array.isArray(claims.amr) ? (claims.amr as string[]) : [];
      if (!amr.some((v) => config.oidc.mfaAmrValues.includes(v))) {
        await auditLog(null, "auth.sso.denied_no_mfa", { details: { sub: claims.sub }, ip: meta.ip });
        return fail("mfa_required");
      }
    }
    const email = typeof claims.email === "string" ? claims.email.toLowerCase() : null;
    // No self-registration: the user must be pre-provisioned by an administrator.
    let user = await prisma.user.findUnique({ where: { oidcSubject: claims.sub } });
    if (!user && email && claims.email_verified !== false) {
      const byEmail = await prisma.user.findUnique({ where: { email } });
      if (byEmail && !byEmail.oidcSubject) user = await prisma.user.update({ where: { id: byEmail.id }, data: { oidcSubject: claims.sub } });
    }
    if (!user || !user.isActive) {
      await auditLog(null, "auth.sso.denied_not_provisioned", { details: { sub: claims.sub, email }, ip: meta.ip });
      return fail("not_provisioned");
    }
    await createSession(user.id, meta);
    await auditLog({ id: user.id, email: user.email }, "auth.login", { details: { method: "oidc" }, ip: meta.ip });
    const res = NextResponse.redirect(new URL("/", config.appUrl));
    res.cookies.delete({ name: OIDC_COOKIE, path: "/api/auth/oidc" });
    return res;
  } catch (e) {
    console.error("[oidc] callback failed", e instanceof Error ? e.message : e);
    await auditLog(null, "auth.sso.failed", { ip: meta.ip });
    return fail("sso_failed");
  }
}
