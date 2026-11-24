import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGES = ["/login"];
const SESSION_COOKIES = ["iahub_session", "__Host-iahub_session"];

function appUrlHost(): string | null {
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL).host : null;
  } catch {
    return null;
  }
}

/**
 * Edge middleware: nonce-based Content-Security-Policy, CSRF origin checks for
 * state-changing API calls, and a fast redirect to /login when no session cookie exists.
 * (Sessions are fully validated server-side on every request.)
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isApi && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    // The request must come from this application's own origin: the Host / X-Forwarded-Host
    // it was addressed to, or the configured public APP_URL (needed behind proxies that
    // rewrite the host, e.g. GitHub Codespaces port forwarding).
    const origin = req.headers.get("origin");
    const allowed = new Set(
      [req.headers.get("host"), req.headers.get("x-forwarded-host"), appUrlHost()].filter((h): h is string => Boolean(h)),
    );
    let ok = false;
    try {
      ok = !!origin && allowed.has(new URL(origin).host);
    } catch {
      ok = false;
    }
    if (!ok) return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 });
  }

  const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));
  if (!isApi && !PUBLIC_PAGES.includes(pathname) && !hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (isApi) return NextResponse.next();

  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};
