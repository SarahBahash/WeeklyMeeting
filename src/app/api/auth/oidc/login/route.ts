import { NextResponse } from "next/server";
import { config, isProduction, oidcConfigured } from "@/lib/config";
import { client, getOidcConfiguration, OIDC_COOKIE, redirectUri } from "@/lib/auth/oidc";

export async function GET() {
  if (!oidcConfigured()) return NextResponse.redirect(new URL("/login?error=sso_not_configured", config.appUrl));
  try {
    const cfg = await getOidcConfiguration();
    const codeVerifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const url = client.buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri(),
      scope: config.oidc.scopes,
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    const res = NextResponse.redirect(url);
    res.cookies.set(OIDC_COOKIE, JSON.stringify({ codeVerifier, state, nonce }), {
      httpOnly: true, secure: isProduction, sameSite: "lax", path: "/api/auth/oidc", maxAge: 600,
    });
    return res;
  } catch (e) {
    console.error("[oidc] discovery failed", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/login?error=sso_unavailable", config.appUrl));
  }
}
