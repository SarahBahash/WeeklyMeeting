import type { Worksheet } from "exceljs";
import { cellRaw, cellText, normalizeHeader, parseDateCell, type ParsedDate } from "./cells";
import { normalizePriority, normalizeStatus, type Priority, type Status } from "../domain";

export type IssueLevel = "error" | "warning" | "info";
export interface Issue { level: IssueLevel; message: string }

export type RowKind = "data" | "header_repeat" | "title_repeat" | "blank" | "invalid";

// ------------------------------------------------------------------ header detection

export type FieldMap<F extends string> = Record<F, number | null>;

export const MAIN_FIELDS = ["sn", "title", "stage", "owner", "target", "revised", "delays", "priority", "status", "feedback"] as const;
export type MainField = (typeof MAIN_FIELDS)[number];
export const MAIN_FIELD_LABELS: Record<MainField, string> = {
  sn: "SN", title: "Action points / Project", stage: "Current Stage", owner: "Process Owner", target: "Targeted Date",
  revised: "Revised Date", delays: "Delays", priority: "Priority", status: "Status", feedback: "Feedback",
};
const MAIN_SYNONYMS: Record<MainField, string[]> = {
  sn: ["sn", "s n", "s no", "sr", "sr no", "serial", "serial no", "no"],
  title: ["action points project", "action point project", "action points projects", "action points", "action point", "project action points"],
  stage: ["current stage", "stage"],
  owner: ["process owner", "owner", "process owners", "responsible"],
  target: ["targeted date", "target date", "targeted", "target"],
  revised: ["revised date", "revised target date", "revised"],
  delays: ["delays", "delay", "delay days"],
  priority: ["priority"],
  status: ["status"],
  feedback: ["feedback", "comments", "remarks", "update"],
};

export const HIST_FIELDS = ["title", "project", "owner", "meetingDate", "target", "revised", "status", "feedback"] as const;
export type HistField = (typeof HIST_FIELDS)[number];
export const HIST_FIELD_LABELS: Record<HistField, string> = {
  title: "Action points", project: "Project", owner: "Process Owner", meetingDate: "Meeting date", target: "Target Date",
  revised: "Revised Date", status: "Status", feedback: "Feedback",
};
const HIST_SYNONYMS: Record<HistField, string[]> = {
  title: ["action points", "action point", "actions", "action"],
  project: ["project", "projects", "project name"],
  owner: ["process owner", "owner", "responsible"],
  meetingDate: ["meeting date", "meeting", "date of meeting"],
  target: ["target date", "targeted date", "target"],
  revised: ["revised date", "revised"],
  status: ["status"],
  feedback: ["feedback", "comments", "remarks"],
};

export interface SheetHeaders {
  headerRow: number | null;
  titleText: string | null;
  headers: { col: number; text: string }[];
}

function rowValues(ws: Worksheet, r: number, maxCol: number): string[] {
  const row = ws.getRow(r);
  const out: string[] = [];
  for (let c = 1; c <= maxCol; c++) out.push(cellText(row.getCell(c).value));
  return out;
}

function detect<F extends string>(ws: Worksheet, synonyms: Record<F, string[]>, fields: readonly F[]) {
  const maxCol = Math.min(Math.max(ws.columnCount, 1), 60);
  const scan = Math.min(ws.rowCount, 25);
  let best: { row: number; map: FieldMap<F>; score: number } | null = null;
  for (let r = 1; r <= scan; r++) {
    const vals = rowValues(ws, r, maxCol).map(normalizeHeader);
    const map = Object.fromEntries(fields.map((f) => [f, null])) as FieldMap<F>;
    let score = 0;
    for (const f of fields) {
      const idx = vals.findIndex((v, i) => v && synonyms[f].includes(v) && !Object.values(map).includes(i + 1));
      if (idx >= 0) { map[f] = idx + 1; score++; }
    }
    if (score >= 3 && (!best || score > best.score)) best = { row: r, map, score };
  }
  return best;
}

function headerInfo(ws: Worksheet, headerRow: number | null): SheetHeaders {
  const maxCol = Math.min(Math.max(ws.columnCount, 1), 60);
  if (!headerRow) return { headerRow: null, titleText: null, headers: [] };
  const headers = rowValues(ws, headerRow, maxCol)
    .map((text, i) => ({ col: i + 1, text }))
    .filter((h) => h.text);
  let titleText: string | null = null;
  for (let r = headerRow - 1; r >= 1; r--) {
    const vals = [...new Set(rowValues(ws, r, maxCol).filter(Boolean))];
    if (vals.length >= 1) { titleText = vals[0]; break; }
  }
  return { headerRow, titleText, headers };
}

function isHeaderRepeat(vals: string[], synonyms: Record<string, string[]>): boolean {
  const all = new Set(Object.values(synonyms).flat());
  const hits = vals.map(normalizeHeader).filter((v) => v && all.has(v)).length;
  return hits >= 3;
}

function isTitleRepeat(vals: string[], titleText: string | null): boolean {
  const distinct = [...new Set(vals.filter(Boolean).map((v) => v.trim()))];
  if (distinct.length !== 1) return false;
  const v = normalizeHeader(distinct[0]);
  if (titleText && v === normalizeHeader(titleText)) return true;
  return /\b(weekly meeting|minutes of meeting|mom)\b/.test(v) && /\baction points?\b/.test(v);
}

// ------------------------------------------------------------------ main tracker (IA-MOM)

export interface MainRow {
  rowNumber: number;
  kind: RowKind;
  values: Record<MainField, string>;
  /** Untrimmed original text of the legacy columns, preserved verbatim. */
  original?: { status: string; delays: string; priority: string };
  parsed: {
    status: Status | null;
    statusRecognized: boolean;
    priority: Priority | null;
    target: ParsedDate;
    revised: ParsedDate;
  } | null;
  issues: Issue[];
  duplicateOf?: { id: string; title: string; ownerName: string | null; score: number }[];
  alreadyImported?: boolean;
  /** Default decision suggested by the preview; admin can override for warnings / duplicates. */
  suggested: "import" | "skip";
}

export interface ParsedMainSheet extends SheetHeaders {
  mapping: FieldMap<MainField>;
  rows: MainRow[];
}

export function parseMainSheet(ws: Worksheet, mappingOverride?: Partial<FieldMap<MainField>>): ParsedMainSheet {
  const found = detect(ws, MAIN_SYNONYMS, MAIN_FIELDS);
  const mapping = { ...(found?.map ?? (Object.fromEntries(MAIN_FIELDS.map((f) => [f, null])) as FieldMap<MainField>)), ...(mappingOverride ?? {}) };
  const info = headerInfo(ws, found?.row ?? null);
  const rows: MainRow[] = [];
  if (!found) return { ...info, mapping, rows };
  const maxCol = Math.min(Math.max(ws.columnCount, 1), 60);
  for (let r = found.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const all = rowValues(ws, r, maxCol);
    const values = Object.fromEntries(
      MAIN_FIELDS.map((f) => [f, mapping[f] ? cellText(row.getCell(mapping[f]!).value) : ""]),
    ) as Record<MainField, string>;
    const base = { rowNumber: r, values, parsed: null, issues: [] as Issue[] };
    if (all.every((v) => !v)) { rows.push({ ...base, kind: "blank", suggested: "skip" }); continue; }
    if (isHeaderRepeat(all, MAIN_SYNONYMS)) {
      rows.push({ ...base, kind: "header_repeat", issues: [{ level: "info", message: "Repeated header row – not imported" }], suggested: "skip" });
      continue;
    }
    if (isTitleRepeat(all, info.titleText)) {
      rows.push({ ...base, kind: "title_repeat", issues: [{ level: "info", message: "Repeated title row – not imported" }], suggested: "skip" });
      continue;
    }
    const issues: Issue[] = [];
    if (!values.title) {
      issues.push({ level: "error", message: "Action points / Project is blank" });
      rows.push({ ...base, kind: "invalid", issues, suggested: "skip" });
      continue;
    }
    if (values.title.length > 500) issues.push({ level: "warning", message: "Title longer than 500 characters will be truncated" });
    const st = normalizeStatus(values.status);
    if (!values.status) issues.push({ level: "warning", message: "Status is blank – will be imported as Not Started" });
    else if (!st.recognized) issues.push({ level: "warning", message: `Unrecognised status "${values.status}" – imported as Not Started (original kept)` });
    else if (values.status.trim() !== values.status || !["In Progress", "Completed", "Closed", "On Hold", "Not Started"].includes(values.status)) {
      issues.push({ level: "info", message: `Status "${values.status}" normalised to standard value` });
    }
    const pr = normalizePriority(values.priority);
    if (!pr.recognized) issues.push({ level: "warning", message: `Unrecognised priority "${values.priority}" – left blank (original kept)` });
    const target = parseDateCell(mapping.target ? cellRaw(row.getCell(mapping.target).value) : null);
    const revised = parseDateCell(mapping.revised ? cellRaw(row.getCell(mapping.revised).value) : null);
    if (target.text) issues.push({ level: "info", message: `Targeted Date "${target.text}" kept as text (not a date)` });
    if (revised.text) issues.push({ level: "info", message: `Revised Date "${revised.text}" kept as text (not a date)` });
    if (target.ambiguous || revised.ambiguous) issues.push({ level: "warning", message: "Ambiguous numeric date interpreted as day/month/year" });
    if (!values.stage) issues.push({ level: "info", message: "Current Stage is blank (valid)" });
    const orig = (f: MainField) => (mapping[f] ? cellText(row.getCell(mapping[f]!).value, false) : "");
    rows.push({
      ...base,
      kind: "data",
      original: { status: orig("status"), delays: orig("delays"), priority: orig("priority") },
      parsed: { status: st.status, statusRecognized: st.recognized, priority: pr.priority, target, revised },
      issues,
      suggested: "import",
    });
  }
  // Trim trailing blank rows.
  while (rows.length && rows[rows.length - 1].kind === "blank") rows.pop();
  return { ...info, mapping, rows };
}

// ------------------------------------------------------------------ historical tracker (IA-MOM (2))

export interface HistRow {
  rowNumber: number;
  kind: RowKind;
  values: Record<HistField, string>;
  meetingDate: ParsedDate | null;
  status: Status | null;
  issues: Issue[];
  candidates?: { id: string; title: string; ownerName: string | null; score: number }[];
  alreadyImported?: boolean;
}

export interface ParsedHistSheet extends SheetHeaders {
  mapping: FieldMap<HistField>;
  rows: HistRow[];
}

export function parseHistoricalSheet(ws: Worksheet, mappingOverride?: Partial<FieldMap<HistField>>): ParsedHistSheet {
  const found = detect(ws, HIST_SYNONYMS, HIST_FIELDS);
  const mapping = { ...(found?.map ?? (Object.fromEntries(HIST_FIELDS.map((f) => [f, null])) as FieldMap<HistField>)), ...(mappingOverride ?? {}) };
  const info = headerInfo(ws, found?.row ?? null);
  const rows: HistRow[] = [];
  if (!found) return { ...info, mapping, rows };
  const maxCol = Math.min(Math.max(ws.columnCount, 1), 60);
  for (let r = found.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const all = rowValues(ws, r, maxCol);
    const values = Object.fromEntries(HIST_FIELDS.map((f) => [f, mapping[f] ? cellText(row.getCell(mapping[f]!).value) : ""])) as Record<HistField, string>;
    // Dates are re-read from the typed cell so serial numbers convert correctly.
    for (const f of ["meetingDate", "target", "revised"] as const) {
      if (mapping[f]) {
        const p = parseDateCell(cellRaw(row.getCell(mapping[f]!).value));
        values[f] = p.date ?? p.text ?? "";
      }
    }
    const base = { rowNumber: r, values, meetingDate: null, status: null, issues: [] as Issue[] };
    if (all.every((v) => !v)) { rows.push({ ...base, kind: "blank" }); continue; }
    if (isHeaderRepeat(all, HIST_SYNONYMS)) { rows.push({ ...base, kind: "header_repeat", issues: [{ level: "info", message: "Repeated header row" }] }); continue; }
    if (isTitleRepeat(all, info.titleText)) { rows.push({ ...base, kind: "title_repeat", issues: [{ level: "info", message: "Repeated title row" }] }); continue; }
    if (!values.title && !values.project) {
      rows.push({ ...base, kind: "invalid", issues: [{ level: "error", message: "Action points and Project are both blank" }] });
      continue;
    }
    const issues: Issue[] = [];
    const st = normalizeStatus(values.status);
    if (values.status && !st.recognized) issues.push({ level: "warning", message: `Unrecognised status "${values.status}"` });
    const md = mapping.meetingDate ? parseDateCell(cellRaw(row.getCell(mapping.meetingDate).value)) : null;
    rows.push({ ...base, kind: "data", meetingDate: md, status: st.status, issues });
  }
  while (rows.length && rows[rows.length - 1].kind === "blank") rows.pop();
  return { ...info, mapping, rows };
}

// ------------------------------------------------------------------ stage template (Sheet1)

export interface ParsedStagePart { partNumber: number; partName: string; steps: { stepNumber: number | null; name: string }[] }

const STAGE_HEADER_WORDS = new Set(["step", "steps", "stage", "stages", "no", "sn", "s n", "part", "phase", "#", "audit stages", "audit lifecycle"]);

export function parseStageSheet(ws: Worksheet): { parts: ParsedStagePart[]; issues: Issue[] } {
  const parts: ParsedStagePart[] = [];
  const issues: Issue[] = [];
  const maxCol = Math.min(Math.max(ws.columnCount, 1), 30);
  let current: ParsedStagePart | null = null;
  for (let r = 1; r <= Math.min(ws.rowCount, 500); r++) {
    const vals = rowValues(ws, r, maxCol).filter(Boolean);
    if (!vals.length) continue;
    const partIdx = vals.findIndex((v) => /^part\s*\d+/i.test(v));
    if (partIdx >= 0) {
      const m = /^part\s*(\d+)\s*[-–—:.)]?\s*(.*)$/i.exec(vals[partIdx])!;
      const rest = m[2].trim() || vals.filter((_, i) => i !== partIdx && !/^\d+$/.test(vals[i]))[0] || "";
      current = { partNumber: Number(m[1]), partName: rest || `Part ${m[1]}`, steps: [] };
      parts.push(current);
      // A row like "Part 1 | 1 | Scope Discussion" also carries a step.
      const others = vals.filter((_, i) => i !== partIdx);
      const num = others.find((v) => /^\d{1,2}\.?$/.test(v));
      const name = others.find((v) => !/^\d{1,2}\.?$/.test(v) && v !== rest);
      if (num && name) current.steps.push({ stepNumber: parseInt(num, 10), name });
      continue;
    }
    const numCell = vals.find((v) => /^\d{1,2}\.?$/.test(v));
    let name = vals.find((v) => !/^\d{1,2}\.?$/.test(v)) ?? "";
    const inline = /^(\d{1,2})[.)-]\s+(.+)$/.exec(name);
    let stepNumber: number | null = numCell ? parseInt(numCell, 10) : null;
    if (!stepNumber && inline) { stepNumber = Number(inline[1]); name = inline[2]; }
    if (!name || STAGE_HEADER_WORDS.has(normalizeHeader(name))) continue;
    if (!current) {
      if (!stepNumber) continue; // title rows before the first part
      current = { partNumber: 1, partName: "Part 1", steps: [] };
      parts.push(current);
    }
    current.steps.push({ stepNumber, name: name.slice(0, 200) });
  }
  const total = parts.reduce((n, p) => n + p.steps.length, 0);
  if (!total) issues.push({ level: "error", message: "No audit stages were found on this sheet." });
  return { parts: parts.filter((p) => p.steps.length), issues };
}
