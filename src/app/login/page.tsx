import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { config, oidcConfigured } from "@/lib/config";
import { LoginForm } from "./LoginForm";

const ERRORS: Record<string, string> = {
  sso_not_configured: "Single sign-on has not been configured yet. Contact the system administrator.",
  sso_unavailable: "The identity provider could not be reached. Please try again shortly.",
  sso_expired: "The sign-in attempt expired. Please try again.",
  sso_failed: "Sign-in failed. Please try again.",
  mfa_required: "Multi-factor authentication is required. Please sign in again using MFA.",
  not_provisioned: "Your account has not been granted access to this application. Contact an administrator.",
  session_expired: "Your session has expired. Please sign in again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { error } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-white p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-white"><ShieldCheck className="h-7 w-7" aria-hidden /></div>
          <h1 className="mt-4 text-2xl font-semibold">IA Weekly Meeting Hub</h1>
          <p className="mt-1 text-sm text-muted">Internal Audit · Authorised users only</p>
        </div>
        <div className="card p-6 shadow-card">
          {error && ERRORS[error] && <p className="mb-4 rounded-md border border-danger/30 bg-danger-light px-3 py-2 text-sm text-danger" role="alert">{ERRORS[error]}</p>}
          <a href="/api/auth/oidc/login" aria-disabled={!oidcConfigured()}
            className={`flex w-full items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium ${oidcConfigured() ? "bg-brand text-white hover:bg-brand-dark" : "pointer-events-none border border-line bg-navy-50 text-muted"}`}>
            Sign in with {config.oidc.displayName}
          </a>
          {!oidcConfigured() && <p className="mt-2 text-center text-xs text-muted">SSO is not configured in this environment.</p>}
          {config.localAuthEnabled && (
            <div className="mt-6 border-t border-line pt-5">
              <p className="mb-3 rounded-md border border-warn/30 bg-warn-light px-3 py-2 text-xs text-warn">
                Development sign-in (synthetic test users only). This option is automatically disabled in production.
              </p>
              <LoginForm />
            </div>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-muted">Confidential – Internal Audit information. Activity is logged.</p>
      </div>
    </div>
  );
}
