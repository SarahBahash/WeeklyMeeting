"use client";
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { STATUSES, STATUS_LABEL } from "@/lib/domain";
import { formatDate, formatDateTime } from "@/lib/dates";
import { download } from "@/lib/client";
import { useAuth } from "@/components/auth-context";
import { useLoad } from "@/components/hooks";
import { useToast } from "@/components/toast";
import { Alert, Button, Card, Field, PageHeader, cx } from "@/components/ui";

type ExportType = "FULL_TRACKER" | "SELECTED_STATUS" | "WEEKLY" | "HISTORICAL";

export function ExportsView() {
  const { can } = useAuth();
  const toast = useToast();
  const meetings = useLoad<{ meetings: { id: string; meetingDate: string; status: string }[] }>("/api/meetings");
  const log = useLoad<{ logs: { id: string; reportType: string; fileName: string; rowCount: number; user: string; createdAt: string }[] }>("/api/exports/log");
  const [type, setType] = useState<ExportType>("FULL_TRACKER");
  const [status, setStatus] = useState<string>("ALL");
  const [separate, setSeparate] = useState(false);
  const [original, setOriginal] = useState(false);
  const [web, setWeb] = useState(true);
  const [hist, setHist] = useState(false);
  const [dl, setDl] = useState(false);
  const [stages, setStages] = useState(false);
  const [meetingId, setMeetingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ms = meetings.data?.meetings ?? [];
  const weekly = ms.filter((m) => m.status === "DRAFT").concat(ms.filter((m) => m.status !== "DRAFT").slice(0, 1));
  const meetingOptions = type === "WEEKLY" ? weekly : ms;
  const isMeeting = type === "WEEKLY" || type === "HISTORICAL";

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const body = isMeeting
        ? { type: "MEETING", meetingId: meetingId || meetingOptions[0]?.id }
        : { type, status: type === "FULL_TRACKER" ? "ALL" : status, separateSheets: separate, useOriginalStatus: original, includeWebsiteFields: web, includeUpdateHistory: hist, includeDeadlineHistory: dl, includeAuditStages: stages };
      if (isMeeting && !body.meetingId) throw new Error("There is no meeting to export yet.");
      const name = await download("/api/exports", body);
      toast("success", `Downloaded ${name}`);
      log.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const TYPES: { id: ExportType; label: string; desc: string }[] = [
    { id: "FULL_TRACKER", label: "Full Tracker", desc: "Every authorised action point, all statuses." },
    { id: "SELECTED_STATUS", label: "Selected Status", desc: "Only the status you choose – nothing else." },
    { id: "WEEKLY", label: "Weekly Meeting", desc: "The current / latest meeting with agenda, updates and summary." },
    { id: "HISTORICAL", label: "Historical Meeting", desc: "Any past meeting exactly as recorded at the time." },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Excel Reports" description="Generates genuine Microsoft Excel (.xlsx) workbooks on the server with formatted headers, filters and frozen header rows." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-6">
          <h2 className="label">Export type</h2>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
            {TYPES.map((t) => (
              <button key={t.id} role="radio" aria-checked={type === t.id} onClick={() => { setType(t.id); setMeetingId(""); }}
                className={cx("rounded-lg border p-3 text-left", type === t.id ? "border-brand bg-brand-light/50 ring-1 ring-brand" : "border-line hover:bg-navy-50")}>
                <div className="text-sm font-semibold">{t.label}</div>
                <div className="text-xs text-muted">{t.desc}</div>
              </button>
            ))}
          </div>

          {!isMeeting && (
            <div className="mt-6 space-y-4">
              {type === "SELECTED_STATUS" && (
                <Field label="Status filter" htmlFor="x-status">
                  <select id="x-status" className="input max-w-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="ALL">All Statuses</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </Field>
              )}
              <div className="space-y-2 text-sm">
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={separate} onChange={(e) => setSeparate(e.target.checked)} /><span><strong>Separate each status into its own Excel sheet</strong><span className="block text-xs text-muted">One workbook with a worksheet per status (empty statuses get a sheet stating no records were found).</span></span></label>
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={web} onChange={(e) => setWeb(e.target.checked)} /><span>Include website fields after the original columns<span className="block text-xs text-muted">Activity Type, Related Project, Effective Deadline, Overdue Days, Last Updated, Latest Meeting Date, Created/Updated By…</span></span></label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand" checked={hist} onChange={(e) => setHist(e.target.checked)} /> Add “Update History” worksheet</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand" checked={dl} onChange={(e) => setDl(e.target.checked)} /> Add “Deadline Change History” worksheet</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-brand" checked={stages} onChange={(e) => setStages(e.target.checked)} /> Add “Audit Stages” worksheet</label>
                {can("export:originalStatus") && (
                  <label className="flex items-start gap-2 rounded-md border border-line p-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand" checked={original} onChange={(e) => setOriginal(e.target.checked)} /><span>Use original imported status values (administrator)<span className="block text-xs text-muted">Distinguishes legacy values such as “Complete” vs “Completed”. With separate sheets, one sheet per original value.</span></span></label>
                )}
              </div>
            </div>
          )}
          {isMeeting && (
            <div className="mt-6">
              <Field label="Meeting" htmlFor="x-meeting" hint="Historical meetings are exported exactly as recorded – today’s values never replace them.">
                <select id="x-meeting" className="input max-w-sm" value={meetingId || meetingOptions[0]?.id || ""} onChange={(e) => setMeetingId(e.target.value)}>
                  {meetingOptions.length === 0 && <option value="">No meetings yet</option>}
                  {meetingOptions.map((m) => <option key={m.id} value={m.id}>{formatDate(m.meetingDate)}{m.status === "DRAFT" ? " (draft – in progress)" : ""}</option>)}
                </select>
              </Field>
            </div>
          )}
          {error && <div className="mt-4"><Alert>{error}</Alert></div>}
          <div className="mt-6 flex items-center gap-3 border-t border-line pt-5">
            <Button variant="primary" size="lg" loading={busy} onClick={run} icon={<FileSpreadsheet className="h-5 w-5" />}>Download Excel (.xlsx)</Button>
            <span className="text-xs text-muted">Every export is logged with your name and the report parameters.</span>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="label">Recent exports</h2>
          {log.data?.logs.length ? (
            <ul className="space-y-2.5 text-sm">
              {log.data.logs.map((l) => (
                <li key={l.id}>
                  <div className="truncate font-medium" title={l.fileName}>{l.fileName}</div>
                  <div className="text-xs text-muted">{l.user} · {formatDateTime(l.createdAt)} · {l.rowCount} rows</div>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted">No exports yet.</p>}
        </Card>
      </div>
    </div>
  );
}
