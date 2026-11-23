import "server-only";
import ExcelJS from "exceljs";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { can, type AuthUser } from "../auth/permissions";
import { badRequest, forbidden, notFound } from "../errors";
import { visibleActionPoints } from "../visibility";
import { dateToISO, formatDateTime, isoToDate, riyadhWallClock, todayInRiyadh, type ISODate } from "../dates";
import { STATUSES, STATUS_LABEL, PRIORITY_LABEL, STAGE_STATUS_LABEL, spreadsheetSafe, type Status } from "../domain";
import { apInclude, defaultOrder, toDTO, FIELD_LABELS, type ActionPointDTO, type ApSnapshot, type FieldChange } from "../services/action-points";
import { getMeetingDetail, type MeetingSummary, type RevisionChange } from "../services/meetings";

export const exportSchema = z.object({
  type: z.enum(["FULL_TRACKER", "SELECTED_STATUS", "MEETING"]),
  status: z.union([z.literal("ALL"), z.enum(STATUSES)]).default("ALL"),
  separateSheets: z.boolean().default(false),
  /** Group/label by the original imported status text instead of the standard status (admin only). */
  useOriginalStatus: z.boolean().default(false),
  includeWebsiteFields: z.boolean().default(true),
  includeUpdateHistory: z.boolean().default(false),
  includeDeadlineHistory: z.boolean().default(false),
  includeAuditStages: z.boolean().default(false),
  meetingId: z.string().max(40).optional(),
});
export type ExportRequest = z.infer<typeof exportSchema>;

const GREEN = "FF25866B";
const NAVY = "FF172D4D";
const DATE_FMT = "dd-mmm-yyyy";
const DATETIME_FMT = "dd-mmm-yyyy hh:mm";

interface Col {
  header: string;
  key: string;
  width: number;
  type?: "text" | "date" | "datetime" | "number" | "longtext";
}

const t = (v: string | null | undefined) => (v == null || v === "" ? null : spreadsheetSafe(String(v)));
const d = (iso: ISODate | null | undefined) => (iso ? isoToDate(iso) : null);
const dt = (v: string | Date | null | undefined) => (v ? riyadhWallClock(typeof v === "string" ? new Date(v) : v) : null);

/** Excel worksheet names: max 31 chars, no []:*?/\ and unique. */
export function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\[\]:*?/\\]/g, "-").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Sheet";
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function addTable(wb: ExcelJS.Workbook, used: Set<string>, name: string, cols: Col[], rows: Record<string, unknown>[], emptyMessage = "No matching records were found.") {
  const ws = wb.addWorksheet(safeSheetName(name, used), { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.height = 30;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
  });
  if (rows.length === 0) {
    const r = ws.addRow({ [cols[0].key]: emptyMessage });
    r.getCell(1).font = { italic: true, color: { argb: "FF5B6472" } };
  } else {
    for (const row of rows) ws.addRow(row);
  }
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === "date") col.numFmt = DATE_FMT;
    if (c.type === "datetime") col.numFmt = DATETIME_FMT;
    col.alignment = { vertical: "top", wrapText: c.type === "longtext" || c.width >= 30 };
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, ws.rowCount), column: cols.length } };
  return ws;
}

// ------------------------------------------------------------------ tracker columns

function trackerColumns(includeWebsiteFields: boolean, includeOriginal: boolean): Col[] {
  const cols: Col[] = [
    { header: "SN", key: "sn", width: 7 },
    { header: "Action points / Project", key: "title", width: 48, type: "longtext" },
    { header: "Current Stage", key: "stage", width: 22 },
    { header: "Process Owner", key: "owner", width: 22 },
    { header: "Targeted Date", key: "target", width: 15, type: "date" },
    { header: "Revised Date", key: "revised", width: 15, type: "date" },
    { header: "Delays", key: "delays", width: 10, type: "number" },
    { header: "Priority", key: "priority", width: 11 },
    { header: "Status", key: "status", width: 14 },
    { header: "Feedback", key: "feedback", width: 60, type: "longtext" },
  ];
  if (includeWebsiteFields) {
    cols.push(
      { header: "Activity Type", key: "activityType", width: 20 },
      { header: "Related Project", key: "project", width: 24 },
      { header: "Effective Deadline", key: "effective", width: 17, type: "date" },
      { header: "Overdue Days", key: "overdue", width: 13, type: "number" },
      { header: "Extension Days", key: "extension", width: 14, type: "number" },
      { header: "Last Updated", key: "updatedAt", width: 18, type: "datetime" },
      { header: "Latest Meeting Date", key: "latestMeeting", width: 18, type: "date" },
      { header: "Created By", key: "createdBy", width: 20 },
      { header: "Updated By", key: "updatedBy", width: 20 },
      { header: "Next Action", key: "nextAction", width: 36, type: "longtext" },
      { header: "Notes / Blocker", key: "blocker", width: 36, type: "longtext" },
    );
  }
  if (includeOriginal) {
    cols.push(
      { header: "Original Imported Status", key: "sourceStatus", width: 22 },
      { header: "Imported Delays Value", key: "sourceDelays", width: 18 },
      { header: "Imported Target (text)", key: "targetText", width: 18 },
      { header: "Imported Revised (text)", key: "revisedText", width: 18 },
      { header: "Source Sheet / Row", key: "source", width: 18 },
    );
  }
  return cols;
}

function trackerRow(a: ActionPointDTO, latestMeeting: Map<string, ISODate>, statusLabel: string) {
  return {
    sn: a.legacySn ? (/^\d+$/.test(a.legacySn) ? Number(a.legacySn) : t(a.legacySn)) : null,
    title: t(a.title),
    stage: t(a.currentStage ?? a.projectStage?.name ?? null),
    owner: t(a.ownerName),
    target: d(a.originalTargetDate) ?? t(a.originalTargetText),
    revised: d(a.revisedTargetDate) ?? t(a.revisedTargetText),
    delays: a.deadline.overdueDays,
    priority: a.priority ? PRIORITY_LABEL[a.priority] : null,
    status: t(statusLabel),
    feedback: t(a.feedback),
    activityType: t(a.activityType?.name ?? "Unclassified"),
    project: t(a.project?.name ?? null),
    effective: d(a.deadline.effectiveDeadline),
    overdue: a.deadline.overdueDays,
    extension: a.deadline.extensionDays,
    updatedAt: dt(a.updatedAt),
    latestMeeting: d(latestMeeting.get(a.id) ?? null),
    createdBy: t(a.createdBy),
    updatedBy: t(a.updatedBy),
    nextAction: t(a.nextAction),
    blocker: t(a.blocker),
    sourceStatus: t(a.sourceStatus),
    sourceDelays: t(a.sourceDelays),
    targetText: t(a.originalTargetText),
    revisedText: t(a.revisedTargetText),
    source: a.sourceSheet ? t(`${a.sourceSheet} / ${a.sourceRow ?? ""}`) : null,
  };
}

function infoSheet(wb: ExcelJS.Workbook, used: Set<string>, user: AuthUser, title: string, params: [string, string][]) {
  const ws = wb.addWorksheet(safeSheetName("Report Info", used));
  ws.columns = [{ width: 28 }, { width: 70 }];
  ws.addRow(["IA Weekly Meeting Hub"]).font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.addRow([title]).font = { bold: true, size: 12, color: { argb: GREEN } };
  ws.addRow([]);
  const rows: [string, string][] = [
    ["Generated at (Asia/Riyadh)", formatDateTime(new Date())],
    ["Generated by", user.name],
    ...params,
    ["Classification", "Confidential – Internal Audit. Do not distribute outside authorised recipients."],
  ];
  for (const [k, v] of rows) {
    const r = ws.addRow([k, spreadsheetSafe(v)]);
    r.getCell(1).font = { bold: true, color: { argb: NAVY } };
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
  return ws;
}

// ------------------------------------------------------------------ tracker export

export async function buildTrackerExport(user: AuthUser, req: ExportRequest) {
  if (!can(user, "export:run")) throw forbidden("You do not have permission to export reports");
  if (req.useOriginalStatus && !can(user, "export:originalStatus")) throw forbidden("Only administrators can export by original imported status");
  const statusFilter: Status | null = req.type === "SELECTED_STATUS" && req.status !== "ALL" ? req.status : null;
  if (req.type === "SELECTED_STATUS" && req.status === "ALL" && !req.separateSheets) {
    // "Selected status" with "All statuses" is equivalent to the full tracker.
  }
  const where: Prisma.ActionPointWhereInput = { AND: [visibleActionPoints(user), statusFilter ? { status: statusFilter } : {}] };
  const records = await prisma.actionPoint.findMany({ where, include: apInclude, orderBy: defaultOrder });
  const today = todayInRiyadh();
  const items = records.map((r) => toDTO(r, today));
  const ids = items.map((i) => i.id);

  const latest = await prisma.meetingAgendaItem.findMany({
    where: { actionPointId: { in: ids } },
    select: { actionPointId: true, meeting: { select: { meetingDate: true } } },
  });
  const latestMeeting = new Map<string, ISODate>();
  for (const l of latest) {
    const iso = dateToISO(l.meeting.meetingDate)!;
    if (!latestMeeting.has(l.actionPointId) || latestMeeting.get(l.actionPointId)! < iso) latestMeeting.set(l.actionPointId, iso);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "IA Weekly Meeting Hub";
  wb.created = new Date();
  const used = new Set<string>();
  const includeOriginal = can(user, "export:originalStatus") || req.useOriginalStatus;
  const cols = trackerColumns(req.includeWebsiteFields, includeOriginal);
  const label = (a: ActionPointDTO) => (req.useOriginalStatus ? (a.sourceStatus?.trim() || STATUS_LABEL[a.status]) : STATUS_LABEL[a.status]);
  const rowOf = (a: ActionPointDTO) => trackerRow(a, latestMeeting, label(a));

  const sheetCounts: [string, string][] = [];
  if (req.separateSheets) {
    let groups: { name: string; items: ActionPointDTO[] }[];
    if (req.useOriginalStatus) {
      const map = new Map<string, ActionPointDTO[]>();
      for (const a of items) {
        const k = label(a);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(a);
      }
      groups = [...map.entries()].map(([name, list]) => ({ name, items: list }));
      if (!groups.length) groups = [{ name: "No records", items: [] }];
    } else {
      const statuses = statusFilter ? [statusFilter] : [...STATUSES];
      groups = statuses.map((s) => ({ name: STATUS_LABEL[s], items: items.filter((a) => a.status === s) }));
    }
    for (const g of groups) {
      addTable(wb, used, g.name, cols, g.items.map(rowOf), `No action points with status "${g.name}" were found.`);
      sheetCounts.push([`Sheet: ${g.name}`, `${g.items.length} record(s)`]);
    }
  } else {
    const name = statusFilter ? STATUS_LABEL[statusFilter] : "Action Points";
    addTable(wb, used, name, cols, items.map(rowOf), statusFilter ? `No action points with status "${STATUS_LABEL[statusFilter]}" were found.` : undefined);
  }

  if (req.includeUpdateHistory) {
    const changes = await prisma.actionPointChange.findMany({
      where: { actionPointId: { in: ids } },
      orderBy: [{ changedAt: "asc" }],
      include: { actionPoint: { select: { title: true, legacySn: true } }, changedBy: { select: { name: true } }, meeting: { select: { meetingDate: true } } },
    });
    addTable(wb, used, "Update History", [
      { header: "Date & Time", key: "at", width: 18, type: "datetime" },
      { header: "SN", key: "sn", width: 7 },
      { header: "Action point", key: "title", width: 44, type: "longtext" },
      { header: "Field Changed", key: "field", width: 20 },
      { header: "Previous Value", key: "old", width: 40, type: "longtext" },
      { header: "New Value", key: "new", width: 40, type: "longtext" },
      { header: "Changed By", key: "by", width: 20 },
      { header: "Source", key: "source", width: 16 },
      { header: "Meeting Date", key: "meeting", width: 14, type: "date" },
    ], changes.map((c) => ({
      at: dt(c.changedAt),
      sn: t(c.actionPoint.legacySn),
      title: t(c.actionPoint.title),
      field: t(FIELD_LABELS[c.field] ?? c.field),
      old: t(c.oldValue),
      new: t(c.newValue),
      by: t(c.changedBy?.name ?? "System"),
      source: t(c.source.replace("_", " ")),
      meeting: c.meeting ? c.meeting.meetingDate : null,
    })));
  }
  if (req.includeDeadlineHistory) {
    const dl = await prisma.deadlineChange.findMany({
      where: { actionPointId: { in: ids } },
      orderBy: { changedAt: "asc" },
      include: { actionPoint: { select: { title: true, legacySn: true, originalTargetDate: true } }, changedBy: { select: { name: true } }, meeting: { select: { meetingDate: true } } },
    });
    addTable(wb, used, "Deadline Change History", [
      { header: "Change Date", key: "at", width: 18, type: "datetime" },
      { header: "SN", key: "sn", width: 7 },
      { header: "Action point", key: "title", width: 44, type: "longtext" },
      { header: "Change Type", key: "kind", width: 22 },
      { header: "Original Target Date", key: "original", width: 18, type: "date" },
      { header: "Previous Deadline", key: "prev", width: 17, type: "date" },
      { header: "New Deadline", key: "next", width: 15, type: "date" },
      { header: "Changed By", key: "by", width: 20 },
      { header: "Reason", key: "reason", width: 40, type: "longtext" },
      { header: "Meeting Date", key: "meeting", width: 14, type: "date" },
    ], dl.map((c) => ({
      at: dt(c.changedAt),
      sn: t(c.actionPoint.legacySn),
      title: t(c.actionPoint.title),
      kind: c.kind === "REVISION" ? "Deadline revision" : "Original date correction",
      original: c.actionPoint.originalTargetDate,
      prev: c.previousDate ?? t(c.previousText),
      next: c.newDate ?? t(c.newText),
      by: t(c.changedBy?.name ?? null),
      reason: t(c.reason),
      meeting: c.meeting?.meetingDate ?? null,
    })));
  }
  if (req.includeAuditStages) {
    const stages = await prisma.projectStage.findMany({
      orderBy: [{ project: { name: "asc" } }, { sortOrder: "asc" }],
      include: { project: { select: { name: true } }, actionPoints: { where: visibleActionPoints(user), select: { title: true } } },
    });
    addTable(wb, used, "Audit Stages", [
      { header: "Project", key: "project", width: 30 },
      { header: "Part", key: "part", width: 26 },
      { header: "#", key: "order", width: 5, type: "number" },
      { header: "Stage", key: "name", width: 34 },
      { header: "Owner", key: "owner", width: 20 },
      { header: "Status", key: "status", width: 15 },
      { header: "Target Date", key: "target", width: 14, type: "date" },
      { header: "Actual Completion", key: "actual", width: 17, type: "date" },
      { header: "Related Action Points", key: "aps", width: 50, type: "longtext" },
    ], stages.map((s) => ({
      project: t(s.project.name),
      part: t(s.partName),
      order: s.sortOrder,
      name: t(s.name),
      owner: t(s.ownerName),
      status: STAGE_STATUS_LABEL[s.status],
      target: s.targetDate,
      actual: s.actualCompletionDate,
      aps: t(s.actionPoints.map((a) => a.title).join("\n")),
    })));
  }

  const title = req.type === "FULL_TRACKER" ? "Full Tracker Export" : `Status Export – ${statusFilter ? STATUS_LABEL[statusFilter] : "All Statuses"}`;
  infoSheet(wb, used, user, title, [
    ["Status filter", statusFilter ? STATUS_LABEL[statusFilter] : "All statuses"],
    ["Status basis", req.useOriginalStatus ? "Original imported status values" : "Standard status"],
    ["Separate sheet per status", req.separateSheets ? "Yes" : "No"],
    ["Records exported", String(items.length)],
    ["Delays column", "Days overdue against the effective deadline (active items only); blank when not overdue or undated."],
    ...sheetCounts,
  ]);

  const stamp = today;
  const fileName = req.type === "FULL_TRACKER"
    ? `IA-Tracker-All-Statuses-${stamp}.xlsx`
    : `IA-Tracker-${statusFilter ? STATUS_LABEL[statusFilter].replace(/\s+/g, "-") : "All-Statuses"}${req.separateSheets ? "-by-status" : ""}-${stamp}.xlsx`;
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, fileName, rowCount: items.length };
}

// ------------------------------------------------------------------ meeting export

export async function buildMeetingExport(user: AuthUser, meetingId: string) {
  if (!can(user, "export:run")) throw forbidden("You do not have permission to export reports");
  const detail = await getMeetingDetail(user, meetingId).catch(() => null);
  if (!detail) throw notFound("Meeting");
  const { meeting, agenda } = detail;
  const wb = new ExcelJS.Workbook();
  wb.creator = "IA Weekly Meeting Hub";
  const used = new Set<string>();

  // Apply recorded revisions (corrections) without altering original values.
  const corrected = new Map<string, string | null>();
  let attendees = meeting.attendees, notes = meeting.notes;
  for (const r of meeting.revisions) for (const c of r.changes as RevisionChange[]) {
    if (c.meetingUpdateId) corrected.set(c.meetingUpdateId, c.newValue);
    else if (c.field === "attendees") attendees = c.newValue;
    else if (c.field === "notes") notes = c.newValue;
  }

  const snapCols: Col[] = [
    { header: "#", key: "pos", width: 5, type: "number" },
    { header: "SN", key: "sn", width: 7 },
    { header: "Action points / Project", key: "title", width: 46, type: "longtext" },
    { header: "Activity Type", key: "type", width: 18 },
    { header: "Current Stage", key: "stage", width: 20 },
    { header: "Process Owner", key: "owner", width: 20 },
    { header: "Targeted Date", key: "target", width: 14, type: "date" },
    { header: "Revised Date", key: "revised", width: 14, type: "date" },
    { header: "Effective Deadline", key: "effective", width: 16, type: "date" },
    { header: "Overdue Days", key: "overdue", width: 12, type: "number" },
    { header: "Priority", key: "priority", width: 10 },
    { header: "Status", key: "status", width: 13 },
    { header: "Feedback", key: "feedback", width: 60, type: "longtext" },
  ];
  const snapRow = (pos: number, s: ApSnapshot, extra: Record<string, unknown> = {}) => ({
    pos,
    sn: t(s.legacySn),
    title: t(s.title),
    type: t(s.activityType ?? "Unclassified"),
    stage: t(s.currentStage),
    owner: t(s.ownerName),
    target: d(s.originalTargetDate) ?? t(s.originalTargetText),
    revised: d(s.revisedTargetDate) ?? t(s.revisedTargetText),
    effective: d(s.effectiveDeadline),
    overdue: s.overdueDays,
    priority: s.priority ? PRIORITY_LABEL[s.priority] : null,
    status: STATUS_LABEL[s.status],
    feedback: t(s.feedback),
    ...extra,
  });

  // Summary sheet
  const summary: MeetingSummary | null = meeting.summary;
  const ws = wb.addWorksheet(safeSheetName("Meeting Summary", used));
  ws.columns = [{ width: 34 }, { width: 50 }, { width: 22 }, { width: 18 }];
  ws.addRow(["IA Weekly Meeting – Summary"]).font = { bold: true, size: 14, color: { argb: NAVY } };
  const kv = (k: string, v: string | number | Date | null) => {
    const r = ws.addRow([k, typeof v === "string" ? spreadsheetSafe(v) : v]);
    r.getCell(1).font = { bold: true, color: { argb: NAVY } };
    r.getCell(2).alignment = { wrapText: true, vertical: "top", horizontal: "left" };
    if (v instanceof Date) r.getCell(2).numFmt = DATE_FMT;
  };
  kv("Meeting Date", isoToDate(meeting.meetingDate));
  kv("Organizer", meeting.organizer.name);
  kv("Attendees", attendees ?? "");
  kv("Notes", notes ?? "");
  kv("Meeting Status", meeting.status === "FINALIZED" ? `Finalized ${formatDateTime(meeting.finalizedAt)}` : "Draft (in progress)");
  kv("Exported (Asia/Riyadh)", formatDateTime(new Date()));
  kv("Exported By", user.name);
  if (detail.meeting.hiddenItems) kv("Note", `${detail.meeting.hiddenItems} restricted agenda item(s) are not included in this export.`);
  ws.addRow([]);
  if (summary) {
    const tt = summary.totals;
    const head = ws.addRow(["Totals"]);
    head.font = { bold: true, color: { argb: GREEN } };
    kv("Agenda items", tt.agendaItems);
    kv("Items reviewed", tt.reviewed);
    kv("Items skipped", tt.skipped);
    kv("Completed / closed in meeting", tt.completed);
    kv("Remaining In Progress", tt.remainingInProgress);
    kv("On Hold", tt.onHold);
    kv("Overdue (as of meeting date)", tt.overdue);
    kv("Revised deadlines", tt.revisedDeadlines);
    kv("New action points", tt.newActions);
    kv("Pending follow-up actions", tt.followUps);
    kv("Unreviewed items", tt.unreviewed);
    const section = (title: string, lines: string[]) => {
      ws.addRow([]);
      ws.addRow([title]).font = { bold: true, color: { argb: GREEN } };
      if (!lines.length) ws.addRow(["None"]).font = { italic: true, color: { argb: "FF5B6472" } };
      for (const l of lines) ws.addRow([spreadsheetSafe(l)]).getCell(1).alignment = { wrapText: false };
    };
    const who = (o: string | null) => (o ? ` (${o})` : "");
    section("Completed Items", summary.completedItems.map((i) => `• ${i.title}${who(i.ownerName)} – ${STATUS_LABEL[i.status]}`));
    section("Revised Deadlines", summary.revisedDeadlines.map((r) => `• ${r.title}: ${r.previous ?? "—"} → ${r.next ?? "—"}${r.reason ? ` (${r.reason})` : ""}`));
    section("Overdue Items", summary.overdueItems.map((i) => `• ${i.title}${who(i.ownerName)} – ${i.overdueDays} day(s) overdue`));
    section("On Hold Items", summary.onHoldItems.map((i) => `• ${i.title}${who(i.ownerName)}`));
    section("Newly Created Action Points", summary.newActions.map((i) => `• ${i.title}${who(i.ownerName)}`));
    section("Pending Follow-up Actions", summary.followUps.map((f) => `• ${f.title}${who(f.ownerName)}: ${f.nextAction}`));
    section("Unreviewed Items", summary.unreviewedItems.map((i) => `• ${i.title}${who(i.ownerName)} – ${i.reviewState === "SKIPPED" ? "skipped" : "not reviewed"}`));
  } else {
    ws.addRow(["The final summary is generated when the meeting is finished."]).font = { italic: true };
  }
  if (meeting.revisions.length) {
    ws.addRow([]);
    ws.addRow(["Corrections (revisions)"]).font = { bold: true, color: { argb: GREEN } };
    for (const r of meeting.revisions) {
      ws.addRow([spreadsheetSafe(`Revision ${r.revisionNumber} – ${formatDateTime(r.createdAt)} by ${r.createdBy}: ${r.reason}`)]);
    }
  }
  addTable(wb, used, "Agenda (at start)", snapCols, agenda.map((a) => snapRow(a.position, a.snapshot)));
  addTable(wb, used, "Outcome (after meeting)", [
    ...snapCols,
    { header: "Review", key: "review", width: 12 },
    { header: "Added During Meeting", key: "added", width: 14 },
    { header: "Next Action", key: "next", width: 36, type: "longtext" },
    { header: "Notes / Blocker", key: "blocker", width: 36, type: "longtext" },
  ], agenda.map((a) => {
    const s = a.finalSnapshot ?? a.snapshot;
    return snapRow(a.position, s, {
      review: a.reviewState === "REVIEWED" ? "Reviewed" : a.reviewState === "SKIPPED" ? "Skipped" : "Not reviewed",
      added: a.isNewAction ? "New action" : a.addedDuringMeeting ? "Yes" : "No",
      next: t(s.nextAction),
      blocker: t(s.blocker),
    });
  }));
  const updates = agenda.flatMap((a) => a.updates.map((u) => ({ a, u })));
  addTable(wb, used, "Updates Recorded", [
    { header: "Time", key: "at", width: 17, type: "datetime" },
    { header: "Action point", key: "title", width: 44, type: "longtext" },
    { header: "Meeting Update / Feedback", key: "feedback", width: 60, type: "longtext" },
    { header: "Next Action", key: "next", width: 34, type: "longtext" },
    { header: "Notes / Blocker", key: "blocker", width: 30, type: "longtext" },
    { header: "Field Changes", key: "changes", width: 50, type: "longtext" },
    { header: "Updated By", key: "by", width: 20 },
    { header: "Corrected", key: "corrected", width: 11 },
  ], updates.map(({ a, u }) => ({
    at: dt(u.createdAt),
    title: t(a.snapshot.title),
    feedback: t(corrected.has(u.id) ? corrected.get(u.id)! : u.feedback),
    next: t(u.nextAction),
    blocker: t(u.blocker),
    changes: t((u.changes as FieldChange[]).filter((c) => !["feedback", "nextAction", "blocker"].includes(c.field)).map((c) => `${c.label}: ${c.oldValue ?? "—"} → ${c.newValue ?? "—"}`).join("\n")),
    by: t(u.createdBy),
    corrected: corrected.has(u.id) ? "Yes" : "No",
  })), "No updates were recorded in this meeting.");


  const fileName = `IA-Weekly-Meeting-${meeting.meetingDate}.xlsx`;
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, fileName, rowCount: agenda.length };
}

export function assertMeetingRequest(req: ExportRequest) {
  if (req.type === "MEETING" && !req.meetingId) throw badRequest("Select a meeting to export");
}
