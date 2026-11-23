"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Circle, CircleDot, MinusCircle, Plus, Trash2 } from "lucide-react";
import { STAGE_STATUSES, STAGE_STATUS_LABEL, STATUS_LABEL, type StageStatus, type Status } from "@/lib/domain";
import { formatDate } from "@/lib/dates";
import { api } from "@/lib/client";
import { useAuth } from "@/components/auth-context";
import { useLoad } from "@/components/hooks";
import { useToast } from "@/components/toast";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Modal, Spinner, StatusBadge, cx } from "@/components/ui";
import type { Template } from "../TemplatesPanel";

interface Stage { id: string; name: string; partName: string | null; sortOrder: number; ownerName: string | null; status: StageStatus; targetDate: string | null; actualCompletionDate: string | null; version: number; actionPoints: { id: string; title: string; status: Status }[] }
interface Project { id: string; name: string; description: string | null; isAudit: boolean; stages: Stage[]; actionPoints: { id: string; title: string; status: Status; ownerName: string | null; currentStage: string | null; projectStageId: string | null }[] }

const ICON = { COMPLETED: CheckCircle2, IN_PROGRESS: CircleDot, NOT_STARTED: Circle, NOT_APPLICABLE: MinusCircle };
const TONE = { COMPLETED: "text-brand", IN_PROGRESS: "text-warn", NOT_STARTED: "text-line", NOT_APPLICABLE: "text-muted" };

export function ProjectStages({ id }: { id: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad<{ project: Project }>(`/api/projects/${id}`);
  const templates = useLoad<{ templates: Template[] }>("/api/templates");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newStage, setNewStage] = useState({ name: "", partName: "", afterStageId: "" });
  const [applyTpl, setApplyTpl] = useState("");
  const [removing, setRemoving] = useState<Stage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const canWrite = can("stage:write");

  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const p = data.project;

  async function patch(s: Stage, body: Record<string, unknown>) {
    setSavingId(s.id);
    setErr(null);
    try {
      await api(`/api/stages/${s.id}`, { method: "PATCH", body: { version: s.version, ...body } });
      await reload();
    } catch (e) {
      setErr((e as Error).message);
      if ((e as Error).message.includes("changed by someone else")) reload();
    } finally {
      setSavingId(null);
    }
  }
  async function addStage() {
    try {
      await api(`/api/projects/${id}/stages`, { body: applyTpl ? { name: "template", templateId: applyTpl } : { name: newStage.name, partName: newStage.partName || null, afterStageId: newStage.afterStageId || undefined } });
      setAdding(false);
      setApplyTpl("");
      setNewStage({ name: "", partName: "", afterStageId: "" });
      reload();
      toast("success", "Stage(s) added");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const parts: { name: string; stages: Stage[] }[] = [];
  for (const s of p.stages) {
    const name = s.partName ?? "Stages";
    if (parts.at(-1)?.name === name) parts.at(-1)!.stages.push(s);
    else parts.push({ name, stages: [s] });
  }
  const done = p.stages.filter((s) => s.status === "COMPLETED" || s.status === "NOT_APPLICABLE").length;

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/audits" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-navy"><ArrowLeft className="h-4 w-4" /> Audit Reviews & Stages</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          {p.description && <p className="mt-1 text-sm text-muted">{p.description}</p>}
          {p.stages.length > 0 && <p className="mt-1 text-sm text-muted">{done} of {p.stages.length} stages complete · several stages may be active at the same time</p>}
        </div>
        {canWrite && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add stage</Button>}
      </div>
      {err && <div className="mb-4"><Alert onClose={() => setErr(null)}>{err}</Alert></div>}
      {p.stages.length === 0 ? (
        <Card><EmptyState title="No stages for this project">Stages are optional. {canWrite && "Use “Add stage” to apply a template or add individual stages."}</EmptyState></Card>
      ) : (
        <div className="space-y-6">
          {parts.map((part) => (
            <section key={part.name + part.stages[0].id}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand">{part.name}</h2>
              <Card>
                <ol className="divide-y divide-line">
                  {part.stages.map((s) => {
                    const Icon = ICON[s.status];
                    return (
                      <li key={s.id} className={cx("grid grid-cols-1 items-start gap-3 p-4 md:grid-cols-[minmax(0,1.4fr)_160px_150px_150px_150px_auto]", savingId === s.id && "opacity-60")}>
                        <div className="flex items-start gap-3">
                          <Icon className={cx("mt-0.5 h-5 w-5 flex-none", TONE[s.status])} aria-hidden />
                          <div>
                            <div className="font-medium">{s.sortOrder}. {s.name}</div>
                            {s.actionPoints.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {s.actionPoints.map((a) => <li key={a.id} className="text-xs"><Link className="link" href={`/action-points/${a.id}`}>{a.title}</Link> <span className="text-muted">· {STATUS_LABEL[a.status]}</span></li>)}
                              </ul>
                            )}
                          </div>
                        </div>
                        {canWrite ? (
                          <>
                            <label className="text-xs text-muted">Status
                              <select className="input mt-0.5 py-1" value={s.status} onChange={(e) => patch(s, { status: e.target.value })}>
                                {STAGE_STATUSES.map((x) => <option key={x} value={x}>{STAGE_STATUS_LABEL[x]}</option>)}
                              </select>
                            </label>
                            <label className="text-xs text-muted">Owner
                              <input className="input mt-0.5 py-1" defaultValue={s.ownerName ?? ""} onBlur={(e) => e.target.value !== (s.ownerName ?? "") && patch(s, { ownerName: e.target.value })} />
                            </label>
                            <label className="text-xs text-muted">Target date
                              <input type="date" className="input mt-0.5 py-1" defaultValue={s.targetDate ?? ""} onBlur={(e) => e.target.value !== (s.targetDate ?? "") && patch(s, { targetDate: e.target.value })} />
                            </label>
                            <label className="text-xs text-muted">Actual completion
                              <input type="date" className="input mt-0.5 py-1" defaultValue={s.actualCompletionDate ?? ""} onBlur={(e) => e.target.value !== (s.actualCompletionDate ?? "") && patch(s, { actualCompletionDate: e.target.value })} />
                            </label>
                            <div className="flex gap-1 pt-4">
                              <button className="rounded p-1 hover:bg-navy-50" onClick={() => patch(s, { move: "up" })} aria-label="Move stage up"><ArrowUp className="h-4 w-4" /></button>
                              <button className="rounded p-1 hover:bg-navy-50" onClick={() => patch(s, { move: "down" })} aria-label="Move stage down"><ArrowDown className="h-4 w-4" /></button>
                              <button className="rounded p-1 text-danger hover:bg-danger-light" onClick={() => setRemoving(s)} aria-label="Remove stage"><Trash2 className="h-4 w-4" /></button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div><Badge tone={s.status === "COMPLETED" ? "green" : s.status === "IN_PROGRESS" ? "amber" : "neutral"}>{STAGE_STATUS_LABEL[s.status]}</Badge></div>
                            <div className="text-sm">{s.ownerName ?? "—"}</div>
                            <div className="text-sm">{formatDate(s.targetDate) || "—"}</div>
                            <div className="text-sm">{formatDate(s.actualCompletionDate) || "—"}</div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </section>
          ))}
        </div>
      )}
      <section className="mt-8">
        <h2 className="mb-2 text-sm font-semibold">Linked action points ({p.actionPoints.length})</h2>
        <Card>
          {p.actionPoints.length ? (
            <ul className="divide-y divide-line">
              {p.actionPoints.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <Link className="font-medium hover:text-brand hover:underline" href={`/action-points/${a.id}`}>{a.title}</Link>
                  <span className="flex items-center gap-2 text-xs text-muted">{a.currentStage ?? ""} <StatusBadge status={a.status} /></span>
                </li>
              ))}
            </ul>
          ) : <p className="p-4 text-sm text-muted">Link action points to this project from the action point’s Edit form (Related Project).</p>}
        </Card>
      </section>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add stages" footer={<><Button onClick={() => setAdding(false)}>Cancel</Button><Button variant="primary" disabled={!applyTpl && !newStage.name.trim()} onClick={addStage}>Add</Button></>}>
        <div className="space-y-4">
          <Field label="Apply a template" htmlFor="as-tpl" hint="Copies all template stages to the end of this project.">
            <select id="as-tpl" className="input" value={applyTpl} onChange={(e) => setApplyTpl(e.target.value)}>
              <option value="">— Add a single stage instead —</option>
              {templates.data?.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {!applyTpl && (
            <>
              <Field label="Stage name *" htmlFor="as-name"><input id="as-name" className="input" placeholder="e.g. Testing Phase, RCM Discussion" value={newStage.name} onChange={(e) => setNewStage({ ...newStage, name: e.target.value })} /></Field>
              <Field label="Part (optional)" htmlFor="as-part"><input id="as-part" className="input" list="as-parts" value={newStage.partName} onChange={(e) => setNewStage({ ...newStage, partName: e.target.value })} /><datalist id="as-parts">{[...new Set(p.stages.map((s) => s.partName).filter(Boolean))].map((x) => <option key={x!} value={x!} />)}</datalist></Field>
              <Field label="Insert after" htmlFor="as-after">
                <select id="as-after" className="input" value={newStage.afterStageId} onChange={(e) => setNewStage({ ...newStage, afterStageId: e.target.value })}>
                  <option value="">At the end</option>
                  {p.stages.map((s) => <option key={s.id} value={s.id}>{s.sortOrder}. {s.name}</option>)}
                </select>
              </Field>
            </>
          )}
        </div>
      </Modal>
      <ConfirmDialog open={Boolean(removing)} title="Remove stage?" danger confirmLabel="Remove stage" onCancel={() => setRemoving(null)} onConfirm={async () => {
        const s = removing!;
        setRemoving(null);
        try { await api(`/api/stages/${s.id}`, { method: "DELETE" }); reload(); toast("success", "Stage removed"); } catch (e) { setErr((e as Error).message); }
      }}>
        Remove “{removing?.name}” from this project? Stages with linked action points cannot be removed. This action is logged.
      </ConfirmDialog>
    </div>
  );
}
