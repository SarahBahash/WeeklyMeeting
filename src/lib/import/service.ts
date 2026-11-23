import "server-only";
import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import { Prisma, type ImportKind } from "@prisma/client";
import { prisma } from "../db";
import { can, type AuthUser } from "../auth/permissions";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../errors";
import { auditLog } from "../audit";
import { config } from "../config";
import { isoToDate } from "../dates";
import { normalizeStatus } from "../domain";
import { DEFAULT_LIMITS, UploadRejected, validateXlsxContainer } from "./xlsx-guard";
import { titleSimilarity } from "./cells";
import {
  HIST_FIELDS, MAIN_FIELDS, parseHistoricalSheet, parseMainSheet, parseStageSheet,
  type FieldMap, type HistField, type MainField, type MainRow, type HistRow, type ParsedStagePart,
} from "./parsers";

const DEFAULT_SHEETS: Record<ImportKind, string> = { MAIN_TRACKER: "IA-MOM", HISTORICAL: "IA-MOM (2)", STAGE_TEMPLATE: "Sheet1" };

export const previewOptionsSchema = z.object({
  kind: z.enum(["MAIN_TRACKER", "HISTORICAL", "STAGE_TEMPLATE"]),
  sheetName: z.string().max(100).optional(),
  mapping: z.record(z.string().max(30), z.number().int().min(1).max(60).nullable()).optional(),
});

export const commitSchema = z.object({
  decisions: z.record(z.string().regex(/^\d+$/), z.enum(["import", "skip"])).default({}),
  templateName: z.string().trim().min(2).max(120).optional(),
});

export interface PreviewPayload {
  sheets: string[];
  sheetName: string;
  headerRow: number | null;
  titleText: string | null;
  headers: { col: number; text: string }[];
  mapping: Record<string, number | null>;
  fields: { key: string; label: string }[];
  previouslyCommitted: { batchId: string; committedAt: string | null }[];
  rows: (MainRow | HistRow)[];
  stages?: ParsedStagePart[];
  issues: { level: string; message: string }[];
  stats: Record<string, number>;
}

async function loadWorkbook(buf: Buffer) {
  validateXlsxContainer(buf, { ...DEFAULT_LIMITS, maxBytes: config.maxUploadBytes });
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new UploadRejected("The workbook could not be read. Please check that it is a valid .xlsx file.");
  }
  return wb;
}

export async function createPreview(
  user: AuthUser,
  file: { name: string; buffer: Buffer },
  opts: z.infer<typeof previewOptionsSchema>,
  ip: string | null,
) {
  if (!can(user, "admin:import")) throw forbidden();
  if (!/\.xlsx$/i.test(file.name)) throw badRequest("Only .xlsx workbooks can be imported.");
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadWorkbook(file.buffer);
  } catch (e) {
    if (e instanceof UploadRejected) {
      await auditLog(user, "import.rejected", { details: { fileName: file.name.slice(0, 200), reason: e.message }, ip });
      throw new ApiError(422, e.message);
    }
    throw e;
  }
  const sha = createHash("sha256").update(file.buffer).digest("hex");
  const sheets = wb.worksheets.map((w) => w.name);
  const wanted = opts.sheetName ?? DEFAULT_SHEETS[opts.kind];
  const ws = wb.getWorksheet(wanted) ?? (opts.sheetName ? undefined : wb.worksheets[0]);
  if (!ws) throw badRequest(`Worksheet "${wanted}" was not found in the workbook.`);

  const previouslyCommitted = (
    await prisma.importBatch.findMany({
      where: { fileSha256: sha, sheetName: ws.name, kind: opts.kind, status: "COMMITTED" },
      select: { id: true, committedAt: true },
    })
  ).map((b) => ({ batchId: b.id, committedAt: b.committedAt?.toISOString() ?? null }));

  let payload: PreviewPayload;
  const keyFor = (row: number) => `${sha}:${ws.name}:${row}`;

  if (opts.kind === "MAIN_TRACKER") {
    const parsed = parseMainSheet(ws, opts.mapping as Partial<FieldMap<MainField>> | undefined);
    const issues = [];
    if (!parsed.headerRow) issues.push({ level: "error", message: "Could not find the header row (SN, Action points / Project, Status …). Map the columns manually." });
    if (parsed.headerRow && !parsed.mapping.title) issues.push({ level: "error", message: "The 'Action points / Project' column must be mapped." });
    const dataRows = parsed.rows.filter((r) => r.kind === "data");
    const imported = new Set(
      (await prisma.actionPoint.findMany({ where: { importKey: { in: dataRows.map((r) => keyFor(r.rowNumber)) } }, select: { importKey: true } })).map((a) => a.importKey),
    );
    const existing = await prisma.actionPoint.findMany({ select: { id: true, title: true, ownerName: true, importKey: true } });
    const seen = new Map<string, number>();
    for (const r of dataRows) {
      if (imported.has(keyFor(r.rowNumber))) {
        r.alreadyImported = true;
        r.suggested = "skip";
        r.issues.push({ level: "info", message: "Already imported from this workbook – will be skipped" });
        continue;
      }
      const dups = existing
        .map((e) => ({ id: e.id, title: e.title, ownerName: e.ownerName, score: titleSimilarity(e.title, r.values.title) }))
        .filter((d) => d.score >= 0.9)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      if (dups.length) {
        r.duplicateOf = dups;
        r.suggested = "skip";
        r.issues.push({ level: "warning", message: "Possible duplicate of an existing action point – review before importing" });
      }
      const k = `${r.values.title.toLowerCase().trim()}|${r.values.owner.toLowerCase().trim()}`;
      if (seen.has(k)) r.issues.push({ level: "warning", message: `Same title and owner as row ${seen.get(k)}` });
      else seen.set(k, r.rowNumber);
    }
    const stats: Record<string, number> = {
      totalRows: parsed.rows.length,
      dataRows: dataRows.length,
      headerRepeats: parsed.rows.filter((r) => r.kind === "header_repeat").length,
      titleRepeats: parsed.rows.filter((r) => r.kind === "title_repeat").length,
      blankRows: parsed.rows.filter((r) => r.kind === "blank").length,
      invalidRows: parsed.rows.filter((r) => r.kind === "invalid").length,
      possibleDuplicates: dataRows.filter((r) => r.duplicateOf?.length).length,
      alreadyImported: dataRows.filter((r) => r.alreadyImported).length,
      withWarnings: dataRows.filter((r) => r.issues.some((i) => i.level === "warning")).length,
      blankStages: dataRows.filter((r) => !r.values.stage).length,
      textDates: dataRows.filter((r) => r.parsed?.target.text || r.parsed?.revised.text).length,
    };
    for (const s of ["IN_PROGRESS", "COMPLETED", "CLOSED", "ON_HOLD", "NOT_STARTED"]) {
      stats[`status_${s}`] = dataRows.filter((r) => (r.parsed?.status ?? "NOT_STARTED") === s).length;
    }
    payload = {
      sheets, sheetName: ws.name, headerRow: parsed.headerRow, titleText: parsed.titleText, headers: parsed.headers,
      mapping: parsed.mapping, fields: MAIN_FIELDS.map((k) => ({ key: k, label: k })), previouslyCommitted,
      rows: parsed.rows, issues, stats,
    };
  } else if (opts.kind === "HISTORICAL") {
    const parsed = parseHistoricalSheet(ws, opts.mapping as Partial<FieldMap<HistField>> | undefined);
    const issues = [];
    if (!parsed.headerRow) issues.push({ level: "error", message: "Could not find the header row of the historical tracker." });
    const dataRows = parsed.rows.filter((r) => r.kind === "data");
    const imported = new Set(
      (await prisma.legacyHistoryRecord.findMany({ where: { importKey: { in: dataRows.map((r) => keyFor(r.rowNumber)) } }, select: { importKey: true } })).map((a) => a.importKey),
    );
    const existing = await prisma.actionPoint.findMany({ select: { id: true, title: true, ownerName: true } });
    for (const r of dataRows) {
      if (imported.has(keyFor(r.rowNumber))) {
        r.alreadyImported = true;
        r.issues.push({ level: "info", message: "Already imported – will be skipped" });
      }
      const text = [r.values.title, r.values.project].filter(Boolean).join(" ");
      r.candidates = existing
        .map((e) => ({ id: e.id, title: e.title, ownerName: e.ownerName, score: Math.max(titleSimilarity(e.title, r.values.title || ""), titleSimilarity(e.title, text)) }))
        .filter((d) => d.score >= 0.6)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      if (r.candidates.length) r.issues.push({ level: "warning", message: "Possible duplicate of an existing action point" });
    }
    payload = {
      sheets, sheetName: ws.name, headerRow: parsed.headerRow, titleText: parsed.titleText, headers: parsed.headers,
      mapping: parsed.mapping, fields: HIST_FIELDS.map((k) => ({ key: k, label: k })), previouslyCommitted,
      rows: parsed.rows, issues,
      stats: {
        totalRows: parsed.rows.length,
        dataRows: dataRows.length,
        possibleDuplicates: dataRows.filter((r) => r.candidates?.length).length,
        alreadyImported: dataRows.filter((r) => r.alreadyImported).length,
        invalidRows: parsed.rows.filter((r) => r.kind === "invalid").length,
        headerRepeats: parsed.rows.filter((r) => r.kind === "header_repeat").length,
      },
    };
  } else {
    const parsed = parseStageSheet(ws);
    payload = {
      sheets, sheetName: ws.name, headerRow: null, titleText: null, headers: [], mapping: {}, fields: [], previouslyCommitted,
      rows: [], stages: parsed.parts, issues: parsed.issues,
      stats: { parts: parsed.parts.length, stages: parsed.parts.reduce((n, p) => n + p.steps.length, 0) },
    };
  }

  // Only one open preview per admin.
  await prisma.importBatch.updateMany({
    where: { uploadedById: user.id, status: "PREVIEW" },
    data: { status: "CANCELLED", cancelledAt: new Date(), preview: {} },
  });
  const batch = await prisma.importBatch.create({
    data: {
      kind: opts.kind,
      fileName: file.name.slice(0, 200),
      fileSha256: sha,
      fileSize: file.buffer.length,
      sheetName: ws.name,
      preview: payload as unknown as Prisma.InputJsonValue,
      uploadedById: user.id,
    },
  });
  await auditLog(user, "import.preview", { entityType: "ImportBatch", entityId: batch.id, details: { kind: opts.kind, fileName: batch.fileName, sheet: ws.name, sha256: sha, stats: payload.stats }, ip });
  return { batchId: batch.id, kind: opts.kind, fileName: batch.fileName, ...payload };
}

export async function getBatch(user: AuthUser, id: string) {
  if (!can(user, "admin:import")) throw forbidden();
  const b = await prisma.importBatch.findUnique({ where: { id }, include: { uploadedBy: { select: { name: true } } } });
  if (!b) throw notFound("Import batch");
  return b;
}

export async function listBatches(user: AuthUser) {
  if (!can(user, "admin:import")) throw forbidden();
  const rows = await prisma.importBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, kind: true, status: true, fileName: true, sheetName: true, fileSha256: true, createdAt: true, committedAt: true, summary: true, uploadedBy: { select: { name: true } } },
  });
  return rows.map((r) => ({ ...r, uploadedBy: r.uploadedBy.name, fileSha256: r.fileSha256.slice(0, 12) }));
}

export async function cancelBatch(user: AuthUser, id: string, ip: string | null) {
  if (!can(user, "admin:import")) throw forbidden();
  const res = await prisma.importBatch.updateMany({ where: { id, status: "PREVIEW" }, data: { status: "CANCELLED", cancelledAt: new Date(), preview: {} } });
  if (res.count !== 1) throw conflict("This import is no longer awaiting confirmation.");
  await auditLog(user, "import.cancel", { entityType: "ImportBatch", entityId: id, ip });
  return { ok: true };
}

export async function commitBatch(user: AuthUser, id: string, input: z.infer<typeof commitSchema>, ip: string | null) {
  if (!can(user, "admin:import")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    // Row lock: two concurrent "Confirm" clicks cannot both commit.
    const locked = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT id, status FROM import_batches WHERE id = ${id} FOR UPDATE`;
    if (!locked.length) throw notFound("Import batch");
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id } });
    if (batch.status === "COMMITTED") return { alreadyCommitted: true, summary: batch.summary };
    if (batch.status !== "PREVIEW") throw conflict("This import was cancelled. Upload the workbook again.");
    if (batch.uploadedById !== user.id) throw forbidden("Only the administrator who uploaded this workbook can confirm it.");
    const preview = batch.preview as unknown as PreviewPayload;
    if (preview.issues?.some((i) => i.level === "error")) throw badRequest("Resolve the errors in the preview before importing.");
    const key = (row: number) => `${batch.fileSha256}:${batch.sheetName}:${row}`;
    let summary: Record<string, unknown>;

    if (batch.kind === "MAIN_TRACKER") {
      const rows = (preview.rows as MainRow[]).filter((r) => r.kind === "data");
      const chosen = rows.filter((r) => !r.alreadyImported && (input.decisions[String(r.rowNumber)] ?? r.suggested) === "import");
      const max = await tx.actionPoint.aggregate({ _max: { sortOrder: true } });
      const base = max._max.sortOrder ?? 0;
      const created = await tx.actionPoint.createManyAndReturn({
        data: chosen.map((r, i) => {
          const p = r.parsed!;
          return {
            legacySn: r.values.sn || null,
            title: r.values.title.slice(0, 500),
            currentStage: r.values.stage || null,
            ownerName: r.values.owner || null,
            originalTargetDate: p.target.date ? isoToDate(p.target.date) : null,
            originalTargetText: p.target.text,
            revisedTargetDate: p.revised.date ? isoToDate(p.revised.date) : null,
            revisedTargetText: p.revised.text,
            priority: p.priority,
            status: p.status ?? "NOT_STARTED",
            feedback: r.values.feedback || null,
            sortOrder: base + i + 1,
            sourceStatus: r.original?.status || r.values.status || null,
            sourceDelays: r.original?.delays || r.values.delays || null,
            sourcePriority: r.original?.priority || r.values.priority || null,
            sourceTargetRaw: p.target.raw,
            sourceRevisedRaw: p.revised.raw,
            sourceSheet: batch.sheetName,
            sourceRow: r.rowNumber,
            importKey: key(r.rowNumber),
            importBatchId: batch.id,
            createdById: user.id,
            updatedById: user.id,
          };
        }),
        skipDuplicates: true,
        select: { id: true, sourceRow: true, status: true },
      });
      if (created.length) {
        await tx.actionPointChange.createMany({
          data: created.map((c) => ({
            actionPointId: c.id,
            changeGroupId: randomUUID(),
            field: "record",
            newValue: `Imported from "${batch.fileName}", sheet ${batch.sheetName}, row ${c.sourceRow}`,
            source: "IMPORT" as const,
            changedById: user.id,
          })),
        });
      }
      const byStatus: Record<string, number> = {};
      for (const c of created) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      summary = {
        created: created.length,
        skippedByDecision: rows.filter((r) => !r.alreadyImported).length - chosen.length,
        alreadyImported: rows.filter((r) => r.alreadyImported).length + (chosen.length - created.length),
        invalidRows: preview.stats.invalidRows ?? 0,
        headerRepeats: preview.stats.headerRepeats ?? 0,
        titleRepeats: preview.stats.titleRepeats ?? 0,
        byStatus,
      };
    } else if (batch.kind === "HISTORICAL") {
      const rows = (preview.rows as HistRow[]).filter((r) => r.kind === "data" && !r.alreadyImported);
      const res = await tx.legacyHistoryRecord.createMany({
        data: rows.map((r) => ({
          importBatchId: batch.id,
          importKey: key(r.rowNumber),
          sourceSheet: batch.sheetName,
          sourceRow: r.rowNumber,
          actionText: r.values.title || null,
          projectText: r.values.project || null,
          ownerText: r.values.owner || null,
          meetingDateRaw: r.meetingDate?.raw ?? null,
          meetingDate: r.meetingDate?.date ? isoToDate(r.meetingDate.date) : null,
          targetDateRaw: r.values.target || null,
          revisedDateRaw: r.values.revised || null,
          statusRaw: r.values.status || null,
          feedback: r.values.feedback || null,
        })),
        skipDuplicates: true,
      });
      summary = { storedForReview: res.count, alreadyImported: (preview.stats.alreadyImported ?? 0) + (rows.length - res.count) };
    } else {
      const parts = preview.stages ?? [];
      if (!parts.length) throw badRequest("No stages to import.");
      const name = input.templateName ?? `Audit lifecycle (from ${batch.fileName.replace(/\.xlsx$/i, "")} – ${batch.sheetName})`;
      const exists = await tx.auditStageTemplate.findUnique({ where: { name } });
      if (exists) throw conflict(`A template named "${name}" already exists. Choose another name.`);
      let order = 0;
      const t = await tx.auditStageTemplate.create({
        data: {
          name,
          sourceNote: `Imported from ${batch.fileName} / ${batch.sheetName}`,
          stages: { create: parts.flatMap((p) => p.steps.map((s) => ({ partNumber: p.partNumber, partName: p.partName, name: s.name, sortOrder: ++order }))) },
        },
      });
      summary = { templateId: t.id, templateName: name, stages: order, parts: parts.length };
    }

    await tx.importBatch.update({ where: { id }, data: { status: "COMMITTED", committedAt: new Date(), summary: summary as Prisma.InputJsonValue } });
    await auditLog(user, "import.commit", { entityType: "ImportBatch", entityId: id, details: { kind: batch.kind, ...summary } as Prisma.InputJsonValue, ip }, tx);
    return { alreadyCommitted: false, summary };
  }, { timeout: 60_000 });
}

// ------------------------------------------------------------------ historical record decisions

export const legacyDecisionSchema = z.object({
  decision: z.enum(["RETAIN", "MERGE", "SKIP", "PENDING"]),
  actionPointId: z.string().max(40).optional(),
});

export async function decideLegacy(user: AuthUser, id: string, input: z.infer<typeof legacyDecisionSchema>, ip: string | null) {
  if (!can(user, "admin:import")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM legacy_history_records WHERE id = ${id} FOR UPDATE`;
    const rec = await tx.legacyHistoryRecord.findUnique({ where: { id } });
    if (!rec) throw notFound("Historical record");
    if (rec.decision === "RETAIN" || rec.decision === "MERGE") {
      throw conflict("This historical record has already been retained or merged; the decision cannot be changed.");
    }
    let linked: string | null = null;
    if (input.decision === "RETAIN") {
      const st = normalizeStatus(rec.statusRaw);
      const max = await tx.actionPoint.aggregate({ _max: { sortOrder: true } });
      const ap = await tx.actionPoint.create({
        data: {
          title: (rec.actionText || rec.projectText || "Historical item").slice(0, 500),
          ownerName: rec.ownerText,
          status: st.status ?? "NOT_STARTED",
          feedback: rec.feedback,
          originalTargetText: rec.targetDateRaw,
          revisedTargetText: rec.revisedDateRaw,
          sourceStatus: rec.statusRaw,
          sourceTargetRaw: rec.targetDateRaw,
          sourceRevisedRaw: rec.revisedDateRaw,
          sourceSheet: rec.sourceSheet,
          sourceRow: rec.sourceRow,
          importKey: rec.importKey,
          importBatchId: rec.importBatchId,
          sortOrder: (max._max.sortOrder ?? 0) + 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      // Dates from the historical sheet are kept as text; try to convert ISO-looking ones.
      const toDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? isoToDate(v) : null);
      const o = toDate(rec.targetDateRaw), rv = toDate(rec.revisedDateRaw);
      if (o || rv) {
        await tx.actionPoint.update({
          where: { id: ap.id },
          data: { originalTargetDate: o, originalTargetText: o ? null : rec.targetDateRaw, revisedTargetDate: rv, revisedTargetText: rv ? null : rec.revisedDateRaw },
        });
      }
      await tx.actionPointChange.create({
        data: { actionPointId: ap.id, changeGroupId: randomUUID(), field: "record", newValue: `Retained from historical tracker (${rec.sourceSheet}, row ${rec.sourceRow})`, source: "HISTORICAL_MERGE", changedById: user.id },
      });
      linked = ap.id;
    } else if (input.decision === "MERGE") {
      if (!input.actionPointId) throw badRequest("Choose the action point to merge this historical record into.");
      const ap = await tx.actionPoint.findUnique({ where: { id: input.actionPointId } });
      if (!ap) throw notFound("Action point");
      await tx.actionPointChange.create({
        data: {
          actionPointId: ap.id,
          changeGroupId: randomUUID(),
          field: "historicalRecord",
          newValue: [
            rec.meetingDateRaw ? `Meeting ${rec.meetingDateRaw}` : null,
            rec.statusRaw ? `Status: ${rec.statusRaw}` : null,
            rec.feedback ? `Feedback: ${rec.feedback}` : null,
          ].filter(Boolean).join(" · ") || "Historical record linked",
          source: "HISTORICAL_MERGE",
          changedById: user.id,
        },
      });
      linked = ap.id;
    }
    await tx.legacyHistoryRecord.update({
      where: { id },
      data: { decision: input.decision, linkedActionPointId: linked, decidedById: user.id, decidedAt: new Date() },
    });
    await auditLog(user, "import.historical.decision", { entityType: "LegacyHistoryRecord", entityId: id, details: { decision: input.decision, actionPointId: linked }, ip }, tx);
    return { ok: true, linkedActionPointId: linked };
  });
}
