"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client";
import { useLoad } from "@/components/hooks";
import { useToast } from "@/components/toast";
import { Alert, Badge, Button, Card, EmptyState, Spinner } from "@/components/ui";

interface Rec {
  id: string; sourceSheet: string; sourceRow: number; actionText: string | null; projectText: string | null; ownerText: string | null;
  meetingDateRaw: string | null; targetDateRaw: string | null; revisedDateRaw: string | null; statusRaw: string | null; feedback: string | null;
  decision: "PENDING" | "RETAIN" | "MERGE" | "SKIP"; linkedActionPoint: { id: string; title: string } | null;
  candidates: { id: string; title: string; ownerName: string | null; score: number }[];
}

export function LegacyPanel() {
  const toast = useToast();
  const [filter, setFilter] = useState("PENDING");
  const { data, error, loading, reload } = useLoad<{ records: Rec[] }>(`/api/admin/legacy?decision=${filter}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({});

  async function decide(r: Rec, decision: string) {
    setBusy(r.id);
    try {
      await api(`/api/admin/legacy/${r.id}`, { body: { decision, actionPointId: decision === "MERGE" ? mergeTarget[r.id] ?? r.candidates[0]?.id : undefined } });
      toast("success", decision === "RETAIN" ? "Retained as a separate action point" : decision === "MERGE" ? "Linked to the existing action point's history" : "Decision saved");
      reload();
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Alert tone="info">
        Rows from the older historical tracker (IA-MOM (2)) are preserved verbatim and are <strong>never merged automatically</strong>.
        For each row choose: <strong>Merge</strong> – attach it to the history of an existing action point; <strong>Retain separately</strong> – create its own action point; or <strong>Skip</strong> – keep the raw row for reference only.
      </Alert>
      <div className="flex gap-1 text-xs">
        {["PENDING", "MERGE", "RETAIN", "SKIP", ""].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 ${filter === f ? "border-brand bg-brand text-white" : "border-line"}`}>{f ? f.charAt(0) + f.slice(1).toLowerCase() : "All"}</button>
        ))}
      </div>
      {error && <Alert>{error}</Alert>}
      {loading && !data && <Spinner />}
      {data && (data.records.length === 0 ? <Card><EmptyState title="No historical records in this view">Import the IA-MOM (2) sheet from the Import Data tab.</EmptyState></Card> : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead><tr><th className="th">Row</th><th className="th">Action points / Project</th><th className="th">Owner</th><th className="th">Meeting</th><th className="th">Status</th><th className="th">Feedback</th><th className="th min-w-[300px]">Decision</th></tr></thead>
              <tbody>
                {data.records.map((r) => (
                  <tr key={r.id}>
                    <td className="td text-xs text-muted">{r.sourceRow}</td>
                    <td className="td"><div className="font-medium">{r.actionText}</div>{r.projectText && <div className="text-xs text-muted">{r.projectText}</div>}</td>
                    <td className="td text-xs">{r.ownerText}</td>
                    <td className="td text-xs">{r.meetingDateRaw}</td>
                    <td className="td text-xs">{r.statusRaw}</td>
                    <td className="td max-w-xs text-xs">{r.feedback}</td>
                    <td className="td">
                      {r.decision === "PENDING" || r.decision === "SKIP" ? (
                        <div className="space-y-2">
                          {r.decision === "SKIP" && <Badge>Skipped</Badge>}
                          {r.candidates.length > 0 && (
                            <div className="flex gap-1">
                              <select className="input py-1 text-xs" aria-label="Merge target" value={mergeTarget[r.id] ?? r.candidates[0].id} onChange={(e) => setMergeTarget({ ...mergeTarget, [r.id]: e.target.value })}>
                                {r.candidates.map((c) => <option key={c.id} value={c.id}>{c.title} ({Math.round(c.score * 100)}%)</option>)}
                              </select>
                              <Button size="sm" loading={busy === r.id} onClick={() => decide(r, "MERGE")}>Merge</Button>
                            </div>
                          )}
                          <div className="flex gap-1">
                            <Button size="sm" loading={busy === r.id} onClick={() => decide(r, "RETAIN")}>Retain separately</Button>
                            {r.decision !== "SKIP" && <Button size="sm" variant="ghost" loading={busy === r.id} onClick={() => decide(r, "SKIP")}>Skip</Button>}
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs">
                          <Badge tone="green">{r.decision === "MERGE" ? "Merged" : "Retained"}</Badge>
                          {r.linkedActionPoint && <div className="mt-1"><Link className="link" href={`/action-points/${r.linkedActionPoint.id}`}>{r.linkedActionPoint.title}</Link></div>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
