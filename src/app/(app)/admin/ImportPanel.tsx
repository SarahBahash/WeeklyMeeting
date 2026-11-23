"use client";
import { useMemo, useRef, useState } from "react";
import { FileUp, RefreshCw } from "lucide-react";
import { api, ApiClientError } from "@/lib/client";
import { formatDateTime, formatDate } from "@/lib/dates";
import { STATUS_LABEL, type Status } from "@/lib/domain";
import { MAIN_FIELD_LABELS, HIST_FIELD_LABELS, type MainRow, type HistRow, type ParsedStagePart } from "@/lib/import/parsers";
import { useLoad } from "@/components/hooks";
import { useToast } from "@/components/toast";
import { Alert, Badge, Button, Card, ConfirmDialog, Field, cx } from "@/components/ui";

type Kind = "MAIN_TRACKER" | "HISTORICAL" | "STAGE_TEMPLATE";
interface Preview {
  batchId: string; kind: Kind; fileName: string; sheets: string[]; sheetName: string; headerRow: number | null; titleText: string | null;
  headers: { col: number; text: string }[]; mapping: Record<string, number | null>; previouslyCommitted: { batchId: string; committedAt: string | null }[];
  rows: (MainRow | HistRow)[]; stages?: ParsedStagePart[]; issues: { level: string; message: string }[]; stats: Record<string, number>;
}

const KIND_INFO: Record<Kind, { label: string; desc: string; sheet: string }> = {
  MAIN_TRACKER: { label: "Main tracker", desc: "Sheet IA-MOM – becomes the action-point tracker.", sheet: "IA-MOM" },
  HISTORICAL: { label: "Historical tracker", desc: "Sheet IA-MOM (2) – stored for review; never merged automatically.", sheet: "IA-MOM (2)" },
  STAGE_TEMPLATE: { label: "Audit stage template", desc: "Sheet1 – creates a configurable stage template.", sheet: "Sheet1" },
};

export function ImportPanel({ onGoLegacy }: { onGoLegacy: () => void }) {
  const toast = useToast();
  const batches = useLoad<{ batches: { id: string; kind: string; status: string; fileName: string; sheetName: string; fileSha256: string; createdAt: string; committedAt: string | null; summary: Record<string, unknown> | null; uploadedBy: string }[] }>("/api/admin/import");
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<Kind>("MAIN_TRACKER");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [decisions, setDecisions] = useState<Record<string, "import" | "skip">>({});
  const [templateName, setTemplateName] = useState("");
  const [rowFilter, setRowFilter] = useState<"all" | "issues" | "duplicates" | "excluded">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: Kind; summary: Record<string, unknown>; alreadyCommitted: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function upload(opts: { sheetName?: string; mapping?: Record<string, number | null> } = {}) {
    if (!file) return;
    setBusy("upload");
    setError(null);
    setResult(null);
    const form = new FormData();
    form.set("file", file);
    form.set("kind", kind);
    if (opts.sheetName) form.set("sheetName", opts.sheetName);
    if (opts.mapping) form.set("mapping", JSON.stringify(opts.mapping));
    try {
      const p = await api<Preview>("/api/admin/import", { form });
      setPreview(p);
      setMapping(p.mapping);
      setDecisions({});
      setTemplateName("");
      batches.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (!preview) return;
    setConfirming(false);
    setBusy("commit");
    setError(null);
    try {
      const r = await api<{ alreadyCommitted: boolean; summary: Record<string, unknown> }>(`/api/admin/import/${preview.batchId}/commit`, { body: { decisions, templateName: templateName.trim() || undefined } });
      setResult({ kind: preview.kind, ...r });
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      batches.reload();
      toast("success", r.alreadyCommitted ? "This import was already completed – nothing was duplicated." : "Import completed");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!preview) return;
    try { await api(`/api/admin/import/${preview.batchId}/cancel`, { body: {} }); } catch { /* already cancelled */ }
    setPreview(null);
    batches.reload();
  }

  const dataRows = useMemo(() => (preview?.rows ?? []).filter((r) => r.kind === "data") as MainRow[], [preview]);
  const decisionOf = (r: MainRow) => (r.alreadyImported ? "skip" : decisions[r.rowNumber] ?? r.suggested);
  const toImport = preview?.kind === "MAIN_TRACKER" ? dataRows.filter((r) => decisionOf(r) === "import") : [];
  const inProgressToImport = toImport.filter((r) => r.parsed?.status === "IN_PROGRESS").length;
  const visibleRows = (preview?.rows ?? []).filter((r) => {
    if (rowFilter === "all") return r.kind !== "blank";
    if (rowFilter === "issues") return r.issues.some((i) => i.level !== "info") || r.kind === "invalid";
    if (rowFilter === "duplicates") return Boolean((r as MainRow).duplicateOf?.length || (r as HistRow).candidates?.length || r.alreadyImported);
    return r.kind !== "data" || (preview?.kind === "MAIN_TRACKER" && decisionOf(r as MainRow) === "skip");
  });
  const fieldLabels: Record<string, string> = preview?.kind === "HISTORICAL" ? HIST_FIELD_LABELS : MAIN_FIELD_LABELS;
  const blockingErrors = preview?.issues.filter((i) => i.level === "error") ?? [];

  return (
    <div className="space-y-6">
      <Alert tone="warning">
        Until the hosting environment and data handling have been approved by IT and Information Security, import <strong>synthetic test data only</strong>.
        The real workbook must not be uploaded to an unapproved environment.
      </Alert>

      {!preview && (
        <Card className="p-6">
          <h2 className="text-base font-semibold">1. Choose what to import</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {(Object.keys(KIND_INFO) as Kind[]).map((k) => (
              <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={cx("rounded-lg border p-3 text-left", kind === k ? "border-brand bg-brand-light/50 ring-1 ring-brand" : "border-line hover:bg-navy-50")}>
                <div className="text-sm font-semibold">{KIND_INFO[k].label}</div>
                <div className="text-xs text-muted">{KIND_INFO[k].desc}</div>
              </button>
            ))}
          </div>
          <h2 className="mt-6 text-base font-semibold">2. Select the workbook</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-navy-50" aria-label="Excel workbook" />
            <Button variant="primary" icon={<FileUp className="h-4 w-4" />} disabled={!file} loading={busy === "upload"} onClick={() => upload()}>Upload &amp; preview</Button>
          </div>
          <p className="mt-2 text-xs text-muted">.xlsx only · maximum 10 MB · macro-enabled or malformed files are rejected · nothing is saved until you confirm the preview.</p>
          {error && <div className="mt-4"><Alert>{error}</Alert></div>}
        </Card>
      )}

      {result && (
        <Card className="p-6">
          <h2 className="text-base font-semibold text-brand">Import summary</h2>
          {result.alreadyCommitted && <p className="mt-1 text-sm text-warn">This batch had already been committed. No records were created twice.</p>}
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            {Object.entries(result.summary).filter(([, v]) => typeof v !== "object").map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line p-3"><dt className="text-xs text-muted">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt><dd className="text-lg font-semibold">{String(v)}</dd></div>
            ))}
            {result.summary.byStatus ? Object.entries(result.summary.byStatus as Record<string, number>).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line p-3"><dt className="text-xs text-muted">created · {STATUS_LABEL[k as Status] ?? k}</dt><dd className="text-lg font-semibold">{v}</dd></div>
            )) : null}
          </dl>
          {result.kind === "HISTORICAL" && <p className="mt-3 text-sm">Historical rows are stored verbatim. <button className="link font-medium" onClick={onGoLegacy}>Review them</button> to retain, merge or skip each one.</p>}
        </Card>
      )}

      {preview && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-5">
            <div>
              <h2 className="text-base font-semibold">3. Review the preview – {KIND_INFO[preview.kind].label}</h2>
              <p className="text-sm text-muted">{preview.fileName} · worksheet <strong>{preview.sheetName}</strong>{preview.headerRow ? ` · header row ${preview.headerRow}` : ""}{preview.titleText ? ` · title “${preview.titleText}”` : ""}</p>
            </div>
            <div className="flex items-end gap-2">
              <label className="text-xs text-muted">Worksheet
                <select className="input mt-1 py-1.5" value={preview.sheetName} onChange={(e) => upload({ sheetName: e.target.value })}>
                  {preview.sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <Button onClick={cancel}>Cancel import</Button>
            </div>
          </div>
          <div className="space-y-4 p-5">
            {preview.previouslyCommitted.length > 0 && <Alert tone="warning">This exact worksheet was already imported on {formatDateTime(preview.previouslyCommitted[0].committedAt)}. Rows that were already imported are skipped automatically, so retrying cannot create duplicates.</Alert>}
            {preview.issues.map((i, n) => <Alert key={n} tone={i.level === "error" ? "error" : "warning"}>{i.message}</Alert>)}

            {preview.kind !== "STAGE_TEMPLATE" && (
              <details className="rounded-lg border border-line" open={blockingErrors.length > 0}>
                <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Column mapping {blockingErrors.length === 0 && <span className="font-normal text-muted">– detected automatically; adjust if needed</span>}</summary>
                <div className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-5">
                  {Object.keys(fieldLabels).map((f) => (
                    <Field key={f} label={fieldLabels[f]} htmlFor={`map-${f}`}>
                      <select id={`map-${f}`} className="input py-1.5" value={mapping[f] ?? ""} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">— not mapped —</option>
                        {preview.headers.map((h) => <option key={h.col} value={h.col}>{String.fromCharCode(64 + h.col)}: {h.text}</option>)}
                      </select>
                    </Field>
                  ))}
                  <div className="flex items-end"><Button icon={<RefreshCw className="h-4 w-4" />} loading={busy === "upload"} onClick={() => upload({ sheetName: preview.sheetName, mapping })}>Apply mapping</Button></div>
                </div>
              </details>
            )}

            {preview.kind === "STAGE_TEMPLATE" ? (
              <>
                <div className="grid gap-4 md:grid-cols-3">
                  {preview.stages?.map((p) => (
                    <div key={p.partNumber} className="rounded-lg border border-line p-4">
                      <div className="text-xs font-semibold uppercase text-brand">Part {p.partNumber} – {p.partName}</div>
                      <ol className="mt-2 space-y-0.5 text-sm">{p.steps.map((s, i) => <li key={i}>{s.stepNumber ? `${s.stepNumber}. ` : "• "}{s.name}</li>)}</ol>
                    </div>
                  ))}
                </div>
                <Field label="Template name (optional)" htmlFor="tpl-name" hint="Imported as a separate, editable template. Stages are not imported as action points.">
                  <input id="tpl-name" className="input max-w-md" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={`Audit lifecycle (from ${preview.fileName.replace(/\.xlsx$/i, "")} – ${preview.sheetName})`} />
                </Field>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
                  {Object.entries(preview.stats).filter(([k]) => !k.startsWith("status_")).map(([k, v]) => (
                    <div key={k} className="rounded-lg border border-line p-2.5"><div className="text-[11px] text-muted">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</div><div className="text-lg font-semibold">{v}</div></div>
                  ))}
                </div>
                {preview.kind === "MAIN_TRACKER" && (
                  <p className="text-sm">
                    Status values recognised: {Object.entries(preview.stats).filter(([k]) => k.startsWith("status_")).map(([k, v]) => `${STATUS_LABEL[k.slice(7) as Status]} ${v}`).join(" · ")}.{" "}
                    <strong>{toImport.length}</strong> row(s) will be imported, including <strong>{inProgressToImport}</strong> In Progress.
                  </p>
                )}
                <div className="flex gap-1 text-xs">
                  {(["all", "issues", "duplicates", "excluded"] as const).map((f) => (
                    <button key={f} onClick={() => setRowFilter(f)} className={cx("rounded-full border px-3 py-1", rowFilter === f ? "border-brand bg-brand text-white" : "border-line")}>{{ all: "All rows", issues: "Warnings & errors", duplicates: "Possible duplicates", excluded: "Not imported" }[f]}</button>
                  ))}
                </div>
                <div className="max-h-[55vh] overflow-auto rounded-lg border border-line">
                  <table className="w-full min-w-[1100px] text-xs">
                    <thead>
                      <tr>
                        <th className="th">Row</th><th className="th">Type</th>
                        {preview.kind === "MAIN_TRACKER" ? <><th className="th">SN</th><th className="th">Action points / Project</th><th className="th">Stage</th><th className="th">Owner</th><th className="th">Targeted</th><th className="th">Revised</th><th className="th">Status</th></>
                          : <><th className="th">Action points</th><th className="th">Project</th><th className="th">Owner</th><th className="th">Meeting date</th><th className="th">Status</th></>}
                        <th className="th min-w-[220px]">Checks</th>
                        {preview.kind === "MAIN_TRACKER" && <th className="th">Import?</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((r) => {
                        const m = r as MainRow, h = r as HistRow;
                        return (
                          <tr key={r.rowNumber} className={cx(r.kind !== "data" && "bg-navy-50/60 text-muted")}>
                            <td className="td">{r.rowNumber}</td>
                            <td className="td">{r.kind === "data" ? <Badge tone="green">Data</Badge> : r.kind === "invalid" ? <Badge tone="red">Invalid</Badge> : <Badge>{r.kind.replace("_", " ")}</Badge>}</td>
                            {preview.kind === "MAIN_TRACKER" ? (
                              <>
                                <td className="td">{m.values.sn}</td>
                                <td className="td font-medium text-navy">{m.values.title}</td>
                                <td className="td">{m.values.stage || <span className="text-muted">(blank)</span>}</td>
                                <td className="td">{m.values.owner}</td>
                                <td className="td">{m.parsed ? (m.parsed.target.date ? formatDate(m.parsed.target.date) : m.parsed.target.text ? <i>{m.parsed.target.text}</i> : "") : m.values.target}</td>
                                <td className="td">{m.parsed ? (m.parsed.revised.date ? formatDate(m.parsed.revised.date) : m.parsed.revised.text ? <i>{m.parsed.revised.text}</i> : "") : m.values.revised}</td>
                                <td className="td"><code>&quot;{m.values.status}&quot;</code>{m.parsed && <> → {STATUS_LABEL[m.parsed.status ?? "NOT_STARTED"]}</>}</td>
                              </>
                            ) : (
                              <>
                                <td className="td font-medium text-navy">{h.values.title}</td>
                                <td className="td">{h.values.project}</td>
                                <td className="td">{h.values.owner}</td>
                                <td className="td">{h.values.meetingDate}</td>
                                <td className="td">{h.values.status}</td>
                              </>
                            )}
                            <td className="td">
                              <ul className="space-y-0.5">
                                {r.issues.map((i, n) => <li key={n} className={i.level === "error" ? "text-danger" : i.level === "warning" ? "text-warn" : "text-muted"}>{i.message}</li>)}
                                {(m.duplicateOf ?? h.candidates ?? []).map((d) => <li key={d.id} className="text-warn">≈ “{d.title}” ({Math.round(d.score * 100)}%)</li>)}
                              </ul>
                            </td>
                            {preview.kind === "MAIN_TRACKER" && (
                              <td className="td">
                                {r.kind === "data" && !r.alreadyImported ? (
                                  <select className="input py-1 text-xs" aria-label={`Import row ${r.rowNumber}`} value={decisionOf(m)} onChange={(e) => setDecisions({ ...decisions, [r.rowNumber]: e.target.value as "import" | "skip" })}>
                                    <option value="import">Import</option><option value="skip">Skip</option>
                                  </select>
                                ) : <span className="text-muted">—</span>}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {error && <Alert>{error}</Alert>}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line p-4">
            <span className="mr-auto text-xs text-muted">Original values (status text, delays, source sheet and row) are preserved on every imported record.</span>
            <Button onClick={cancel}>Cancel</Button>
            <Button variant="primary" loading={busy === "commit"} disabled={blockingErrors.length > 0 || (preview.kind === "MAIN_TRACKER" && toImport.length === 0)} onClick={() => setConfirming(true)}>
              {preview.kind === "MAIN_TRACKER" ? `Confirm import of ${toImport.length} row(s)` : preview.kind === "HISTORICAL" ? "Store historical rows for review" : "Create stage template"}
            </Button>
          </div>
        </Card>
      )}
      <ConfirmDialog open={confirming} title="Confirm import" confirmLabel="Import now" onCancel={() => setConfirming(false)} onConfirm={commit} loading={busy === "commit"}>
        {preview?.kind === "MAIN_TRACKER" ? <>Create <strong>{toImport.length}</strong> action point(s) from “{preview.sheetName}”? After the import, the website becomes the main source of information.</> : "Save this import?"}
      </ConfirmDialog>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Import history</h3>
        <Card>
          <table className="w-full text-sm">
            <thead><tr><th className="th">When</th><th className="th">Type</th><th className="th">File / sheet</th><th className="th">By</th><th className="th">Status</th><th className="th">Result</th></tr></thead>
            <tbody>
              {batches.data?.batches.map((b) => (
                <tr key={b.id}>
                  <td className="td whitespace-nowrap text-xs">{formatDateTime(b.createdAt)}</td>
                  <td className="td text-xs">{KIND_INFO[b.kind as Kind]?.label}</td>
                  <td className="td text-xs">{b.fileName} · {b.sheetName}<div className="font-mono text-[10px] text-muted">sha256 {b.fileSha256}…</div></td>
                  <td className="td text-xs">{b.uploadedBy}</td>
                  <td className="td">{b.status === "COMMITTED" ? <Badge tone="green">Committed</Badge> : b.status === "PREVIEW" ? <Badge tone="amber">Preview</Badge> : <Badge>Cancelled</Badge>}</td>
                  <td className="td font-mono text-[11px] text-muted">{b.summary ? Object.entries(b.summary).filter(([, v]) => typeof v !== "object").map(([k, v]) => `${k}: ${v}`).join(", ") : ""}</td>
                </tr>
              ))}
              {batches.data?.batches.length === 0 && <tr><td className="td text-muted" colSpan={6}>No imports yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
