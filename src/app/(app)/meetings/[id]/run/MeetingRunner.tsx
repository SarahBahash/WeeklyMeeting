"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDown, ArrowUp, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleDashed, Download, FlagTriangleRight,
  ListPlus, Plus, Save, SkipForward, Users,
} from "lucide-react";
import type { MeetingDetail, MeetingSummary } from "@/lib/services/meetings";
import type { ActionPointDTO } from "@/lib/services/action-points";
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, type Status } from "@/lib/domain";
import { formatDate, formatDateTime } from "@/lib/dates";
import { api, ApiClientError, download } from "@/lib/client";
import { useMeta, useUnsavedWarning } from "@/components/hooks";
import { useToast } from "@/components/toast";
import { ActionPointForm } from "@/components/ActionPointForm";
import { ConflictDialog } from "@/components/ConflictDialog";
import { DateText } from "@/components/DeadlineCell";
import { Alert, Badge, Button, Field, Modal, PriorityBadge, Spinner, StatusBadge, cx } from "@/components/ui";

type AgendaItem = MeetingDetail["agenda"][number];

interface Draft {
  feedback: string;
  status: Status;
  currentStage: string;
  ownerName: string;
  priority: string;
  revisedTargetDate: string;
  deadlineReason: string;
  nextAction: string;
  blocker: string;
}

const draftFrom = (a: ActionPointDTO): Draft => ({
  feedback: "",
  status: a.status,
  currentStage: a.currentStage ?? "",
  ownerName: a.ownerName ?? "",
  priority: a.priority ?? "",
  revisedTargetDate: a.revisedTargetDate ?? "",
  deadlineReason: "",
  nextAction: a.nextAction ?? "",
  blocker: a.blocker ?? "",
});

function changedFields(a: ActionPointDTO, d: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (d.feedback.trim()) out.feedback = d.feedback.trim();
  if (d.status !== a.status) out.status = d.status;
  if ((a.activityType?.supportsStages ?? true) && d.currentStage.trim() !== (a.currentStage ?? "")) out.currentStage = d.currentStage.trim() || null;
  if (d.ownerName.trim() !== (a.ownerName ?? "")) out.ownerName = d.ownerName.trim() || null;
  if (d.priority !== (a.priority ?? "")) out.priority = d.priority || null;
  if (d.revisedTargetDate !== (a.revisedTargetDate ?? "")) out.revisedTargetDate = d.revisedTargetDate || null;
  if (d.nextAction.trim() !== (a.nextAction ?? "")) out.nextAction = d.nextAction.trim() || null;
  if (d.blocker.trim() !== (a.blocker ?? "")) out.blocker = d.blocker.trim() || null;
  if (Object.keys(out).length && d.deadlineReason.trim()) out.deadlineReason = d.deadlineReason.trim();
  return out;
}

export function MeetingRunner({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { meta, reload: reloadMeta } = useMeta();
  const [data, setData] = useState<MeetingDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ itemId: string; current: ActionPointDTO; mine: Record<string, unknown>; markReviewed: boolean; advance: boolean } | null>(null);
  const [addingAction, setAddingAction] = useState(false);
  const [addingExisting, setAddingExisting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<MeetingDetail>(`/api/meetings/${id}`);
      if (d.meeting.status === "FINALIZED") { router.replace(`/meetings/${id}`); return; }
      setData(d);
      setSelected((s) => s ?? d.agenda.find((a) => a.reviewState === "PENDING")?.id ?? d.agenda[0]?.id ?? null);
      return d;
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [id, router]);
  useEffect(() => { load(); }, [load]);

  const agenda = data?.agenda ?? [];
  const idx = agenda.findIndex((a) => a.id === selected);
  const item = idx >= 0 ? agenda[idx] : null;
  const draft = item ? drafts[item.id] ?? draftFrom(item.current) : null;
  const dirtyIds = useMemo(() => agenda.filter((a) => drafts[a.id] && Object.keys(changedFields(a.current, drafts[a.id])).length > 0).map((a) => a.id), [agenda, drafts]);
  const isDirty = item ? dirtyIds.includes(item.id) : false;
  useUnsavedWarning(dirtyIds.length > 0);

  const canPart = data?.permissions.canParticipate ?? false;
  const canOrg = data?.permissions.canOrganize ?? false;

  const setDraft = (patch: Partial<Draft>) => {
    if (!item || !draft) return;
    setDrafts((d) => ({ ...d, [item.id]: { ...draft, ...patch } }));
  };
  const go = (i: number) => { if (agenda[i]) { setSelected(agenda[i].id); setError(null); } };

  async function save(opts: { markReviewed: boolean; advance: boolean }, override?: { version: number; fields: Record<string, unknown> }) {
    if (!item || !draft) return;
    const fields = override?.fields ?? changedFields(item.current, draft);
    if (!opts.markReviewed && Object.keys(fields).length === 0) { toast("info", "Nothing new to save for this item."); return; }
    setBusy(opts.advance ? "next" : opts.markReviewed ? "reviewed" : "draft");
    setError(null);
    try {
      await api(`/api/meetings/${id}/items/${item.id}/save`, { body: { version: override?.version ?? item.current.version, fields, markReviewed: opts.markReviewed } });
      setDrafts((d) => { const n = { ...d }; delete n[item.id]; return n; });
      const fresh = await load();
      reloadMeta();
      toast("success", opts.markReviewed ? "Saved and marked as reviewed" : "Saved – the meeting stays a draft until you finish it");
      if (opts.advance && fresh) {
        const pos = fresh.agenda.findIndex((a) => a.id === item.id);
        if (fresh.agenda[pos + 1]) setSelected(fresh.agenda[pos + 1].id);
        else toast("info", "That was the last agenda item. Review any skipped items or finish the meeting.");
      }
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409 && e.data.conflict) {
        setConflict({ itemId: item.id, current: e.data.current as ActionPointDTO, mine: fields, ...opts });
      } else setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function setReview(state: "REVIEWED" | "SKIPPED" | "PENDING", advance: boolean) {
    if (!item) return;
    setBusy(state);
    setError(null);
    try {
      await api(`/api/meetings/${id}/items/${item.id}/review`, { body: { state } });
      const fresh = await load();
      if (advance && fresh) {
        const pos = fresh.agenda.findIndex((a) => a.id === item.id);
        if (fresh.agenda[pos + 1]) setSelected(fresh.agenda[pos + 1].id);
      }
      if (state === "SKIPPED") toast("info", "Skipped for now – it stays on the agenda as unreviewed.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function markReviewed() {
    if (isDirty) await save({ markReviewed: true, advance: false });
    else await setReview("REVIEWED", false);
  }

  async function move(itemId: string, dir: -1 | 1) {
    const order = agenda.map((a) => a.id);
    const i = order.indexOf(itemId);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setData((d) => d && { ...d, agenda: order.map((oid) => d.agenda.find((a) => a.id === oid)!) });
    try {
      await api(`/api/meetings/${id}/agenda`, { method: "PUT", body: { itemIds: order } });
    } catch (e) {
      toast("error", (e as Error).message);
      load();
    }
  }

  async function exportMeeting() {
    setBusy("export");
    try {
      const name = await download("/api/exports", { type: "MEETING", meetingId: id });
      toast("success", `Downloaded ${name}`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Keyboard: Ctrl/Cmd+Enter = Save & Next, Alt+←/→ = previous/next item.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canPart && !busy) { e.preventDefault(); save({ markReviewed: true, advance: true }); }
      if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); go(idx + 1); }
      if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); go(idx - 1); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (loadError) return <Alert>{loadError}</Alert>;
  if (!data) return <Spinner label="Loading meeting…" />;
  const { meeting, counts } = data;
  const pct = counts.total ? Math.round((counts.reviewed / counts.total) * 100) : 0;
  const a = item?.current;
  const supportsStages = a ? (a.activityType?.supportsStages ?? true) : false;

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col">
      {/* Meeting header + progress */}
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-line bg-white px-4 py-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Sunday Meeting · Draft</div>
          <div className="text-lg font-semibold">{formatDate(meeting.meetingDate)}</div>
        </div>
        <div className="text-sm text-muted">
          Organizer <span className="font-medium text-navy">{meeting.organizer.name}</span>
          {meeting.attendees && <span className="ml-2 hidden lg:inline">· <Users className="mb-0.5 inline h-3.5 w-3.5" /> {meeting.attendees.length > 60 ? meeting.attendees.slice(0, 60) + "…" : meeting.attendees}</span>}
          {canOrg && <button className="link ml-2 text-xs" onClick={() => setEditingDetails(true)}>Edit details</button>}
        </div>
        <div className="min-w-[260px] flex-1">
          <div className="flex justify-between text-sm">
            <span className="font-semibold" role="status">Reviewed: {counts.reviewed} of {counts.total} Action Points</span>
            <span className="text-xs text-muted">{counts.skipped} skipped · {counts.pending} pending</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-navy-50" role="progressbar" aria-valuenow={counts.reviewed} aria-valuemin={0} aria-valuemax={counts.total} aria-label="Meeting progress">
            <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canPart && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAddingAction(true)}>Add New Action</Button>}
          {data.permissions.canExport && <Button size="sm" icon={<Download className="h-4 w-4" />} loading={busy === "export"} onClick={exportMeeting}>Export Meeting to Excel</Button>}
          {canOrg && <Button size="sm" variant="primary" icon={<FlagTriangleRight className="h-4 w-4" />} onClick={() => setFinishing(true)}>Finish Meeting</Button>}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_400px]">
        {/* LEFT: Agenda */}
        <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white" aria-label="Meeting agenda">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
            <h2 className="text-sm font-semibold">Agenda <span className="font-normal text-muted">({counts.total})</span></h2>
            {canOrg && <button className="inline-flex items-center gap-1 text-xs text-brand hover:underline" onClick={() => setAddingExisting(true)}><ListPlus className="h-3.5 w-3.5" /> Add item</button>}
          </div>
          <ol className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {agenda.length === 0 && <li className="p-4 text-sm text-muted">No In Progress items were found when the meeting started. Use “Add item” or “Add New Action”.</li>}
            {agenda.map((ag, i) => {
              const active = ag.id === selected;
              const unsaved = dirtyIds.includes(ag.id);
              return (
                <li key={ag.id} className="group relative">
                  <button onClick={() => go(i)} aria-current={active ? "true" : undefined}
                    className={cx("flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left", active ? "bg-brand-light ring-1 ring-brand/40" : "hover:bg-navy-50")}>
                    <span className="mt-0.5 flex-none">
                      {ag.reviewState === "REVIEWED" ? <CheckCircle2 className="h-4 w-4 text-brand" aria-label="Reviewed" />
                        : ag.reviewState === "SKIPPED" ? <SkipForward className="h-4 w-4 text-warn" aria-label="Skipped" />
                        : <Circle className="h-4 w-4 text-line" aria-label="Pending" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" title={ag.current.title}>{i + 1}. {ag.current.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                        <span className="truncate">{ag.current.ownerName ?? "No owner"}</span>
                        <span aria-hidden>·</span>
                        <span className="whitespace-nowrap">{STATUS_LABEL[ag.current.status]}</span>
                        {ag.isNewAction && <Badge tone="green">New</Badge>}
                        {unsaved && <span className="h-2 w-2 flex-none rounded-full bg-warn" title="Unsaved changes" />}
                      </span>
                    </span>
                  </button>
                  {canOrg && (
                    <span className="absolute right-1 top-1 hidden flex-col group-focus-within:flex group-hover:flex">
                      <button className="rounded bg-white p-0.5 text-muted shadow hover:text-navy disabled:opacity-30" disabled={i === 0} onClick={() => move(ag.id, -1)} aria-label="Move up"><ArrowUp className="h-3 w-3" /></button>
                      <button className="mt-0.5 rounded bg-white p-0.5 text-muted shadow hover:text-navy disabled:opacity-30" disabled={i === agenda.length - 1} onClick={() => move(ag.id, 1)} aria-label="Move down"><ArrowDown className="h-3 w-3" /></button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
          <div className="flex gap-3 border-t border-line px-3 py-2 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-brand" /> Reviewed</span>
            <span className="inline-flex items-center gap-1"><SkipForward className="h-3 w-3 text-warn" /> Skipped</span>
            <span className="inline-flex items-center gap-1"><CircleDashed className="h-3 w-3" /> Pending</span>
          </div>
        </section>

        {/* CENTER: current item */}
        <section className="min-h-0 overflow-y-auto rounded-xl border border-line bg-white" aria-label="Current action point">
          {!item || !a ? <div className="p-8 text-center text-sm text-muted">Select an agenda item.</div> : (
            <div className="p-5">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>Item {idx + 1} of {agenda.length}</span>
                {item.reviewState === "REVIEWED" && <Badge tone="green"><Check className="h-3 w-3" /> Reviewed {item.reviewedAt ? formatDateTime(item.reviewedAt).split(", ")[1] : ""}</Badge>}
                {item.reviewState === "SKIPPED" && <Badge tone="amber">Skipped</Badge>}
                {item.addedDuringMeeting && <Badge>Added during meeting</Badge>}
                {item.snapshot.status !== a.status && <Badge tone="navy">Status at start: {STATUS_LABEL[item.snapshot.status]}</Badge>}
              </div>
              <h1 className="text-xl font-semibold leading-snug">{a.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={a.status} />
                {a.activityType ? <Badge tone="navy">{a.activityType.name}</Badge> : <Badge>Unclassified</Badge>}
                {a.project && <Badge>{a.project.name}</Badge>}
                {a.deadline.isOverdue && <Badge tone="red">Overdue {a.deadline.overdueDays}d</Badge>}
                {a.deadline.isDueSoon && <Badge tone="amber">Due soon</Badge>}
                <Link className="link ml-auto text-xs" href={`/action-points/${a.id}`} target="_blank">Full history ↗</Link>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 rounded-lg border border-line p-4 text-sm md:grid-cols-3">
                <Info label="Process Owner">{a.ownerName ?? "—"}</Info>
                <Info label="Priority"><PriorityBadge priority={a.priority} /></Info>
                {supportsStages && <Info label="Current Stage">{a.currentStage ?? a.projectStage?.name ?? <span className="text-muted">—</span>}</Info>}
                <Info label="Original Target Date"><DateText date={a.originalTargetDate} text={a.originalTargetText} /></Info>
                <Info label="Revised Target Date"><DateText date={a.revisedTargetDate} text={a.revisedTargetText} /></Info>
                <Info label="Effective Deadline">{a.deadline.effectiveDeadline ? formatDate(a.deadline.effectiveDeadline) : <span className="text-muted">No valid date</span>}</Info>
                <Info label="Last Updated">{formatDateTime(a.updatedAt)}{a.updatedBy ? ` · ${a.updatedBy}` : ""}</Info>
              </dl>
              <div className="mt-5">
                <h3 className="label">Current Feedback</h3>
                <p className="whitespace-pre-wrap rounded-lg bg-navy-50 p-3 text-sm leading-relaxed">{a.feedback || <span className="text-muted">No feedback recorded.</span>}</p>
              </div>
              {(a.nextAction || a.blocker) && (
                <div className="mt-3 grid gap-3 md:grid-cols-2 text-sm">
                  {a.nextAction && <div><h3 className="label">Next Action</h3><p>{a.nextAction}</p></div>}
                  {a.blocker && <div><h3 className="label">Notes / Blocker</h3><p>{a.blocker}</p></div>}
                </div>
              )}
              <div className="mt-5">
                <h3 className="label">Previous Saved Meeting Update</h3>
                {item.previousUpdate ? (
                  <div className="rounded-lg border border-line p-3 text-sm">
                    <div className="mb-1 text-xs text-muted">Meeting {formatDate(item.previousUpdate.meetingDate)} · {item.previousUpdate.createdBy}</div>
                    {item.previousUpdate.feedback && <p className="whitespace-pre-wrap">{item.previousUpdate.feedback}</p>}
                    {item.previousUpdate.changes.map((c) => <p key={c.field} className="text-xs"><span className="font-medium">{c.label}:</span> {c.oldValue || "(blank)"} → {c.newValue || "(blank)"}</p>)}
                    {item.previousUpdate.nextAction && <p className="mt-1"><span className="font-medium">Next action:</span> {item.previousUpdate.nextAction}</p>}
                  </div>
                ) : <p className="text-sm text-muted">No update from a previous meeting.</p>}
              </div>
              {item.updates.length > 0 && (
                <div className="mt-5">
                  <h3 className="label">Saved in this meeting</h3>
                  <ul className="space-y-2">
                    {item.updates.map((u) => (
                      <li key={u.id} className="rounded-lg border border-brand/30 bg-brand-light/50 p-3 text-sm">
                        <div className="mb-1 text-xs text-muted">{formatDateTime(u.createdAt)} · {u.createdBy}</div>
                        {u.feedback && <p className="whitespace-pre-wrap">{u.feedback}</p>}
                        {u.changes.filter((c) => !["feedback"].includes(c.field)).map((c) => (
                          <p key={c.field} className="text-xs"><span className="font-medium">{c.label}:</span> {c.oldValue || "(blank)"} → {c.newValue || "(blank)"}</p>
                        ))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>

        {/* RIGHT: update form */}
        <section className="flex min-h-0 flex-col rounded-xl border border-line bg-white lg:col-span-2 2xl:col-span-1" aria-label="Update action point">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-semibold">Update Action Point</h2>
            {isDirty && <span className="text-xs font-medium text-warn">Unsaved changes</span>}
          </div>
          {!item || !a || !draft ? <div className="p-6 text-sm text-muted">No item selected.</div> : !canPart ? (
            <div className="p-6 text-sm text-muted">You have read-only access to this meeting.</div>
          ) : (
            <form className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" onSubmit={(e) => { e.preventDefault(); save({ markReviewed: true, advance: true }); }}>
              <Field label="New Feedback / Meeting Update" htmlFor="u-fb" hint="Leave blank to keep the current feedback. Previous feedback is never deleted.">
                <textarea id="u-fb" className="input min-h-[110px]" value={draft.feedback} onChange={(e) => setDraft({ feedback: e.target.value })} maxLength={10000} placeholder="What was discussed / agreed…" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status" htmlFor="u-status">
                  <select id="u-status" className="input" value={draft.status} onChange={(e) => setDraft({ status: e.target.value as Status })}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </Field>
                <Field label="Priority" htmlFor="u-pr">
                  <select id="u-pr" className="input" value={draft.priority} onChange={(e) => setDraft({ priority: e.target.value })}>
                    <option value="">Not set</option>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </select>
                </Field>
              </div>
              {supportsStages && (
                <Field label="Current Stage" htmlFor="u-stage">
                  <input id="u-stage" className="input" list="u-stage-list" value={draft.currentStage} onChange={(e) => setDraft({ currentStage: e.target.value })} maxLength={200} />
                  <datalist id="u-stage-list">{meta?.stages.map((s) => <option key={s} value={s} />)}</datalist>
                </Field>
              )}
              <Field label="Process Owner" htmlFor="u-owner">
                <input id="u-owner" className="input" list="u-owner-list" value={draft.ownerName} onChange={(e) => setDraft({ ownerName: e.target.value })} maxLength={200} />
                <datalist id="u-owner-list">{meta?.owners.map((o) => <option key={o} value={o} />)}</datalist>
              </Field>
              <Field label="Revised Target Date" htmlFor="u-rev" hint={a.revisedTargetText && !a.revisedTargetDate ? `Imported value: "${a.revisedTargetText}"` : undefined}>
                <input id="u-rev" type="date" className="input" value={draft.revisedTargetDate} onChange={(e) => setDraft({ revisedTargetDate: e.target.value })} />
              </Field>
              {draft.revisedTargetDate !== (a.revisedTargetDate ?? "") && (
                <Field label="Reason for deadline change (optional)" htmlFor="u-reason">
                  <input id="u-reason" className="input" value={draft.deadlineReason} onChange={(e) => setDraft({ deadlineReason: e.target.value })} maxLength={500} />
                </Field>
              )}
              <Field label="Next Action (optional)" htmlFor="u-next">
                <input id="u-next" className="input" value={draft.nextAction} onChange={(e) => setDraft({ nextAction: e.target.value })} maxLength={2000} />
              </Field>
              <Field label="Notes / Blocker (optional)" htmlFor="u-block">
                <input id="u-block" className="input" value={draft.blocker} onChange={(e) => setDraft({ blocker: e.target.value })} maxLength={2000} />
              </Field>
              {isDirty && <button type="button" className="text-xs text-muted hover:text-navy hover:underline" onClick={() => setDrafts((d) => { const n = { ...d }; delete n[item.id]; return n; })}>Discard unsaved changes</button>}
              {error && <Alert onClose={() => setError(null)}>{error}</Alert>}
              <button type="submit" className="hidden" />
            </form>
          )}
          {canPart && item && (
            <div className="space-y-2 border-t border-line p-3">
              <Button variant="primary" size="lg" className="w-full" loading={busy === "next"} disabled={Boolean(busy)} onClick={() => save({ markReviewed: true, advance: true })} icon={<ChevronRight className="h-5 w-5" />}>
                Save &amp; Next
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" onClick={() => go(idx - 1)} disabled={idx <= 0 || Boolean(busy)} icon={<ChevronLeft className="h-4 w-4" />}>Previous Item</Button>
                <Button size="sm" onClick={() => save({ markReviewed: false, advance: false })} loading={busy === "draft"} disabled={Boolean(busy)} icon={<Save className="h-4 w-4" />}>Save Draft</Button>
                <Button size="sm" onClick={markReviewed} loading={busy === "reviewed" || busy === "REVIEWED"} disabled={Boolean(busy) || (item.reviewState === "REVIEWED" && !isDirty)} icon={<Check className="h-4 w-4" />}>Mark Reviewed</Button>
                <Button size="sm" onClick={() => setReview("SKIPPED", true)} loading={busy === "SKIPPED"} disabled={Boolean(busy)} icon={<SkipForward className="h-4 w-4" />}>Skip for Now</Button>
              </div>
              <p className="text-center text-[11px] text-muted">Ctrl+Enter = Save &amp; Next · Alt+←/→ = move between items</p>
            </div>
          )}
          {!canPart && item && (
            <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
              <Button size="sm" onClick={() => go(idx - 1)} disabled={idx <= 0} icon={<ChevronLeft className="h-4 w-4" />}>Previous</Button>
              <Button size="sm" onClick={() => go(idx + 1)} disabled={idx >= agenda.length - 1} icon={<ChevronRight className="h-4 w-4" />}>Next</Button>
            </div>
          )}
        </section>
      </div>

      <ActionPointForm open={addingAction} meta={meta} meetingId={id} onClose={() => setAddingAction(false)} onSaved={async (dto) => {
        setAddingAction(false);
        const fresh = await load();
        reloadMeta();
        toast("success", "New action point created and linked to this meeting");
        const added = fresh?.agenda.find((x) => x.current.id === dto.id);
        if (added) setSelected(added.id);
      }} />
      <AddExistingDialog open={addingExisting} meetingId={id} inAgenda={new Set(agenda.map((x) => x.current.id))} onClose={() => setAddingExisting(false)} onAdded={() => { setAddingExisting(false); load(); }} />
      <FinishDialog open={finishing} meetingId={id} onClose={() => setFinishing(false)} dirtyCount={dirtyIds.length} onFinished={() => { setDrafts({}); router.push(`/meetings/${id}`); }} />
      <MeetingDetailsDialog open={editingDetails} data={data} onClose={() => setEditingDetails(false)} onSaved={() => { setEditingDetails(false); load(); }} />
      <ConflictDialog open={Boolean(conflict)} current={conflict?.current ?? null} mine={conflict?.mine ?? {}} onClose={() => setConflict(null)}
        onReload={() => { if (conflict) setDrafts((d) => { const n = { ...d }; delete n[conflict.itemId]; return n; }); setConflict(null); load(); }}
        onReapply={() => { const c = conflict; setConflict(null); if (c) load().then(() => save({ markReviewed: c.markReviewed, advance: c.advance }, { version: c.current.version, fields: c.mine })); }} />
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-medium text-muted">{label}</dt><dd className="mt-0.5">{children}</dd></div>;
}

function AddExistingDialog({ open, meetingId, inAgenda, onClose, onAdded }: { open: boolean; meetingId: string; inAgenda: Set<string>; onClose: () => void; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ActionPointDTO[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api<{ items: ActionPointDTO[] }>(`/api/action-points?q=${encodeURIComponent(q)}`).then((r) => setItems(r.items.filter((i) => !inAgenda.has(i.id)))).catch((e) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, inAgenda]);
  useEffect(() => { if (open) { setPicked([]); setError(null); } }, [open]);
  async function add() {
    setBusy(true);
    try {
      await api(`/api/meetings/${meetingId}/agenda`, { body: { actionPointIds: picked } });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Add existing action points to the agenda" size="lg" footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" disabled={!picked.length} loading={busy} onClick={add}>Add {picked.length || ""} item(s)</Button>
    </>}>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <input className="input mb-3" placeholder="Search action points…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search action points" />
      <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {items.length === 0 && <li className="p-4 text-sm text-muted">No other action points found.</li>}
        {items.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-navy-50">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-brand" checked={picked.includes(i.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i.id] : p.filter((x) => x !== i.id)))} />
              <span className="flex-1 text-sm"><span className="font-medium">{i.title}</span><span className="block text-xs text-muted">{i.ownerName ?? "No owner"} · {STATUS_LABEL[i.status]}</span></span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function FinishDialog({ open, meetingId, dirtyCount, onClose, onFinished }: { open: boolean; meetingId: string; dirtyCount: number; onClose: () => void; onFinished: () => void }) {
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [confirmUnreviewed, setConfirmUnreviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setSummary(null); setConfirmUnreviewed(false); setError(null);
    api<{ summary: MeetingSummary }>(`/api/meetings/${meetingId}/summary`).then((r) => setSummary(r.summary)).catch((e) => setError(e.message));
  }, [open, meetingId]);
  async function finish() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/meetings/${meetingId}/finalize`, { body: { confirmUnreviewed } });
      onFinished();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const t = summary?.totals;
  const needsConfirm = (t?.unreviewed ?? 0) > 0;
  return (
    <Modal open={open} onClose={onClose} title="Finish meeting" size="lg" footer={<>
      <Button onClick={onClose} disabled={busy}>Back to meeting</Button>
      <Button variant="primary" loading={busy} disabled={!summary || (needsConfirm && !confirmUnreviewed)} onClick={finish}>Finish &amp; save summary</Button>
    </>}>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {dirtyCount > 0 && <div className="mb-3"><Alert tone="warning">{dirtyCount} item(s) have unsaved changes in the update panel. Go back and save them first, or they will be lost.</Alert></div>}
      {!summary ? <Spinner label="Preparing summary…" /> : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[["Reviewed", t!.reviewed], ["Completed / closed", t!.completed], ["Still In Progress", t!.remainingInProgress], ["On Hold", t!.onHold], ["Overdue", t!.overdue], ["Revised deadlines", t!.revisedDeadlines], ["New actions", t!.newActions], ["Follow-ups", t!.followUps]].map(([l, v]) => (
              <div key={l as string} className="rounded-lg border border-line p-3"><div className="text-xs text-muted">{l}</div><div className="text-xl font-semibold">{v}</div></div>
            ))}
          </div>
          {needsConfirm ? (
            <div className="rounded-lg border border-warn/40 bg-warn-light p-3">
              <p className="font-medium text-warn">{t!.unreviewed} agenda item(s) have not been reviewed:</p>
              <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-navy">
                {summary.unreviewedItems.map((u) => <li key={u.actionPointId}>{u.title} <span className="text-xs text-muted">({u.reviewState === "SKIPPED" ? "skipped" : "not reviewed"})</span></li>)}
              </ul>
              <label className="mt-3 flex items-center gap-2 font-medium">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={confirmUnreviewed} onChange={(e) => setConfirmUnreviewed(e.target.checked)} />
                Finish anyway – keep these items recorded as unreviewed
              </label>
            </div>
          ) : <Alert tone="success">All agenda items have been reviewed.</Alert>}
          <p className="text-xs text-muted">Finishing saves a permanent summary and snapshot. Later corrections are recorded as revisions.</p>
        </div>
      )}
    </Modal>
  );
}

function MeetingDetailsDialog({ open, data, onClose, onSaved }: { open: boolean; data: MeetingDetail; onClose: () => void; onSaved: () => void }) {
  const [attendees, setAttendees] = useState(data.meeting.attendees ?? "");
  const [notes, setNotes] = useState(data.meeting.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setAttendees(data.meeting.attendees ?? ""); setNotes(data.meeting.notes ?? ""); setError(null); } }, [open, data]);
  async function save() {
    setBusy(true);
    try {
      await api(`/api/meetings/${data.meeting.id}`, { method: "PATCH", body: { version: data.meeting.version, attendees, notes } });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Meeting details" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      <div className="space-y-3">
        <Field label="Attendees" htmlFor="md-att"><textarea id="md-att" className="input min-h-[80px]" value={attendees} onChange={(e) => setAttendees(e.target.value)} maxLength={2000} /></Field>
        <Field label="Notes" htmlFor="md-notes"><textarea id="md-notes" className="input min-h-[80px]" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} /></Field>
      </div>
    </Modal>
  );
}
