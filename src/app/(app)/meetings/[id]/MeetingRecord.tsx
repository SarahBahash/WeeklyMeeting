"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, FilePenLine, PlayCircle } from "lucide-react";
import type { MeetingDetail, MeetingSummary, RevisionChange } from "@/lib/services/meetings";
import { STATUS_LABEL } from "@/lib/domain";
import { formatDate, formatDateTime } from "@/lib/dates";
import { api, download } from "@/lib/client";
import { useLoad } from "@/components/hooks";
import { useToast } from "@/components/toast";
import { Alert, Badge, Button, Card, Field, Modal, Spinner, StatusBadge, Tabs } from "@/components/ui";

export function MeetingRecord({ id }: { id: string }) {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad<MeetingDetail>(`/api/meetings/${id}`);
  const [tab, setTab] = useState<"summary" | "agenda" | "updates" | "revisions">("summary");
  const [exporting, setExporting] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const { meeting, agenda } = data;

  // Apply revisions for display (originals stay intact in the database).
  const corrected = new Map<string, string | null>();
  let attendees = meeting.attendees, notes = meeting.notes;
  for (const r of meeting.revisions) for (const c of r.changes as RevisionChange[]) {
    if (c.meetingUpdateId) corrected.set(c.meetingUpdateId, c.newValue);
    else if (c.field === "attendees") attendees = c.newValue;
    else if (c.field === "notes") notes = c.newValue;
  }
  const s = meeting.summary;

  async function exportIt() {
    setExporting(true);
    try { toast("success", `Downloaded ${await download("/api/exports", { type: "MEETING", meetingId: id })}`); }
    catch (e) { toast("error", (e as Error).message); }
    finally { setExporting(false); }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/meetings" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-navy"><ArrowLeft className="h-4 w-4" /> Meeting history</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex gap-2">{meeting.status === "DRAFT" ? <Badge tone="amber">Draft – in progress</Badge> : <Badge tone="green">Finalized {formatDateTime(meeting.finalizedAt)}</Badge>}{meeting.revisions.length > 0 && <Badge>Corrected · {meeting.revisions.length} revision(s)</Badge>}</div>
          <h1 className="text-2xl font-semibold">Sunday Meeting – {formatDate(meeting.meetingDate)}</h1>
          <p className="mt-1 text-sm text-muted">Organizer {meeting.organizer.name}{attendees ? ` · Attendees: ${attendees}` : ""}</p>
          {notes && <p className="mt-1 text-sm text-muted">Notes: {notes}</p>}
        </div>
        <div className="flex gap-2">
          {meeting.status === "DRAFT" && <Link href={`/meetings/${id}/run`}><Button variant="primary" icon={<PlayCircle className="h-4 w-4" />}>Resume meeting</Button></Link>}
          {data.permissions.canCorrect && <Button icon={<FilePenLine className="h-4 w-4" />} onClick={() => setCorrecting(true)}>Record correction</Button>}
          {data.permissions.canExport && <Button icon={<Download className="h-4 w-4" />} loading={exporting} onClick={exportIt}>Export to Excel</Button>}
        </div>
      </div>
      {meeting.hiddenItems > 0 && <div className="mb-4"><Alert tone="info">{meeting.hiddenItems} restricted agenda item(s) are hidden for your role.</Alert></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "summary", label: "Final summary" }, { id: "agenda", label: `Agenda (${agenda.length})` }, { id: "updates", label: "Updates recorded" }, { id: "revisions", label: `Revisions (${meeting.revisions.length})` }]} />
      {tab === "summary" && (s ? <SummaryView s={s} /> : <Alert tone="info">The summary is generated when the organizer finishes the meeting.</Alert>)}
      {tab === "agenda" && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead><tr><th className="th">#</th><th className="th">Action point</th><th className="th">Owner</th><th className="th">Status at start</th><th className="th">Status after</th><th className="th">Review</th></tr></thead>
              <tbody>
                {agenda.map((a) => {
                  const after = a.finalSnapshot ?? (meeting.status === "DRAFT" ? null : a.snapshot);
                  return (
                    <tr key={a.id}>
                      <td className="td text-muted">{a.position}</td>
                      <td className="td"><Link className="font-medium hover:text-brand hover:underline" href={`/action-points/${a.current.id}`}>{a.snapshot.title}</Link>{a.isNewAction && <span className="ml-2"><Badge tone="green">New</Badge></span>}</td>
                      <td className="td text-sm">{a.snapshot.ownerName ?? "—"}</td>
                      <td className="td"><StatusBadge status={a.snapshot.status} /></td>
                      <td className="td">{after ? <StatusBadge status={after.status} /> : <span className="text-xs text-muted">Pending</span>}</td>
                      <td className="td text-sm">{a.reviewState === "REVIEWED" ? <Badge tone="green">Reviewed</Badge> : a.reviewState === "SKIPPED" ? <Badge tone="amber">Skipped</Badge> : <Badge>Not reviewed</Badge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {tab === "updates" && (
        <div className="space-y-3">
          {agenda.flatMap((a) => a.updates.map((u) => ({ a, u }))).sort((x, y) => x.u.createdAt.localeCompare(y.u.createdAt)).map(({ a, u }) => (
            <Card key={u.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-medium text-navy">{a.snapshot.title}</span> · {u.createdBy} · {formatDateTime(u.createdAt)}
                {corrected.has(u.id) && <Badge tone="amber">Corrected</Badge>}
              </div>
              {(corrected.has(u.id) ? corrected.get(u.id) : u.feedback) && <p className="mt-2 whitespace-pre-wrap text-sm">{corrected.has(u.id) ? corrected.get(u.id) : u.feedback}</p>}
              {corrected.has(u.id) && <p className="mt-1 text-xs text-muted">Originally recorded: <span className="line-through">{u.feedback ?? "(blank)"}</span></p>}
              <ul className="mt-2 space-y-0.5 text-xs">
                {u.changes.filter((c) => c.field !== "feedback").map((c) => <li key={c.field}><span className="font-medium">{c.label}:</span> {c.oldValue || "(blank)"} → {c.newValue || "(blank)"}</li>)}
              </ul>
            </Card>
          ))}
          {agenda.every((a) => a.updates.length === 0) && <Alert tone="info">No updates were recorded in this meeting.</Alert>}
        </div>
      )}
      {tab === "revisions" && (
        meeting.revisions.length ? (
          <div className="space-y-3">
            {meeting.revisions.map((r) => (
              <Card key={r.id} className="p-4 text-sm">
                <div className="text-xs text-muted">Revision {r.revisionNumber} · {r.createdBy} · {formatDateTime(r.createdAt)}</div>
                <p className="mt-1 font-medium">{r.reason}</p>
                <ul className="mt-2 space-y-1 text-xs">{(r.changes as RevisionChange[]).map((c, i) => <li key={i}><span className="font-medium">{c.meetingUpdateId ? "Update feedback" : c.field}:</span> <span className="line-through text-muted">{c.oldValue ?? "(blank)"}</span> → {c.newValue ?? "(blank)"}</li>)}</ul>
              </Card>
            ))}
          </div>
        ) : <Alert tone="info">No corrections have been recorded. The original meeting record is unchanged.</Alert>
      )}
      {correcting && <CorrectionDialog data={data} attendees={attendees} notes={notes} corrected={corrected} onClose={() => setCorrecting(false)} onSaved={() => { setCorrecting(false); reload(); toast("success", "Correction recorded as a new revision"); }} />}
    </div>
  );
}

function SummaryView({ s }: { s: MeetingSummary }) {
  const t = s.totals;
  const List = ({ title, items }: { title: string; items: { key: string; text: React.ReactNode }[] }) => (
    <Card className="p-4">
      <h3 className="mb-2 text-sm font-semibold">{title} <span className="font-normal text-muted">({items.length})</span></h3>
      {items.length ? <ul className="space-y-1.5 text-sm">{items.map((i) => <li key={i.key}>{i.text}</li>)}</ul> : <p className="text-sm text-muted">None</p>}
    </Card>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {[["Items reviewed", `${t.reviewed} / ${t.agendaItems}`], ["Completed", t.completed], ["Remaining In Progress", t.remainingInProgress], ["On Hold", t.onHold], ["Overdue", t.overdue], ["Unreviewed", t.unreviewed]].map(([l, v]) => (
          <Card key={l as string} className="p-4"><div className="text-xs text-muted">{l}</div><div className="mt-1 text-2xl font-semibold">{v}</div></Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <List title="Completed items" items={s.completedItems.map((i) => ({ key: i.actionPointId, text: <><span className="font-medium">{i.title}</span> <span className="text-muted">· {i.ownerName ?? "—"} · {STATUS_LABEL[i.status]}</span></> }))} />
        <List title="Revised deadlines" items={s.revisedDeadlines.map((r, n) => ({ key: r.actionPointId + n, text: <><span className="font-medium">{r.title}</span>: {r.previous ? formatDate(r.previous) || r.previous : "—"} → {r.next ? formatDate(r.next) || r.next : "—"}{r.reason && <span className="text-muted"> ({r.reason})</span>}</> }))} />
        <List title="Overdue items" items={s.overdueItems.map((i) => ({ key: i.actionPointId, text: <><span className="font-medium">{i.title}</span> <span className="text-danger">· {i.overdueDays} day(s)</span></> }))} />
        <List title="On Hold items" items={s.onHoldItems.map((i) => ({ key: i.actionPointId, text: <span className="font-medium">{i.title}</span> }))} />
        <List title="Newly created action points" items={s.newActions.map((i) => ({ key: i.actionPointId, text: <><span className="font-medium">{i.title}</span> <span className="text-muted">· {i.ownerName ?? "—"}</span></> }))} />
        <List title="Pending follow-up actions" items={s.followUps.map((f) => ({ key: f.actionPointId, text: <><span className="font-medium">{f.title}</span>: {f.nextAction}</> }))} />
        <List title="Remaining In Progress" items={s.remainingInProgress.map((i) => ({ key: i.actionPointId, text: <><span className="font-medium">{i.title}</span> <span className="text-muted">· {i.ownerName ?? "—"}</span></> }))} />
        <List title="Unreviewed items" items={s.unreviewedItems.map((i) => ({ key: i.actionPointId, text: <><span className="font-medium">{i.title}</span> <span className="text-muted">· {i.reviewState === "SKIPPED" ? "skipped" : "not reviewed"}</span></> }))} />
      </div>
      <p className="text-xs text-muted">Summary generated {formatDateTime(s.generatedAt)} and stored permanently with the meeting.</p>
    </div>
  );
}

function CorrectionDialog({ data, attendees, notes, corrected, onClose, onSaved }: { data: MeetingDetail; attendees: string | null; notes: string | null; corrected: Map<string, string | null>; onClose: () => void; onSaved: () => void }) {
  const updates = data.agenda.flatMap((a) => a.updates.map((u) => ({ a, u })));
  const [reason, setReason] = useState("");
  const [att, setAtt] = useState(attendees ?? "");
  const [nts, setNts] = useState(notes ?? "");
  const [fb, setFb] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setFb(Object.fromEntries(updates.map(({ u }) => [u.id, (corrected.has(u.id) ? corrected.get(u.id) : u.feedback) ?? ""])));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/meetings/${data.meeting.id}/revisions`, { body: { reason, attendees: att, notes: nts, updateCorrections: Object.entries(fb).map(([meetingUpdateId, feedback]) => ({ meetingUpdateId, feedback })) } });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title="Record a correction" size="lg" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={reason.trim().length < 5} onClick={save}>Save as new revision</Button></>}>
      <Alert tone="info">The original meeting record is never rewritten. Your correction is stored as a new revision with your name, the time and the reason.</Alert>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      <div className="mt-4 space-y-3">
        <Field label="Reason for correction *" htmlFor="c-reason"><input id="c-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
        <Field label="Attendees" htmlFor="c-att"><input id="c-att" className="input" value={att} onChange={(e) => setAtt(e.target.value)} /></Field>
        <Field label="Notes" htmlFor="c-notes"><input id="c-notes" className="input" value={nts} onChange={(e) => setNts(e.target.value)} /></Field>
        {updates.length > 0 && <h3 className="label pt-2">Recorded feedback</h3>}
        {updates.map(({ a, u }) => (
          <Field key={u.id} label={a.snapshot.title} htmlFor={`c-${u.id}`}>
            <textarea id={`c-${u.id}`} className="input min-h-[60px]" value={fb[u.id] ?? ""} onChange={(e) => setFb((f) => ({ ...f, [u.id]: e.target.value }))} />
          </Field>
        ))}
      </div>
    </Modal>
  );
}
