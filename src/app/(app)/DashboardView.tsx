"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarCheck2, CheckCircle2, CircleDot, Clock, Layers, Lock, PauseCircle } from "lucide-react";
import { api } from "@/lib/client";
import { formatDate } from "@/lib/dates";
import { useAuth } from "@/components/auth-context";
import { useMeta } from "@/components/hooks";
import { ActionPointTable, EMPTY_FILTERS, type Filters } from "@/components/ActionPointTable";
import { Alert, Button, PageHeader, cx } from "@/components/ui";

interface Summary { today: string; total: number; inProgress: number; completed: number; closed: number; onHold: number; notStarted: number; overdue: number; dueSoon: number; unclassified: number }

export function DashboardView() {
  const { can } = useAuth();
  const { meta, reload: reloadMeta } = useMeta();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const loadSummary = useCallback(() => api<Summary>("/api/dashboard").then(setSummary).catch((e) => setError(e.message)), []);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  const cards: { key: string; label: string; value?: number; icon: typeof Layers; tone: string; apply: Filters }[] = [
    { key: "total", label: "Total Action Points", value: summary?.total, icon: Layers, tone: "text-navy", apply: EMPTY_FILTERS },
    { key: "ip", label: "In Progress", value: summary?.inProgress, icon: CircleDot, tone: "text-brand", apply: { ...EMPTY_FILTERS, status: ["IN_PROGRESS"] } },
    { key: "c", label: "Completed", value: summary?.completed, icon: CheckCircle2, tone: "text-navy", apply: { ...EMPTY_FILTERS, status: ["COMPLETED"] } },
    { key: "cl", label: "Closed", value: summary?.closed, icon: Lock, tone: "text-muted", apply: { ...EMPTY_FILTERS, status: ["CLOSED"] } },
    { key: "oh", label: "On Hold", value: summary?.onHold, icon: PauseCircle, tone: "text-warn", apply: { ...EMPTY_FILTERS, status: ["ON_HOLD"] } },
    { key: "od", label: "Overdue", value: summary?.overdue, icon: AlertTriangle, tone: "text-danger", apply: { ...EMPTY_FILTERS, overdue: true } },
    { key: "ds", label: "Due Soon (7 days)", value: summary?.dueSoon, icon: Clock, tone: "text-warn", apply: { ...EMPTY_FILTERS, dueSoon: true } },
  ];
  const isActive = (c: (typeof cards)[number]) => JSON.stringify(c.apply) === JSON.stringify(filters);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={summary ? `Current position of Internal Audit action points · ${formatDate(summary.today)} (Asia/Riyadh)` : "Current position of Internal Audit action points"}
        actions={can("meeting:read") && (
          <Link href={meta?.draftMeeting ? `/meetings/${meta.draftMeeting.id}/run` : "/meeting"}>
            <Button variant="primary" size="lg" icon={<CalendarCheck2 className="h-5 w-5" />}>{meta?.draftMeeting ? "Resume Sunday Meeting" : "Start Sunday Meeting"}</Button>
          </Link>
        )}
      />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {cards.map((c) => (
          <button key={c.key} onClick={() => setFilters(c.apply)} aria-pressed={isActive(c)}
            className={cx("card p-4 text-left shadow-card transition hover:border-brand/40", isActive(c) && "border-brand ring-1 ring-brand")}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">{c.label}</span>
              <c.icon className={cx("h-4 w-4", c.tone)} aria-hidden />
            </div>
            <div className={cx("mt-2 text-3xl font-semibold tabular-nums", c.tone)}>{c.value ?? "–"}</div>
          </button>
        ))}
      </div>
      {summary && summary.unclassified > 0 && can("admin:classify") && (
        <div className="mb-4">
          <Alert tone="info">
            {summary.unclassified} action point(s) have no activity type yet.{" "}
            <button className="link font-medium" onClick={() => setFilters({ ...EMPTY_FILTERS, activityTypeId: "none" })}>Show unclassified items</button> and classify them with the Edit form.
          </Alert>
        </div>
      )}
      <ActionPointTable meta={meta} filters={filters} setFilters={setFilters} onChanged={() => { loadSummary(); reloadMeta(); }} />
    </div>
  );
}
