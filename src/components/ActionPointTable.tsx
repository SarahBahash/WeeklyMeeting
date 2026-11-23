"use client";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Expand, Lock, Pencil, Search, X } from "lucide-react";
import type { ActionPointDTO } from "@/lib/services/action-points";
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, type Status } from "@/lib/domain";
import { formatDateTime } from "@/lib/dates";
import { api, ApiClientError } from "@/lib/client";
import { useAuth } from "./auth-context";
import { useToast } from "./toast";
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PriorityBadge, Spinner, StatusBadge, cx } from "./ui";
import { ConflictDialog } from "./ConflictDialog";
import { DateText, DeadlineFlag } from "./DeadlineCell";
import type { Meta } from "./hooks";

export interface Filters {
  status: Status[];
  activityTypeId: string;
  projectId: string;
  owner: string;
  priority: string;
  stage: string;
  q: string;
  overdue: boolean;
  dueSoon: boolean;
}
export const EMPTY_FILTERS: Filters = { status: [], activityTypeId: "", projectId: "", owner: "", priority: "", stage: "", q: "", overdue: false, dueSoon: false };

function toQuery(f: Filters) {
  const p = new URLSearchParams();
  if (f.status.length) p.set("status", f.status.join(","));
  for (const k of ["activityTypeId", "projectId", "owner", "priority", "stage", "q"] as const) if (f[k]) p.set(k, f[k]);
  if (f.overdue) p.set("overdue", "1");
  if (f.dueSoon) p.set("dueSoon", "1");
  return p.toString();
}

type SortKey = "order" | "title" | "target" | "revised" | "priority" | "status" | "updated" | "owner";
const PRIORITY_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

interface Draft {
  status: Status;
  ownerName: string;
  currentStage: string;
  priority: string;
  originalTargetDate: string;
  revisedTargetDate: string;
  deadlineReason: string;
}

const draftOf = (a: ActionPointDTO): Draft => ({
  status: a.status,
  ownerName: a.ownerName ?? "",
  currentStage: a.currentStage ?? "",
  priority: a.priority ?? "",
  originalTargetDate: a.originalTargetDate ?? "",
  revisedTargetDate: a.revisedTargetDate ?? "",
  deadlineReason: "",
});

function diffDraft(a: ActionPointDTO, d: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (d.status !== a.status) out.status = d.status;
  if (d.ownerName.trim() !== (a.ownerName ?? "")) out.ownerName = d.ownerName.trim() || null;
  if (d.currentStage.trim() !== (a.currentStage ?? "")) out.currentStage = d.currentStage.trim() || null;
  if (d.priority !== (a.priority ?? "")) out.priority = d.priority || null;
  if (d.originalTargetDate !== (a.originalTargetDate ?? "")) out.originalTargetDate = d.originalTargetDate || null;
  if (d.revisedTargetDate !== (a.revisedTargetDate ?? "")) out.revisedTargetDate = d.revisedTargetDate || null;
  if (Object.keys(out).length && d.deadlineReason.trim()) out.deadlineReason = d.deadlineReason.trim();
  return out;
}

export function ActionPointTable({ meta, filters, setFilters, reloadKey, onChanged }: {
  meta: Meta | null;
  filters: Filters;
  setFilters: (f: Filters) => void;
  reloadKey?: number;
  onChanged?: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const canWrite = can("actionPoint:write");
  const canCorrectOriginal = can("actionPoint:correctOriginalDate");
  const [items, setItems] = useState<ActionPointDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState(filters.q);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "order", dir: 1 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ current: ActionPointDTO; mine: Record<string, unknown> } | null>(null);
  const [feedbackFor, setFeedbackFor] = useState<ActionPointDTO | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ items: ActionPointDTO[] }>(`/api/action-points?${toQuery(filters)}`, { signal: ac.signal });
      setItems(res.items);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => {
    const t = setTimeout(() => { if (searchText !== filters.q) setFilters({ ...filters, q: searchText }); }, 300);
    return () => clearTimeout(t);
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    if (!items) return [];
    const list = [...items];
    const v = (a: ActionPointDTO): string | number => {
      switch (sort.key) {
        case "order": return a.sortOrder;
        case "title": return a.title.toLowerCase();
        case "owner": return (a.ownerName ?? "~").toLowerCase();
        case "target": return a.originalTargetDate ?? "9999";
        case "revised": return a.deadline.effectiveDeadline ?? "9999";
        case "priority": return a.priority ? PRIORITY_RANK[a.priority] : 9;
        case "status": return STATUSES.indexOf(a.status);
        case "updated": return a.updatedAt;
      }
    };
    list.sort((a, b) => (v(a) < v(b) ? -1 : v(a) > v(b) ? 1 : 0) * sort.dir);
    return list;
  }, [items, sort]);

  function startEdit(a: ActionPointDTO) {
    setEditingId(a.id);
    setDraft(draftOf(a));
    setRowError(null);
  }
  function cancelEdit() {
    setEditingId(null);
    setDraft(null);
    setRowError(null);
  }
  function replaceItem(dto: ActionPointDTO) {
    setItems((list) => (list ? list.map((i) => (i.id === dto.id ? dto : i)) : list));
  }

  async function save(a: ActionPointDTO, changes: Record<string, unknown>, version = a.version) {
    if (!Object.keys(changes).length) { cancelEdit(); return; }
    if (changes.originalTargetDate !== undefined && a.originalTargetDate && !changes.deadlineReason) {
      setRowError("Enter a reason for correcting the original target date.");
      return;
    }
    setSaving(true);
    setRowError(null);
    try {
      const res = await api<{ actionPoint: ActionPointDTO }>(`/api/action-points/${a.id}?source=quick`, { method: "PATCH", body: { ...changes, version } });
      replaceItem(res.actionPoint);
      cancelEdit();
      setFlashId(a.id);
      setTimeout(() => setFlashId(null), 2000);
      toast("success", "Changes saved");
      onChanged?.();
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409 && e.data.conflict) {
        setConflict({ current: e.data.current as ActionPointDTO, mine: changes });
      } else {
        setRowError((e as Error).message);
      }
    } finally {
      setSaving(false);
    }
  }

  const sortHeader = (key: SortKey, label: string, className?: string) => (
    <th className={cx("th", className)} aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button className="inline-flex items-center gap-1 uppercase hover:text-navy" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });
  const activeFilterCount = filters.status.length + ["activityTypeId", "projectId", "owner", "priority", "stage", "q"].filter((k) => filters[k as keyof Filters]).length + (filters.overdue ? 1 : 0) + (filters.dueSoon ? 1 : 0);

  return (
    <Card>
      {/* Filters */}
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted">Status</span>
          <button onClick={() => set("status", [])} className={cx("rounded-full border px-3 py-1 text-xs font-medium", filters.status.length === 0 ? "border-brand bg-brand text-white" : "border-line hover:bg-navy-50")}>All</button>
          {STATUSES.map((s) => {
            const on = filters.status.includes(s);
            return (
              <button key={s} aria-pressed={on}
                onClick={() => set("status", on ? filters.status.filter((x) => x !== s) : s === "IN_PROGRESS" && filters.status.length === 0 ? [s] : [...filters.status, s])}
                className={cx("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-brand bg-brand text-white" : "border-line hover:bg-navy-50")}>
                {STATUS_LABEL[s]}
              </button>
            );
          })}
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <button aria-pressed={filters.overdue} onClick={() => set("overdue", !filters.overdue)} className={cx("rounded-full border px-3 py-1 text-xs font-medium", filters.overdue ? "border-danger bg-danger text-white" : "border-line hover:bg-navy-50")}>Overdue</button>
          <button aria-pressed={filters.dueSoon} onClick={() => set("dueSoon", !filters.dueSoon)} className={cx("rounded-full border px-3 py-1 text-xs font-medium", filters.dueSoon ? "border-warn bg-warn text-white" : "border-line hover:bg-navy-50")}>Due soon</button>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <div className="relative col-span-2 md:col-span-3 xl:col-span-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" aria-hidden />
            <input className="input pl-8" placeholder="Search title, owner, feedback…" aria-label="Search" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
          </div>
          <select className="input" aria-label="Activity type" value={filters.activityTypeId} onChange={(e) => set("activityTypeId", e.target.value)}>
            <option value="">All activity types</option>
            {meta?.activityTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="none">Unclassified</option>
          </select>
          <select className="input" aria-label="Project" value={filters.projectId} onChange={(e) => set("projectId", e.target.value)}>
            <option value="">All projects</option>
            {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            <option value="none">No related project</option>
          </select>
          <select className="input" aria-label="Owner" value={filters.owner} onChange={(e) => set("owner", e.target.value)}>
            <option value="">All owners</option>
            {meta?.owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select className="input" aria-label="Priority" value={filters.priority} onChange={(e) => set("priority", e.target.value)}>
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            <option value="none">No priority</option>
          </select>
          <select className="input" aria-label="Stage" value={filters.stage} onChange={(e) => set("stage", e.target.value)}>
            <option value="">All stages</option>
            {meta?.stages.map((s) => <option key={s} value={s}>{s}</option>)}
            <option value="none">No stage</option>
          </select>
        </div>
        <div className="flex items-center justify-between text-xs text-muted">
          <span role="status">{loading ? "Loading…" : `${items?.length ?? 0} action point(s)`}</span>
          {activeFilterCount > 0 && <button className="link" onClick={() => { setSearchText(""); setFilters(EMPTY_FILTERS); }}>Clear all filters</button>}
        </div>
      </div>

      {error && <div className="p-4"><Alert>{error} <button className="link ml-2" onClick={load}>Retry</button></Alert></div>}
      {!items && loading && <Spinner />}
      {items && items.length === 0 && !loading && (
        <EmptyState title="No action points match these filters">
          {activeFilterCount ? "Try clearing some filters." : "Import the Excel tracker (Administration → Import Data) or create a new action point."}
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full min-w-[1200px] border-collapse">
            <thead>
              <tr>
                {sortHeader("order", "#", "w-12")}
                {sortHeader("title", "Action Point / Project", "min-w-[260px]")}
                <th className="th">Activity Type</th>
                <th className="th">Current Stage</th>
                {sortHeader("owner", "Owner")}
                {sortHeader("target", "Target Date")}
                {sortHeader("revised", "Revised Date")}
                {sortHeader("priority", "Priority")}
                {sortHeader("status", "Status")}
                <th className="th min-w-[240px]">Feedback</th>
                {sortHeader("updated", "Last Updated")}
                <th className="th w-24"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const editing = editingId === a.id && draft;
                const typeHasStages = a.activityType?.supportsStages ?? true;
                return (
                  <Fragment key={a.id}>
                  <tr className={cx("transition-colors", editing ? "bg-brand-light/40" : flashId === a.id ? "bg-brand-light" : "hover:bg-navy-50/60")}
                    onKeyDown={(e) => {
                      if (!editing) return;
                      if (e.key === "Escape") cancelEdit();
                      if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); save(a, diffDraft(a, draft)); }
                    }}>
                    <td className="td text-xs text-muted">{a.legacySn ?? ""}</td>
                    <td className="td">
                      <Link href={`/action-points/${a.id}`} className="font-medium text-navy hover:text-brand hover:underline">{a.title}</Link>
                      {a.restricted && <span className="ml-1.5 inline-flex align-middle" title="Restricted – administrators only"><Lock className="h-3.5 w-3.5 text-warn" aria-label="Restricted" /></span>}
                      {a.project && <div className="mt-0.5 text-xs text-muted">{a.project.name}</div>}
                    </td>
                    <td className="td text-xs">{a.activityType ? a.activityType.name : <Badge>Unclassified</Badge>}</td>
                    <td className="td text-xs">
                      {editing ? (
                        typeHasStages ? <input className="input py-1 text-xs" list="ap-stage-list" aria-label="Current stage" value={draft.currentStage} onChange={(e) => setDraft({ ...draft, currentStage: e.target.value })} /> : <span className="text-muted">N/A</span>
                      ) : a.currentStage ?? a.projectStage?.name ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="td text-xs">
                      {editing ? <input className="input py-1 text-xs" list="ap-owner-list" aria-label="Process owner" value={draft.ownerName} onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })} /> : a.ownerName ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="td text-xs">
                      {editing && (canCorrectOriginal || (!a.originalTargetDate && !a.originalTargetText))
                        ? <input type="date" className="input py-1 text-xs" aria-label="Target date" value={draft.originalTargetDate} onChange={(e) => setDraft({ ...draft, originalTargetDate: e.target.value })} />
                        : <DateText date={a.originalTargetDate} text={a.originalTargetText} />}
                    </td>
                    <td className="td text-xs">
                      {editing ? <input type="date" className="input py-1 text-xs" aria-label="Revised date" value={draft.revisedTargetDate} onChange={(e) => setDraft({ ...draft, revisedTargetDate: e.target.value })} /> : <DateText date={a.revisedTargetDate} text={a.revisedTargetText} />}
                      {!editing && <div><DeadlineFlag ap={a} /></div>}
                    </td>
                    <td className="td">
                      {editing ? (
                        <select className="input py-1 text-xs" aria-label="Priority" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                          <option value="">—</option>
                          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                        </select>
                      ) : <PriorityBadge priority={a.priority} />}
                    </td>
                    <td className="td">
                      {editing ? (
                        <select className="input py-1 text-xs" aria-label="Status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Status })}>
                          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                        </select>
                      ) : <StatusBadge status={a.status} />}
                    </td>
                    <td className="td text-xs">
                      <button className="group w-full text-left" onClick={() => setFeedbackFor(a)} title={canWrite ? "Open feedback editor" : "View full feedback"}>
                        <span className="line-clamp-3 text-navy">{a.feedback || <span className="text-muted">No feedback yet</span>}</span>
                        <span className="mt-0.5 hidden items-center gap-1 text-brand group-hover:inline-flex"><Expand className="h-3 w-3" /> {canWrite ? "Expand / edit" : "Expand"}</span>
                      </button>
                    </td>
                    <td className="td whitespace-nowrap text-xs text-muted">{formatDateTime(a.updatedAt)}{a.updatedBy && <div>{a.updatedBy}</div>}</td>
                    <td className="td">
                      {canWrite && (editing ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="primary" loading={saving} onClick={() => save(a, diffDraft(a, draft))} aria-label="Save changes" icon={<Check className="h-3.5 w-3.5" />} />
                          <Button size="sm" onClick={cancelEdit} disabled={saving} aria-label="Cancel editing" icon={<X className="h-3.5 w-3.5" />} />
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => startEdit(a)} disabled={Boolean(editingId)} aria-label={`Quick edit ${a.title}`} icon={<Pencil className="h-3.5 w-3.5" />}>Edit</Button>
                      ))}
                    </td>
                  </tr>
                  {editing && (
                    <tr className="bg-brand-light/40">
                      <td className="border-b border-line" />
                      <td colSpan={11} className="border-b border-line px-3 pb-3">
                        <div className="flex flex-wrap items-end gap-3">
                          {(draft.revisedTargetDate !== (a.revisedTargetDate ?? "") || draft.originalTargetDate !== (a.originalTargetDate ?? "")) && (
                            <Field label={draft.originalTargetDate !== (a.originalTargetDate ?? "") && a.originalTargetDate ? "Reason for correcting original date (required)" : "Reason for deadline change (optional)"} className="w-96">
                              <input className="input py-1 text-xs" value={draft.deadlineReason} onChange={(e) => setDraft({ ...draft, deadlineReason: e.target.value })} maxLength={500} />
                            </Field>
                          )}
                          <span className="pb-1 text-xs text-muted">Enter saves · Esc cancels · changes are logged in the item history</span>
                          {rowError && <span className="pb-1 text-xs font-medium text-danger" role="alert">{rowError}</span>}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <datalist id="ap-owner-list">{meta?.owners.map((o) => <option key={o} value={o} />)}</datalist>
          <datalist id="ap-stage-list">{meta?.stages.map((o) => <option key={o} value={o} />)}</datalist>
        </div>
      )}

      <FeedbackEditor ap={feedbackFor} canWrite={canWrite} onClose={() => setFeedbackFor(null)} onSaved={(dto) => { replaceItem(dto); setFeedbackFor(null); onChanged?.(); }} onConflict={(current, mine) => { setFeedbackFor(null); setConflict({ current, mine }); }} />

      <ConflictDialog
        open={Boolean(conflict)}
        current={conflict?.current ?? null}
        mine={conflict?.mine ?? {}}
        onClose={() => setConflict(null)}
        onReload={() => { if (conflict) replaceItem(conflict.current); setConflict(null); cancelEdit(); }}
        onReapply={() => {
          if (!conflict) return;
          const c = conflict;
          setConflict(null);
          replaceItem(c.current);
          save(c.current, c.mine, c.current.version);
        }}
      />
    </Card>
  );
}

function FeedbackEditor({ ap, canWrite, onClose, onSaved, onConflict }: {
  ap: ActionPointDTO | null;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (dto: ActionPointDTO) => void;
  onConflict: (current: ActionPointDTO, mine: Record<string, unknown>) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setText(ap?.feedback ?? ""); setError(null); }, [ap]);
  if (!ap) return null;
  const dirty = text !== (ap.feedback ?? "");
  async function save() {
    if (!ap) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ actionPoint: ActionPointDTO }>(`/api/action-points/${ap.id}?source=quick`, { method: "PATCH", body: { version: ap.version, feedback: text } });
      toast("success", "Feedback saved – previous feedback kept in history");
      onSaved(res.actionPoint);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409 && e.data.conflict) onConflict(e.data.current as ActionPointDTO, { feedback: text });
      else setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open onClose={() => { if (!dirty || confirm("Discard your unsaved feedback?")) onClose(); }} title={`Feedback – ${ap.title}`} size="lg" footer={canWrite ? <>
      <Button onClick={onClose} disabled={saving}>Cancel</Button>
      <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>Save feedback</Button>
    </> : <Button onClick={onClose}>Close</Button>}>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}
      {canWrite ? (
        <Field label="Feedback" htmlFor="fb-text" hint="The previous feedback is preserved in the action point's history.">
          <textarea id="fb-text" className="input min-h-[260px] leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} maxLength={10000} />
        </Field>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{ap.feedback || "No feedback recorded."}</p>
      )}
      <p className="mt-2 text-xs text-muted">Last updated {formatDateTime(ap.updatedAt)}{ap.updatedBy ? ` by ${ap.updatedBy}` : ""}</p>
    </Modal>
  );
}
