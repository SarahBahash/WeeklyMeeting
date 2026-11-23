"use client";
import { useState } from "react";
import { api } from "@/lib/client";
import { formatDateTime } from "@/lib/dates";
import { useLoad, useMeta } from "@/components/hooks";
import { useToast } from "@/components/toast";
import { Alert, Badge, Button, Card, Spinner } from "@/components/ui";

export function AuditLogPanel() {
  const [action, setAction] = useState("");
  const { data, error, loading } = useLoad<{ logs: { id: string; actorEmail: string | null; action: string; entityType: string | null; entityId: string | null; details: unknown; ip: string | null; createdAt: string }[] }>(`/api/admin/audit-log?action=${encodeURIComponent(action)}`);
  return (
    <div className="space-y-3">
      <Alert tone="info">Technical and security events (sign-ins, imports, exports, administration). This log is append-only at the database level and cannot be edited or deleted from the application. Business change history is kept separately per action point.</Alert>
      <select className="input max-w-xs" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by event type">
        <option value="">All events</option>
        <option value="auth">Authentication</option><option value="import">Import</option><option value="export">Export</option>
        <option value="meeting">Meetings</option><option value="user">Users</option><option value="template">Templates</option>
      </select>
      {error && <Alert>{error}</Alert>}
      {loading && !data && <Spinner />}
      {data && (
        <Card>
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full min-w-[900px]">
              <thead><tr><th className="th">Time (Riyadh)</th><th className="th">User</th><th className="th">Event</th><th className="th">Entity</th><th className="th">Details</th><th className="th">IP</th></tr></thead>
              <tbody>
                {data.logs.map((l) => (
                  <tr key={l.id}>
                    <td className="td whitespace-nowrap text-xs">{formatDateTime(l.createdAt)}</td>
                    <td className="td text-xs">{l.actorEmail ?? <span className="text-muted">anonymous</span>}</td>
                    <td className="td"><Badge tone={l.action.includes("fail") || l.action.includes("denied") || l.action.includes("rejected") ? "red" : "neutral"}>{l.action}</Badge></td>
                    <td className="td text-xs text-muted">{l.entityType ?? ""}</td>
                    <td className="td max-w-md truncate font-mono text-[11px] text-muted" title={JSON.stringify(l.details)}>{l.details ? JSON.stringify(l.details) : ""}</td>
                    <td className="td text-xs text-muted">{l.ip ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export function ActivityTypesPanel() {
  const toast = useToast();
  const { meta, reload } = useMeta();
  const [name, setName] = useState("");
  const [stages, setStages] = useState(false);
  async function save(body: Record<string, unknown>) {
    try {
      await api("/api/admin/activity-types", { body });
      reload();
      setName("");
      toast("success", "Activity type saved");
    } catch (e) {
      toast("error", (e as Error).message);
    }
  }
  if (!meta) return <Spinner />;
  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <table className="w-full">
          <thead><tr><th className="th">Activity type</th><th className="th">Audit stages</th><th className="th">Status</th></tr></thead>
          <tbody>
            {meta.activityTypes.map((t) => (
              <tr key={t.id}>
                <td className="td font-medium">{t.name}</td>
                <td className="td"><label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={t.supportsStages} onChange={(e) => save({ id: t.id, name: t.name, supportsStages: e.target.checked, isActive: t.isActive })} /> Show stage controls</label></td>
                <td className="td"><button onClick={() => save({ id: t.id, name: t.name, supportsStages: t.supportsStages, isActive: !t.isActive })}>{t.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="flex-1 text-xs text-muted">New activity type<input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={stages} onChange={(e) => setStages(e.target.checked)} /> Uses audit stages</label>
        <Button variant="primary" disabled={name.trim().length < 2} onClick={() => save({ name, supportsStages: stages })}>Add</Button>
      </Card>
    </div>
  );
}
