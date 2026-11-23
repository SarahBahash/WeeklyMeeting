"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { api } from "@/lib/client";
import { formatDateTime } from "@/lib/dates";
import { useAuth } from "@/components/auth-context";
import { useLoad } from "@/components/hooks";
import { useToast } from "@/components/toast";
import { Alert, Badge, Button, Card, Field, Modal, Spinner } from "@/components/ui";

interface U { id: string; email: string; name: string; role: "ADMIN" | "EDITOR" | "VIEWER"; canOrganizeMeetings: boolean; isActive: boolean; ssoLinked: boolean; hasLocalPassword: boolean; lastLoginAt: string | null }

export function UsersPanel() {
  const { user: me } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useLoad<{ users: U[]; localAuthEnabled: boolean }>("/api/admin/users");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "VIEWER", canOrganizeMeetings: false, password: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function update(u: U, body: Record<string, unknown>) {
    try {
      await api(`/api/admin/users/${u.id}`, { method: "PATCH", body });
      toast("success", `Updated ${u.name}`);
      reload();
    } catch (e) {
      toast("error", (e as Error).message);
    }
  }
  async function create() {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/admin/users", { body: { ...form, password: form.password || undefined } });
      setCreating(false);
      reload();
      toast("success", "User added");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error}</Alert>;
  return (
    <div className="space-y-4">
      <Alert tone="info">There is no public sign-up. Users sign in with company SSO and must be added here first; their SSO identity is linked on first sign-in by email. Role changes and deactivation end the user’s active sessions immediately.</Alert>
      <div className="flex justify-end"><Button variant="primary" icon={<UserPlus className="h-4 w-4" />} onClick={() => { setForm({ email: "", name: "", role: "VIEWER", canOrganizeMeetings: false, password: "" }); setCreating(true); }}>Add user</Button></div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Role</th><th className="th">Meeting organizer</th><th className="th">Status</th><th className="th">Sign-in</th><th className="th">Last sign-in</th></tr></thead>
            <tbody>
              {data?.users.map((u) => (
                <tr key={u.id} className={u.isActive ? "" : "opacity-60"}>
                  <td className="td font-medium">{u.name}{u.id === me.id && <span className="ml-1 text-xs text-muted">(you)</span>}</td>
                  <td className="td text-sm">{u.email}</td>
                  <td className="td">
                    <select className="input py-1" aria-label={`Role for ${u.name}`} value={u.role} onChange={(e) => update(u, { role: e.target.value })}>
                      <option value="ADMIN">Admin</option><option value="EDITOR">Editor</option><option value="VIEWER">Viewer</option>
                    </select>
                  </td>
                  <td className="td">
                    {u.role === "ADMIN" ? <span className="text-xs text-muted">Always</span> : (
                      <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" disabled={u.role === "VIEWER"} checked={u.canOrganizeMeetings} onChange={(e) => update(u, { canOrganizeMeetings: e.target.checked })} /> Organizer</label>
                    )}
                  </td>
                  <td className="td"><button className="text-sm" onClick={() => update(u, { isActive: !u.isActive })}>{u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}</button></td>
                  <td className="td text-xs text-muted">{u.ssoLinked ? "SSO linked" : "SSO pending"}{u.hasLocalPassword && data.localAuthEnabled ? " · dev password" : ""}</td>
                  <td className="td text-xs text-muted">{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Modal open={creating} onClose={() => setCreating(false)} title="Add user" footer={<><Button onClick={() => setCreating(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={create}>Add user</Button></>}>
        {err && <div className="mb-3"><Alert>{err}</Alert></div>}
        <div className="grid gap-3">
          <Field label="Name *" htmlFor="nu-name"><input id="nu-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Work email (must match SSO) *" htmlFor="nu-email"><input id="nu-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role" htmlFor="nu-role">
            <select id="nu-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="VIEWER">Viewer – read only</option><option value="EDITOR">Editor – update actions, take part in meetings, export</option><option value="ADMIN">Admin – full administration</option>
            </select>
          </Field>
          {form.role === "EDITOR" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={form.canOrganizeMeetings} onChange={(e) => setForm({ ...form, canOrganizeMeetings: e.target.checked })} /> Can organize meetings (start, reorder, finish)</label>}
          {data?.localAuthEnabled && <Field label="Development password (optional)" htmlFor="nu-pw" hint="Development environments only. Production uses SSO exclusively."><input id="nu-pw" type="password" className="input" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>}
        </div>
      </Modal>
    </div>
  );
}
