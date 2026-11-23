"use client";
import Link from "next/link";
import { useState } from "react";
import { FolderPlus, Milestone } from "lucide-react";
import { api } from "@/lib/client";
import { useAuth } from "@/components/auth-context";
import { useLoad } from "@/components/hooks";
import { useToast } from "@/components/toast";
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Spinner, cx } from "@/components/ui";
import { TemplatesPanel, type Template } from "./TemplatesPanel";

interface ProjectRow { id: string; name: string; description: string | null; isAudit: boolean; actionPointCount: number; stages: { id: string; name: string; status: string; partName: string | null }[] }

export function AuditsView() {
  const { can } = useAuth();
  const toast = useToast();
  const projects = useLoad<{ projects: ProjectRow[] }>("/api/projects");
  const templates = useLoad<{ templates: Template[] }>("/api/templates");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", isAudit: true, templateId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api("/api/projects", { body: { ...form, templateId: form.templateId || undefined } });
      setCreating(false);
      projects.reload();
      toast("success", "Project created");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Audit Reviews & Stages" description="Audit lifecycle tracking per project. Stages are optional – non-audit activities work without them."
        actions={can("stage:write") && <Button variant="primary" icon={<FolderPlus className="h-4 w-4" />} onClick={() => { setForm({ name: "", description: "", isAudit: true, templateId: templates.data?.templates.find((t) => t.isDefault)?.id ?? "" }); setCreating(true); }}>New project</Button>} />
      {projects.error && <Alert>{projects.error}</Alert>}
      {projects.loading && !projects.data && <Spinner />}
      {projects.data && (projects.data.projects.length === 0 ? (
        <Card><EmptyState title="No projects yet" icon={<Milestone className="h-8 w-8" />}>Create a project for each audit review to track its lifecycle stages, then link action points to it.</EmptyState></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.data.projects.map((p) => {
            const done = p.stages.filter((s) => s.status === "COMPLETED" || s.status === "NOT_APPLICABLE").length;
            const active = p.stages.filter((s) => s.status === "IN_PROGRESS");
            return (
              <Link key={p.id} href={`/audits/${p.id}`} className="card block p-5 shadow-card transition hover:border-brand/40">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{p.name}</h3>
                  {p.isAudit ? <Badge tone="navy">Audit</Badge> : <Badge>Project</Badge>}
                </div>
                {p.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{p.description}</p>}
                {p.stages.length > 0 ? (
                  <>
                    <div className="mt-4 flex gap-0.5" aria-label={`${done} of ${p.stages.length} stages complete`}>
                      {p.stages.map((s) => <span key={s.id} title={`${s.name} – ${s.status.replace("_", " ").toLowerCase()}`} className={cx("h-2 flex-1 rounded-sm", s.status === "COMPLETED" ? "bg-brand" : s.status === "IN_PROGRESS" ? "bg-warn" : s.status === "NOT_APPLICABLE" ? "bg-line" : "bg-navy-50 ring-1 ring-inset ring-line")} />)}
                    </div>
                    <p className="mt-2 text-xs text-muted">{done} of {p.stages.length} stages complete{active.length ? ` · Active: ${active.map((s) => s.name).join(", ")}` : ""}</p>
                  </>
                ) : <p className="mt-4 text-xs text-muted">No stages configured</p>}
                <p className="mt-2 text-xs text-muted">{p.actionPointCount} linked action point(s)</p>
              </Link>
            );
          })}
        </div>
      ))}
      <div className="mt-10">
        <TemplatesPanel templates={templates.data?.templates ?? null} onChanged={templates.reload} />
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="New project" footer={<><Button onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" loading={busy} disabled={form.name.trim().length < 2} onClick={create}>Create project</Button></>}>
        {error && <div className="mb-3"><Alert>{error}</Alert></div>}
        <div className="space-y-3">
          <Field label="Project name *" htmlFor="p-name"><input id="p-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={200} /></Field>
          <Field label="Description" htmlFor="p-desc"><textarea id="p-desc" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={form.isAudit} onChange={(e) => setForm({ ...form, isAudit: e.target.checked })} /> This is an audit review</label>
          <Field label="Stage template" htmlFor="p-tpl" hint="Stages are copied into the project and can be edited, added or removed afterwards.">
            <select id="p-tpl" className="input" value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
              <option value="">No stages</option>
              {templates.data?.templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.stages.length} stages)</option>)}
            </select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
