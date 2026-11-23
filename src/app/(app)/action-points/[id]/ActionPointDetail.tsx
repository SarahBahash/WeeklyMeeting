"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CalendarClock, FileClock, History, Lock, MessageSquareText, Pencil } from "lucide-react";
import type { ActionPointDTO } from "@/lib/services/action-points";
import { formatDate, formatDateTime } from "@/lib/dates";
import { useAuth } from "@/components/auth-context";
import { useLoad, useMeta } from "@/components/hooks";
import { ActionPointForm } from "@/components/ActionPointForm";
import { DateText } from "@/components/DeadlineCell";
import { Alert, Badge, Button, Card, EmptyState, PriorityBadge, Spinner, StatusBadge, Tabs } from "@/components/ui";
import { useToast } from "@/components/toast";

interface HistoryData {
  changes: { id: string; changeGroupId: string; field: string; oldValue: string | null; newValue: string | null; source: string; changedBy: string; changedAt: string; meeting: { id: string; meetingDate: string } | null }[];
  deadlines: { id: string; kind: string; previousDate: string | null; previousText: string | null; newDate: string | null; newText: string | null; reason: string | null; changedBy: string; changedAt: string; meeting: { id: string; meetingDate: string } | null }[];
  meetingUpdates: { id: string; feedback: string | null; nextAction: string | null; blocker: string | null; createdBy: string; createdAt: string; meeting: { id: string; meetingDate: string; status: string } }[];
  legacy: { id: string; sourceSheet: string; sourceRow: number; meetingDateRaw: string | null; statusRaw: string | null; feedback: string | null; decision: string }[];
  meetings: { id: string; meetingDate: string; status: string; reviewState: string }[];
}

const FIELD: Record<string, string> = {
  record: "Record", title: "Title", activityType: "Activity Type", project: "Related Project", projectStage: "Project Stage", currentStage: "Current Stage",
  ownerName: "Process Owner", originalTargetDate: "Original Target Date", revisedTargetDate: "Revised Target Date", revisedTargetText: "Revised Date (text)",
  priority: "Priority", status: "Status", feedback: "Feedback", nextAction: "Next Action", blocker: "Notes / Blocker", restricted: "Restricted", historicalRecord: "Historical record",
};
const SOURCE: Record<string, string> = { IMPORT: "Import", FORM: "Edit form", QUICK_EDIT: "Quick edit", MEETING: "Meeting", ADMIN_CORRECTION: "Admin correction", HISTORICAL_MERGE: "Historical tracker" };

export function ActionPointDetail({ id }: { id: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const { meta } = useMeta();
  const ap = useLoad<{ actionPoint: ActionPointDTO }>(`/api/action-points/${id}`);
  const hist = useLoad<HistoryData>(`/api/action-points/${id}/history`);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<"timeline" | "deadlines" | "meetings">("timeline");

  if (ap.loading && !ap.data) return <Spinner />;
  if (ap.error) return <Alert>{ap.error === "Action point not found" ? "This action point does not exist or you do not have access to it." : ap.error}</Alert>;
  if (!ap.data) return null;
  const a = ap.data.actionPoint;

  // Group field changes saved together.
  const groups: HistoryData["changes"][] = [];
  for (const c of hist.data?.changes ?? []) {
    const g = groups.at(-1);
    if (g && g[0].changeGroupId === c.changeGroupId) g.push(c);
    else groups.push([c]);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/action-points" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-navy"><ArrowLeft className="h-4 w-4" /> All action points</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            {a.activityType ? <Badge tone="navy">{a.activityType.name}</Badge> : <Badge>Unclassified</Badge>}
            {a.restricted && <Badge tone="amber"><Lock className="h-3 w-3" /> Restricted</Badge>}
            {a.deadline.isOverdue && <Badge tone="red">Overdue {a.deadline.overdueDays} day(s)</Badge>}
            {a.deadline.isDueSoon && <Badge tone="amber">Due soon</Badge>}
          </div>
          <h1 className="text-2xl font-semibold">{a.title}</h1>
          {a.legacySn && <p className="mt-1 text-xs text-muted">Legacy SN {a.legacySn}</p>}
        </div>
        {can("actionPoint:write") && <Button variant="primary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>Edit</Button>}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm md:grid-cols-3">
            <Item label="Process Owner">{a.ownerName ?? "—"}</Item>
            <Item label="Priority"><PriorityBadge priority={a.priority} /></Item>
            <Item label="Related Project">{a.project ? <Link className="link" href={`/audits/${a.project.id}`}>{a.project.name}</Link> : "—"}</Item>
            {(a.activityType?.supportsStages ?? true) && <Item label="Current Stage">{a.currentStage ?? a.projectStage?.name ?? <span className="text-muted">Not applicable / blank</span>}</Item>}
            <Item label="Original Target Date"><DateText date={a.originalTargetDate} text={a.originalTargetText} /></Item>
            <Item label="Revised Target Date"><DateText date={a.revisedTargetDate} text={a.revisedTargetText} /></Item>
            <Item label="Effective Deadline">{a.deadline.effectiveDeadline ? formatDate(a.deadline.effectiveDeadline) : <span className="text-muted">No valid date</span>}</Item>
            <Item label="Deadline Extension">{a.deadline.extensionDays != null ? `${a.deadline.extensionDays} day(s)` : "—"}</Item>
            <Item label="Overdue">{a.deadline.overdueDays != null ? <span className="font-semibold text-danger">{a.deadline.overdueDays} day(s)</span> : "No"}</Item>
            <Item label="Created">{formatDateTime(a.createdAt)}{a.createdBy ? ` · ${a.createdBy}` : ""}</Item>
            <Item label="Last Updated">{formatDateTime(a.updatedAt)}{a.updatedBy ? ` · ${a.updatedBy}` : ""}</Item>
          </dl>
          <div className="mt-6 border-t border-line pt-4">
            <h3 className="label">Latest Feedback</h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{a.feedback || <span className="text-muted">No feedback recorded.</span>}</p>
          </div>
          {(a.nextAction || a.blocker) && (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {a.nextAction && <div><h3 className="label">Next Action</h3><p className="text-sm">{a.nextAction}</p></div>}
              {a.blocker && <div><h3 className="label">Notes / Blocker</h3><p className="text-sm">{a.blocker}</p></div>}
            </div>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="label">Original imported values</h3>
          {a.sourceSheet ? (
            <dl className="space-y-2 text-sm">
              <Item label="Source">{a.sourceSheet}, row {a.sourceRow}</Item>
              <Item label="Original Status">{a.sourceStatus ? <code className="rounded bg-navy-50 px-1">&quot;{a.sourceStatus}&quot;</code> : "(blank)"}</Item>
              <Item label="Original Delays">{a.sourceDelays ?? "(blank)"}</Item>
              {a.sourcePriority && <Item label="Original Priority">{a.sourcePriority}</Item>}
            </dl>
          ) : <p className="text-sm text-muted">Created in the website{a.createdInMeetingId ? " during a Sunday meeting" : ""}.</p>}
          <h3 className="label mt-5">Meetings</h3>
          {hist.data?.meetings.length ? (
            <ul className="space-y-1 text-sm">
              {hist.data.meetings.map((m) => (
                <li key={m.id}><Link className="link" href={`/meetings/${m.id}`}>{formatDate(m.meetingDate)}</Link> <span className="text-xs text-muted">· {m.reviewState.toLowerCase()}{m.status === "DRAFT" ? " · draft" : ""}</span></li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Not yet discussed in a meeting.</p>}
        </Card>
      </div>

      <div className="mt-8">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "timeline", label: "Change history" }, { id: "deadlines", label: "Deadline history" }, { id: "meetings", label: "Meeting updates" }]} />
        {hist.loading && !hist.data && <Spinner />}
        {hist.error && <Alert>{hist.error}</Alert>}
        {hist.data && tab === "timeline" && (
          groups.length ? (
            <ol className="relative space-y-4 border-l border-line pl-6">
              {groups.map((g) => (
                <li key={g[0].changeGroupId} className="relative">
                  <span className="absolute -left-[31px] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-brand" aria-hidden />
                  <div className="text-xs text-muted">
                    {formatDateTime(g[0].changedAt)} · <span className="font-medium text-navy">{g[0].changedBy}</span> · {SOURCE[g[0].source] ?? g[0].source}
                    {g[0].meeting && <> · <Link className="link" href={`/meetings/${g[0].meeting.id}`}>Meeting {formatDate(g[0].meeting.meetingDate)}</Link></>}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {g.map((c) => (
                      <div key={c.id} className="text-sm">
                        <span className="font-medium">{FIELD[c.field] ?? c.field}: </span>
                        {c.field === "record" || c.field === "historicalRecord" ? <span>{c.newValue}</span> : (
                          <>
                            <span className="text-muted line-through decoration-muted/50">{c.oldValue || "(blank)"}</span>
                            <span className="mx-1.5 text-muted">→</span>
                            <span className="whitespace-pre-wrap">{c.newValue || "(blank)"}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          ) : <EmptyState title="No changes recorded yet" icon={<History className="h-8 w-8" />} />
        )}
        {hist.data && tab === "deadlines" && (
          <Card>
            <div className="border-b border-line p-4 text-sm">
              <strong>Original Target Date:</strong> <DateText date={a.originalTargetDate} text={a.originalTargetText} />
              <span className="mx-3 text-line">|</span>
              <strong>Current Revised Date:</strong> <DateText date={a.revisedTargetDate} text={a.revisedTargetText} />
            </div>
            {hist.data.deadlines.length ? (
              <table className="w-full">
                <thead><tr><th className="th">Change Date</th><th className="th">Type</th><th className="th">Previous Deadline</th><th className="th">New Deadline</th><th className="th">Changed By</th><th className="th">Reason</th><th className="th">Meeting</th></tr></thead>
                <tbody>
                  {hist.data.deadlines.map((d) => (
                    <tr key={d.id}>
                      <td className="td whitespace-nowrap">{formatDateTime(d.changedAt)}</td>
                      <td className="td">{d.kind === "REVISION" ? "Revision" : <Badge tone="amber">Original date correction</Badge>}</td>
                      <td className="td"><DateText date={d.previousDate} text={d.previousText} /></td>
                      <td className="td"><DateText date={d.newDate} text={d.newText} /></td>
                      <td className="td">{d.changedBy}</td>
                      <td className="td text-muted">{d.reason ?? "—"}</td>
                      <td className="td">{d.meeting ? <Link className="link" href={`/meetings/${d.meeting.id}`}>{formatDate(d.meeting.meetingDate)}</Link> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyState title="No deadline changes" icon={<CalendarClock className="h-8 w-8" />}>The deadline has not been revised.</EmptyState>}
          </Card>
        )}
        {hist.data && tab === "meetings" && (
          hist.data.meetingUpdates.length || hist.data.legacy.length ? (
            <div className="space-y-3">
              {hist.data.meetingUpdates.map((u) => (
                <Card key={u.id} className="p-4">
                  <div className="text-xs text-muted"><Link className="link font-medium" href={`/meetings/${u.meeting.id}`}>Meeting {formatDate(u.meeting.meetingDate)}</Link> · {u.createdBy} · {formatDateTime(u.createdAt)}</div>
                  {u.feedback && <p className="mt-2 whitespace-pre-wrap text-sm">{u.feedback}</p>}
                  {u.nextAction && <p className="mt-1 text-sm"><span className="font-medium">Next action:</span> {u.nextAction}</p>}
                  {u.blocker && <p className="mt-1 text-sm"><span className="font-medium">Blocker:</span> {u.blocker}</p>}
                  {!u.feedback && !u.nextAction && !u.blocker && <p className="mt-2 text-sm text-muted">Field changes only (see change history).</p>}
                </Card>
              ))}
              {hist.data.legacy.map((l) => (
                <Card key={l.id} className="p-4">
                  <div className="text-xs text-muted"><FileClock className="mr-1 inline h-3.5 w-3.5" />Historical tracker · {l.sourceSheet} row {l.sourceRow}{l.meetingDateRaw ? ` · meeting ${l.meetingDateRaw}` : ""}{l.statusRaw ? ` · ${l.statusRaw}` : ""}</div>
                  {l.feedback && <p className="mt-2 text-sm">{l.feedback}</p>}
                </Card>
              ))}
            </div>
          ) : <EmptyState title="No meeting updates yet" icon={<MessageSquareText className="h-8 w-8" />} />
        )}
      </div>

      <ActionPointForm open={editing} meta={meta} initial={a} onClose={() => setEditing(false)} onSaved={(dto) => {
        setEditing(false);
        ap.setData({ actionPoint: dto });
        hist.reload();
        toast("success", "Action point updated");
      }} />
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
