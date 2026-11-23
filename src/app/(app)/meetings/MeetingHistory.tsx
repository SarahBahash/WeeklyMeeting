"use client";
import Link from "next/link";
import { useState } from "react";
import { History } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/dates";
import { useLoad, useMeta } from "@/components/hooks";
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner } from "@/components/ui";

interface Row { id: string; meetingDate: string; status: string; organizer: string; attendees: string | null; agendaItems: number; reviewed: number; updates: number; newActions: number; revisions: number; finalizedAt: string | null }

export function MeetingHistory() {
  const { meta } = useMeta();
  const [f, setF] = useState({ from: "", to: "", projectId: "", activityTypeId: "", owner: "", q: "" });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const { data, error, loading } = useLoad<{ meetings: Row[] }>(`/api/meetings?${qs}`);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <div>
      <PageHeader title="Meeting History" description="Every Sunday meeting with its agenda snapshot, recorded updates and final summary." />
      <Card className="mb-4 p-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <label className="text-xs text-muted">From<input type="date" className="input mt-1" value={f.from} onChange={(e) => set("from", e.target.value)} /></label>
          <label className="text-xs text-muted">To<input type="date" className="input mt-1" value={f.to} onChange={(e) => set("to", e.target.value)} /></label>
          <label className="text-xs text-muted">Project<select className="input mt-1" value={f.projectId} onChange={(e) => set("projectId", e.target.value)}><option value="">All</option>{meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="text-xs text-muted">Activity type<select className="input mt-1" value={f.activityTypeId} onChange={(e) => set("activityTypeId", e.target.value)}><option value="">All</option>{meta?.activityTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}<option value="none">Unclassified</option></select></label>
          <label className="text-xs text-muted">Process owner<select className="input mt-1" value={f.owner} onChange={(e) => set("owner", e.target.value)}><option value="">All</option>{meta?.owners.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
          <label className="text-xs text-muted">Action point<input className="input mt-1" placeholder="Search title…" value={f.q} onChange={(e) => set("q", e.target.value)} /></label>
        </div>
      </Card>
      {error && <Alert>{error}</Alert>}
      {loading && !data && <Spinner />}
      {data && (data.meetings.length === 0 ? (
        <Card><EmptyState title="No meetings found" icon={<History className="h-8 w-8" />}>Meetings appear here once started from the Sunday Meeting page.</EmptyState></Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead><tr><th className="th">Meeting Date</th><th className="th">Status</th><th className="th">Organizer</th><th className="th">Reviewed</th><th className="th">Updates</th><th className="th">New Actions</th><th className="th">Finalized</th></tr></thead>
              <tbody>
                {data.meetings.map((m) => (
                  <tr key={m.id} className="hover:bg-navy-50/60">
                    <td className="td"><Link href={m.status === "DRAFT" ? `/meetings/${m.id}/run` : `/meetings/${m.id}`} className="font-medium text-navy hover:text-brand hover:underline">{formatDate(m.meetingDate)}</Link></td>
                    <td className="td">{m.status === "DRAFT" ? <Badge tone="amber">Draft</Badge> : <Badge tone="green">Finalized</Badge>}{m.revisions > 0 && <span className="ml-1"><Badge>{m.revisions} revision(s)</Badge></span>}</td>
                    <td className="td">{m.organizer}</td>
                    <td className="td tabular-nums">{m.reviewed} / {m.agendaItems}</td>
                    <td className="td tabular-nums">{m.updates}</td>
                    <td className="td tabular-nums">{m.newActions}</td>
                    <td className="td text-xs text-muted">{m.finalizedAt ? formatDateTime(m.finalizedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
