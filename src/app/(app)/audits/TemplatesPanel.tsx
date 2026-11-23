"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/client";
import { useAuth } from "@/components/auth-context";
import { useToast } from "@/components/toast";
import { Alert, Badge, Button, Card, Field, Modal } from "@/components/ui";

export interface Template { id: string; name: string; description: string | null; isDefault: boolean; sourceNote: string | null; stages: { id: string; partNumber: number; partName: string; name: string; sortOrder: number }[] }
type StageRow = { partNumber: number; partName: string; name: string };

export function TemplatesPanel({ templates, onChanged }: { templates: Template[] | null; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState<{ id: string | null; name: string; description: string; isDefault: boolean; stages: StageRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const admin = can("admin:templates");

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name: editing.name, description: editing.description, isDefault: editing.isDefault, stages: editing.stages.filter((s) => s.name.trim()) };
      if (editing.id) await api(`/api/templates/${editing.id}`, { method: "PUT", body });
      else await api("/api/templates", { body });
      setEditing(null);
      onChanged();
      toast("success", "Template saved");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const upd = (i: number, patch: Partial<StageRow>) => setEditing((e) => e && { ...e, stages: e.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const mv = (i: number, d: number) => setEditing((e) => {
    if (!e || i + d < 0 || i + d >= e.stages.length) return e;
    const st = [...e.stages];
    [st[i], st[i + d]] = [st[i + d], st[i]];
    return { ...e, stages: st };
  });

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Audit stage templates</h2>
          <p className="text-sm text-muted">Configurable blueprints. Templates are never enforced – each project keeps its own editable copy.</p>
        </div>
        {admin && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ id: null, name: "", description: "", isDefault: false, stages: [{ partNumber: 1, partName: "Planning and Understanding", name: "" }] })}>New template</Button>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {templates?.map((t) => {
          const parts = [...new Map(t.stages.map((s) => [s.partNumber, s.partName])).entries()];
          return (
            <Card key={t.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{t.name} {t.isDefault && <Badge tone="green">Default</Badge>}</h3>
                  {t.description && <p className="mt-0.5 text-xs text-muted">{t.description}</p>}
                </div>
                {admin && <Button size="sm" variant="ghost" onClick={() => setEditing({ id: t.id, name: t.name, description: t.description ?? "", isDefault: t.isDefault, stages: t.stages.map((s) => ({ partNumber: s.partNumber, partName: s.partName, name: s.name })) })}>Edit</Button>}
              </div>
              <div className="mt-3 space-y-3">
                {parts.map(([num, name]) => (
                  <div key={num}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-brand">Part {num} – {name}</div>
                    <ol className="mt-1 grid grid-cols-1 gap-x-4 text-sm sm:grid-cols-2">
                      {t.stages.filter((s) => s.partNumber === num).map((s) => <li key={s.id} className="py-0.5"><span className="mr-1.5 text-xs text-muted">{s.sortOrder}.</span>{s.name}</li>)}
                    </ol>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? "Edit stage template" : "New stage template"} size="lg" footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save template</Button></>}>
          {error && <div className="mb-3"><Alert>{error}</Alert></div>}
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name *" htmlFor="t-name"><input id="t-name" className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Description" htmlFor="t-desc"><input id="t-desc" className="input" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm md:col-span-2"><input type="checkbox" className="h-4 w-4 accent-brand" checked={editing.isDefault} onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })} /> Default template for new audits</label>
          </div>
          <table className="mt-4 w-full">
            <thead><tr><th className="th w-16">Part #</th><th className="th">Part name</th><th className="th">Stage</th><th className="th w-28"></th></tr></thead>
            <tbody>
              {editing.stages.map((s, i) => (
                <tr key={i}>
                  <td className="td"><input type="number" min={1} max={20} className="input px-2 py-1" aria-label="Part number" value={s.partNumber} onChange={(e) => upd(i, { partNumber: Number(e.target.value) || 1 })} /></td>
                  <td className="td"><input className="input py-1" aria-label="Part name" value={s.partName} onChange={(e) => upd(i, { partName: e.target.value })} /></td>
                  <td className="td"><input className="input py-1" aria-label="Stage name" value={s.name} onChange={(e) => upd(i, { name: e.target.value })} /></td>
                  <td className="td">
                    <div className="flex gap-1">
                      <button className="rounded p-1 hover:bg-navy-50" onClick={() => mv(i, -1)} aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
                      <button className="rounded p-1 hover:bg-navy-50" onClick={() => mv(i, 1)} aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
                      <button className="rounded p-1 text-danger hover:bg-danger-light" onClick={() => setEditing({ ...editing, stages: editing.stages.filter((_, j) => j !== i) })} aria-label="Remove stage"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button size="sm" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => { const last = editing.stages.at(-1); setEditing({ ...editing, stages: [...editing.stages, { partNumber: last?.partNumber ?? 1, partName: last?.partName ?? "", name: "" }] }); }}>Add stage (e.g. Testing Phase)</Button>
        </Modal>
      )}
    </section>
  );
}
