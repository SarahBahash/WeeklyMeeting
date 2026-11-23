"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionPointDTO } from "@/lib/services/action-points";
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from "@/lib/domain";
import { api, ApiClientError, newRequestId } from "@/lib/client";
import { useAuth } from "./auth-context";
import { Alert, Button, Field, Modal } from "./ui";
import { ConflictDialog } from "./ConflictDialog";
import type { Meta } from "./hooks";

interface FormState {
  title: string;
  activityTypeId: string;
  projectId: string;
  projectStageId: string;
  currentStage: string;
  ownerName: string;
  originalTargetDate: string;
  revisedTargetDate: string;
  deadlineReason: string;
  priority: string;
  status: string;
  feedback: string;
  nextAction: string;
  blocker: string;
  restricted: boolean;
}

const fromDto = (a?: ActionPointDTO | null): FormState => ({
  title: a?.title ?? "",
  activityTypeId: a?.activityType?.id ?? "",
  projectId: a?.project?.id ?? "",
  projectStageId: a?.projectStage?.id ?? "",
  currentStage: a?.currentStage ?? "",
  ownerName: a?.ownerName ?? "",
  originalTargetDate: a?.originalTargetDate ?? "",
  revisedTargetDate: a?.revisedTargetDate ?? "",
  deadlineReason: "",
  priority: a?.priority ?? "",
  status: a?.status ?? "IN_PROGRESS",
  feedback: a?.feedback ?? "",
  nextAction: a?.nextAction ?? "",
  blocker: a?.blocker ?? "",
  restricted: a?.restricted ?? false,
});

/**
 * Create or edit an action point. In "meeting" mode the form posts to the meeting endpoint
 * so the new action is linked to the meeting (and optionally added to its agenda).
 */
export function ActionPointForm({ open, onClose, meta, initial, meetingId, onSaved }: {
  open: boolean;
  onClose: () => void;
  meta: Meta | null;
  initial?: ActionPointDTO | null;
  meetingId?: string;
  onSaved: (dto: ActionPointDTO) => void;
}) {
  const { can } = useAuth();
  const isEdit = Boolean(initial);
  const [f, setF] = useState<FormState>(fromDto(initial));
  const [includeInAgenda, setIncludeInAgenda] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<ActionPointDTO | null>(null);
  const requestId = useRef(newRequestId());

  useEffect(() => {
    if (open) {
      setF(fromDto(initial));
      setErrors({});
      setError(null);
      requestId.current = newRequestId();
    }
  }, [open, initial]);

  const type = meta?.activityTypes.find((t) => t.id === f.activityTypeId);
  const showStage = !type || type.supportsStages;
  const project = meta?.projects.find((p) => p.id === f.projectId);
  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(fromDto(initial)), [f, initial]);
  const originalLocked = isEdit && Boolean(initial?.originalTargetDate || initial?.originalTargetText) && !can("actionPoint:correctOriginalDate");
  const correctingOriginal = isEdit && Boolean(initial?.originalTargetDate) && f.originalTargetDate !== (initial?.originalTargetDate ?? "");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  function validate() {
    const e: Record<string, string> = {};
    if (!f.title.trim()) e.title = "Action point / project is required";
    if (correctingOriginal && !f.deadlineReason.trim()) e.deadlineReason = "A reason is required when correcting the original target date";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function body(): Record<string, unknown> {
    const base: Record<string, unknown> = {
      title: f.title.trim(),
      activityTypeId: f.activityTypeId || null,
      projectId: f.projectId || null,
      projectStageId: f.projectStageId || null,
      currentStage: showStage ? f.currentStage : null,
      ownerName: f.ownerName,
      originalTargetDate: f.originalTargetDate || null,
      priority: f.priority || null,
      status: f.status,
      feedback: f.feedback,
      nextAction: f.nextAction,
    };
    if (can("actionPoint:setRestricted")) base.restricted = f.restricted;
    if (!isEdit) return base;
    const init = fromDto(initial);
    const out: Record<string, unknown> = {};
    const full = { ...base, revisedTargetDate: f.revisedTargetDate || null, blocker: f.blocker };
    for (const [k, v] of Object.entries(full)) {
      const before = (init as unknown as Record<string, unknown>)[k];
      if ((v ?? "") !== (before ?? "")) out[k] = v;
    }
    if (originalLocked) delete out.originalTargetDate;
    if (f.deadlineReason.trim()) out.deadlineReason = f.deadlineReason.trim();
    return out;
  }

  async function submit(version?: number) {
    if (!validate()) return;
    setSaving(true);
    setError(null);
    try {
      let dto: ActionPointDTO;
      if (isEdit && initial) {
        const changes = body();
        const res = await api<{ actionPoint: ActionPointDTO }>(`/api/action-points/${initial.id}`, { method: "PATCH", body: { ...changes, version: version ?? initial.version } });
        dto = res.actionPoint;
      } else if (meetingId) {
        const res = await api<{ actionPoint: ActionPointDTO }>(`/api/meetings/${meetingId}/actions`, { body: { ...body(), includeInAgenda, clientRequestId: requestId.current } });
        dto = res.actionPoint;
      } else {
        const res = await api<{ actionPoint: ActionPointDTO }>("/api/action-points", { body: { ...body(), clientRequestId: requestId.current } });
        dto = res.actionPoint;
      }
      onSaved(dto);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 409 && e.data.conflict) setConflict(e.data.current as ActionPointDTO);
      else if (e instanceof ApiClientError && e.data.fieldErrors) {
        const fe: Record<string, string> = {};
        for (const x of e.data.fieldErrors as { path: string; message: string }[]) fe[x.path] = x.message;
        setErrors(fe);
        setError(e.message);
      } else setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const close = () => { if (!dirty || confirm("Discard unsaved changes?")) onClose(); };

  return (
    <>
      <Modal open={open} onClose={close} size="lg" title={isEdit ? "Edit action point" : meetingId ? "Add new action (during meeting)" : "New action point"} footer={<>
        <Button onClick={close} disabled={saving}>Cancel</Button>
        <Button variant="primary" loading={saving} onClick={() => submit()}>{isEdit ? "Save changes" : "Create action point"}</Button>
      </>}>
        <form className="grid grid-cols-1 gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          {error && <div className="md:col-span-2"><Alert>{error}</Alert></div>}
          <Field label="Action Point / Project *" htmlFor="f-title" error={errors.title} className="md:col-span-2">
            <input id="f-title" className="input" value={f.title} onChange={(e) => set("title", e.target.value)} maxLength={500} autoFocus />
          </Field>
          <Field label="Activity Type" htmlFor="f-type" hint={!f.activityTypeId ? "Leave unclassified if unsure – it can be classified later." : undefined}>
            <select id="f-type" className="input" value={f.activityTypeId} onChange={(e) => set("activityTypeId", e.target.value)}>
              <option value="">Unclassified</option>
              {meta?.activityTypes.filter((t) => t.isActive || t.id === f.activityTypeId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <Field label="Related Project (optional)" htmlFor="f-project">
            <select id="f-project" className="input" value={f.projectId} onChange={(e) => setF((s) => ({ ...s, projectId: e.target.value, projectStageId: "" }))}>
              <option value="">None</option>
              {meta?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          {showStage && (
            <>
              <Field label="Current Stage (optional)" htmlFor="f-stage">
                <input id="f-stage" className="input" list="f-stage-list" value={f.currentStage} onChange={(e) => set("currentStage", e.target.value)} maxLength={200} />
                <datalist id="f-stage-list">{meta?.stages.map((s) => <option key={s} value={s} />)}</datalist>
              </Field>
              {project && project.stages.length > 0 && (
                <Field label="Linked Audit Stage (optional)" htmlFor="f-pstage">
                  <select id="f-pstage" className="input" value={f.projectStageId} onChange={(e) => set("projectStageId", e.target.value)}>
                    <option value="">None</option>
                    {project.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
          <Field label="Process Owner" htmlFor="f-owner">
            <input id="f-owner" className="input" list="f-owner-list" value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} maxLength={200} />
            <datalist id="f-owner-list">{meta?.owners.map((o) => <option key={o} value={o} />)}</datalist>
          </Field>
          <Field label="Priority" htmlFor="f-priority">
            <select id="f-priority" className="input" value={f.priority} onChange={(e) => set("priority", e.target.value)}>
              <option value="">Not set</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
            </select>
          </Field>
          <Field label="Status" htmlFor="f-status">
            <select id="f-status" className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label={isEdit ? "Original Target Date" : "Target Date"} htmlFor="f-target"
            hint={originalLocked ? "Only administrators can correct an original target date. Use the Revised Date instead." : isEdit && initial?.originalTargetText ? `Imported value: "${initial.originalTargetText}"` : undefined}>
            <input id="f-target" type="date" className="input" value={f.originalTargetDate} disabled={originalLocked} onChange={(e) => set("originalTargetDate", e.target.value)} />
          </Field>
          {isEdit && (
            <Field label="Revised Target Date" htmlFor="f-revised" hint={initial?.revisedTargetText ? `Imported value: "${initial.revisedTargetText}"` : "Each change is recorded in the deadline history."}>
              <input id="f-revised" type="date" className="input" value={f.revisedTargetDate} onChange={(e) => set("revisedTargetDate", e.target.value)} />
            </Field>
          )}
          {isEdit && (f.revisedTargetDate !== (initial?.revisedTargetDate ?? "") || correctingOriginal) && (
            <Field label={correctingOriginal ? "Reason for correcting the original date *" : "Reason for deadline change (optional)"} htmlFor="f-reason" error={errors.deadlineReason} className="md:col-span-2">
              <input id="f-reason" className="input" value={f.deadlineReason} onChange={(e) => set("deadlineReason", e.target.value)} maxLength={500} />
            </Field>
          )}
          <Field label={isEdit ? "Feedback" : "Initial Feedback"} htmlFor="f-feedback" className="md:col-span-2" hint={isEdit ? "Previous feedback is preserved in the history." : undefined}>
            <textarea id="f-feedback" className="input min-h-[96px]" value={f.feedback} onChange={(e) => set("feedback", e.target.value)} maxLength={10000} />
          </Field>
          <Field label="Next Action (optional)" htmlFor="f-next" className={isEdit ? "" : "md:col-span-2"}>
            <input id="f-next" className="input" value={f.nextAction} onChange={(e) => set("nextAction", e.target.value)} maxLength={2000} />
          </Field>
          {isEdit && (
            <Field label="Notes / Blocker (optional)" htmlFor="f-blocker">
              <input id="f-blocker" className="input" value={f.blocker} onChange={(e) => set("blocker", e.target.value)} maxLength={2000} />
            </Field>
          )}
          {can("actionPoint:setRestricted") && (
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" checked={f.restricted} onChange={(e) => set("restricted", e.target.checked)} className="h-4 w-4 accent-brand" />
              Restricted – visible to administrators only
            </label>
          )}
          {meetingId && !isEdit && (
            <label className="flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" checked={includeInAgenda} onChange={(e) => setIncludeInAgenda(e.target.checked)} className="h-4 w-4 accent-brand" />
              Add to the current meeting agenda
            </label>
          )}
          <button type="submit" className="hidden" />
        </form>
      </Modal>
      <ConflictDialog open={Boolean(conflict)} current={conflict} mine={body()} onClose={() => setConflict(null)}
        onReload={() => { setConflict(null); onClose(); if (conflict) onSaved(conflict); }}
        onReapply={() => { const v = conflict?.version; setConflict(null); submit(v); }} />
    </>
  );
}
