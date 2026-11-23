"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CalendarCheck2, ClipboardList, FileSpreadsheet, History, LayoutDashboard, LogOut, Milestone, Settings, ShieldCheck, UserCircle2,
} from "lucide-react";
import type { AuthUser, Permission } from "@/lib/auth/permissions";
import { AuthProvider } from "./auth-context";
import { ToastProvider } from "./toast";
import { cx } from "./ui";
import { api } from "@/lib/client";
import { formatDate } from "@/lib/dates";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, perm: "actionPoint:read" },
  { href: "/meeting", label: "Sunday Meeting", icon: CalendarCheck2, perm: "meeting:read" },
  { href: "/action-points", label: "All Action Points", icon: ClipboardList, perm: "actionPoint:read" },
  { href: "/audits", label: "Audit Reviews & Stages", icon: Milestone, perm: "actionPoint:read" },
  { href: "/meetings", label: "Meeting History", icon: History, perm: "meeting:read" },
  { href: "/exports", label: "Excel Reports", icon: FileSpreadsheet, perm: "export:run" },
  { href: "/admin", label: "Administration", icon: Settings, perm: "admin:users" },
] as const;

const TITLES: [RegExp, string][] = [
  [/^\/$/, "Dashboard"],
  [/^\/meeting$/, "Sunday Meeting"],
  [/^\/meetings\/[^/]+\/run/, "Sunday Meeting"],
  [/^\/meetings\/[^/]+/, "Meeting Record"],
  [/^\/meetings/, "Meeting History"],
  [/^\/action-points\/[^/]+/, "Action Point"],
  [/^\/action-points/, "All Action Points"],
  [/^\/audits/, "Audit Reviews & Stages"],
  [/^\/exports/, "Excel Reports"],
  [/^\/admin/, "Administration"],
];

export function AppShell({ user, permissions, children }: { user: AuthUser; permissions: Permission[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [draft, setDraft] = useState<{ id: string; meetingDate: string } | null>(null);
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? "IA Weekly Meeting Hub";
  const inMeeting = /^\/meetings\/[^/]+\/run/.test(pathname);

  useEffect(() => {
    api<{ draftMeeting: { id: string; meetingDate: string } | null }>("/api/meta").then((m) => setDraft(m.draftMeeting)).catch(() => undefined);
  }, [pathname]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }

  const isActive = (href: string) => (href === "/" ? pathname === "/" : href === "/meeting" ? pathname === "/meeting" || inMeeting : pathname.startsWith(href) && !(href === "/meetings" && inMeeting));

  return (
    <AuthProvider value={{ user, permissions }}>
      <ToastProvider>
        <div className="flex min-h-screen bg-white">
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
          <aside className={cx("sticky top-0 hidden h-screen flex-none flex-col border-r border-line bg-white md:flex", inMeeting ? "w-16 xl:w-60" : "w-60")}>
            <div className="flex h-16 items-center gap-2.5 border-b border-line px-4">
              <div className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-brand text-white"><ShieldCheck className="h-5 w-5" aria-hidden /></div>
              <div className={cx("leading-tight", inMeeting && "hidden xl:block")}>
                <div className="text-sm font-semibold">IA Weekly</div>
                <div className="text-xs text-muted">Meeting Hub</div>
              </div>
            </div>
            <nav className="flex-1 space-y-1 p-3" aria-label="Main">
              {NAV.filter((n) => permissions.includes(n.perm)).map((n) => (
                <Link key={n.href} href={n.href} title={n.label} aria-current={isActive(n.href) ? "page" : undefined}
                  className={cx("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium", isActive(n.href) ? "bg-brand-light text-brand-dark" : "text-navy hover:bg-navy-50")}>
                  <n.icon className="h-[18px] w-[18px] flex-none" aria-hidden />
                  <span className={cx(inMeeting && "hidden xl:inline")}>{n.label}</span>
                </Link>
              ))}
            </nav>
            <div className={cx("border-t border-line p-3 text-xs text-muted", inMeeting && "hidden xl:block")}>Confidential – Internal Audit</div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-16 flex-none items-center justify-between gap-4 border-b border-line bg-white px-6">
              <div className="flex min-w-0 items-center gap-3">
                <h2 className="truncate text-base font-semibold">{title}</h2>
                {draft && !inMeeting && (
                  <Link href={`/meetings/${draft.id}/run`} className="hidden items-center gap-1.5 rounded-full border border-brand/30 bg-brand-light px-3 py-1 text-xs font-medium text-brand-dark hover:bg-brand/10 sm:inline-flex">
                    <CalendarCheck2 className="h-3.5 w-3.5" aria-hidden /> Draft meeting {formatDate(draft.meetingDate)} – Resume
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="hidden text-right sm:block">
                  <div className="text-sm font-medium">{user.name}</div>
                  <div className="text-xs text-muted">{user.role === "ADMIN" ? "Administrator" : user.role === "EDITOR" ? (user.canOrganizeMeetings ? "Editor · Meeting organizer" : "Editor") : "Viewer"}</div>
                </div>
                <UserCircle2 className="h-8 w-8 text-muted" aria-hidden />
                <button onClick={logout} className="rounded-md p-2 text-muted hover:bg-navy-50 hover:text-navy" title="Sign out" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
              </div>
            </header>
            <nav className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 md:hidden" aria-label="Main (mobile)">
              {NAV.filter((n) => permissions.includes(n.perm)).map((n) => (
                <Link key={n.href} href={n.href} className={cx("whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium", isActive(n.href) ? "bg-brand-light text-brand-dark" : "text-navy")}>{n.label}</Link>
              ))}
            </nav>
            <main id="main" className={cx("min-w-0 flex-1", inMeeting ? "p-4" : "p-6 lg:p-8")}>{children}</main>
          </div>
        </div>
      </ToastProvider>
    </AuthProvider>
  );
}
