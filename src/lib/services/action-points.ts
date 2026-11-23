import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, ChangeSource } from "@prisma/client";
import { prisma } from "../db";
import { can, type AuthUser } from "../auth/permissions";
import { visibleActionPoints } from "../visibility";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../errors";
import { dateToISO, isoToDate, isValidISODate, todayInRiyadh, type ISODate } from "../dates";
import {
  ACTIVE_STATUSES, PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, computeDeadlineInfo,
  type DeadlineInfo, type Priority, type Status,
} from "../domain";

type Tx = Prisma.TransactionClient;

export const apInclude = {
  activityType: true,
  project: { select: { id: true, name: true } },
  projectStage: { select: { id: true, name: true } },
  createdBy: { select: { name: true } },
  updatedBy: { select: { name: true } },
} satisfies Prisma.ActionPointInclude;

export type ApRecord = Prisma.ActionPointGetPayload<{ include: typeof apInclude }>;

export interface ActionPointDTO {
  id: string;
  legacySn: string | null;
  title: string;
  activityType: { id: string; name: string; code: string; supportsStages: boolean } | null;
  project: { id: string; name: string } | null;
  projectStage: { id: string; name: string } | null;
  currentStage: string | null;
  ownerName: string | null;
  originalTargetDate: ISODate | null;
  originalTargetText: string | null;
  revisedTargetDate: ISODate | null;
  revisedTargetText: string | null;
  priority: Priority | null;
  status: Status;
  feedback: string | null;
  nextAction: string | null;
  blocker: string | null;
  restricted: boolean;
  sortOrder: number;
  version: number;
  sourceStatus: string | null;
  sourceDelays: string | null;
  sourcePriority: string | null;
  sourceSheet: string | null;
  sourceRow: number | null;
  createdInMeetingId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  deadline: DeadlineInfo;
}

export function toDTO(r: ApRecord, today: ISODate = todayInRiyadh()): ActionPointDTO {
  const originalTargetDate = dateToISO(r.originalTargetDate);
  const revisedTargetDate = dateToISO(r.revisedTargetDate);
  return {
    id: r.id,
    legacySn: r.legacySn,
    title: r.title,
    activityType: r.activityType
      ? { id: r.activityType.id, name: r.activityType.name, code: r.activityType.code, supportsStages: r.activityType.supportsStages }
      : null,
    project: r.project,
    projectStage: r.projectStage,
    currentStage: r.currentStage,
    ownerName: r.ownerName,
    originalTargetDate,
    originalTargetText: r.originalTargetText,
    revisedTargetDate,
    revisedTargetText: r.revisedTargetText,
    priority: r.priority,
    status: r.status,
    feedback: r.feedback,
    nextAction: r.nextAction,
    blocker: r.blocker,
    restricted: r.restricted,
    sortOrder: r.sortOrder,
    version: r.version,
    sourceStatus: r.sourceStatus,
    sourceDelays: r.sourceDelays,
    sourcePriority: r.sourcePriority,
    sourceSheet: r.sourceSheet,
    sourceRow: r.sourceRow,
    createdInMeetingId: r.createdInMeetingId,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    createdBy: r.createdBy?.name ?? null,
    updatedBy: r.updatedBy?.name ?? null,
    deadline: computeDeadlineInfo({ originalTargetDate, revisedTargetDate, status: r.status }, today),
  };
}

// ------------------------------------------------------------------ validation

const optText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(max).nullable()).optional();
const optId = z.preprocess((v) => (v === "" ? null : v), z.string().max(40).nullable()).optional();
export const isoDateSchema = z.string().refine(isValidISODate, "Must be a valid date (YYYY-MM-DD)");
const optDate = z.preprocess((v) => (v === "" ? null : v), isoDateSchema.nullable()).optional();

export const updateFieldsSchema = z.object({
  title: z.string().trim().min(1, "Action point / project is required").max(500).optional(),
  activityTypeId: optId,
  projectId: optId,
  projectStageId: optId,
  currentStage: optText(200),
  ownerName: optText(200),
  originalTargetDate: optDate,
  revisedTargetDate: optDate,
  priority: z.preprocess((v) => (v === "" ? null : v), z.enum(PRIORITIES).nullable()).optional(),
  status: z.enum(STATUSES).optional(),
  feedback: optText(10_000),
  nextAction: optText(2_000),
  blocker: optText(2_000),
  restricted: z.boolean().optional(),
  deadlineReason: optText(500),
});
export type UpdateFields = z.infer<typeof updateFieldsSchema>;

export const patchSchema = updateFieldsSchema.extend({ version: z.number().int().positive() });

export const createSchema = z.object({
  title: z.string().trim().min(1, "Action point / project is required").max(500),
  activityTypeId: optId,
  projectId: optId,
  projectStageId: optId,
  currentStage: optText(200),
  ownerName: optText(200),
  originalTargetDate: optDate,
  priority: z.preprocess((v) => (v === "" ? null : v), z.enum(PRIORITIES).nullable()).optional(),
  status: z.enum(STATUSES).default("IN_PROGRESS"),
  feedback: optText(10_000),
  nextAction: optText(2_000),
  restricted: z.boolean().optional(),
  clientRequestId: z.string().min(8).max(64).optional(),
});
export type CreateInput = z.infer<typeof createSchema>;

// ------------------------------------------------------------------ queries

export async function getVisibleActionPoint(user: AuthUser, id: string, tx: Tx = prisma) {
  const rec = await tx.actionPoint.findFirst({ where: { id, ...visibleActionPoints(user) }, include: apInclude });
  if (!rec) throw notFound("Action point");
  return rec;
}

export interface ListFilters {
  status?: string[];
  activityTypeId?: string;
  projectId?: string;
  owner?: string;
  priority?: string;
  stage?: string;
  q?: string;
  overdue?: boolean;
  dueSoon?: boolean;
  ids?: string[];
}

export function buildWhere(user: AuthUser, f: ListFilters, today: ISODate = todayInRiyadh()): Prisma.ActionPointWhereInput {
  const and: Prisma.ActionPointWhereInput[] = [visibleActionPoints(user)];
  const statuses = (f.status ?? []).filter((s): s is Status => (STATUSES as readonly string[]).includes(s));
  if (statuses.length) and.push({ status: { in: statuses } });
  if (f.activityTypeId === "none") and.push({ activityTypeId: null });
  else if (f.activityTypeId) and.push({ activityTypeId: f.activityTypeId });
  if (f.projectId === "none") and.push({ projectId: null });
  else if (f.projectId) and.push({ projectId: f.projectId });
  if (f.owner) and.push({ ownerName: { equals: f.owner, mode: "insensitive" } });
  if (f.priority === "none") and.push({ priority: null });
  else if (f.priority && (PRIORITIES as readonly string[]).includes(f.priority)) and.push({ priority: f.priority as Priority });
  if (f.stage === "none") and.push({ OR: [{ currentStage: null }, { currentStage: "" }] });
  else if (f.stage) and.push({ currentStage: { equals: f.stage, mode: "insensitive" } });
  if (f.ids?.length) and.push({ id: { in: f.ids } });
  if (f.q) {
    const q = f.q.slice(0, 200);
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { ownerName: { contains: q, mode: "insensitive" } },
        { feedback: { contains: q, mode: "insensitive" } },
        { currentStage: { contains: q, mode: "insensitive" } },
        { legacySn: { equals: q } },
        { project: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const todayDate = isoToDate(today);
  if (f.overdue) {
    and.push({ status: { in: ACTIVE_STATUSES } });
    and.push({ OR: [{ revisedTargetDate: { lt: todayDate } }, { revisedTargetDate: null, originalTargetDate: { lt: todayDate } }] });
  }
  if (f.dueSoon) {
    const end = new Date(todayDate.getTime() + 7 * 86_400_000);
    and.push({ status: { in: ACTIVE_STATUSES } });
    and.push({
      OR: [
        { revisedTargetDate: { gte: todayDate, lte: end } },
        { revisedTargetDate: null, originalTargetDate: { gte: todayDate, lte: end } },
      ],
    });
  }
  return { AND: and };
}

export const defaultOrder: Prisma.ActionPointOrderByWithRelationInput[] = [{ sortOrder: "asc" }, { createdAt: "asc" }];

// ------------------------------------------------------------------ mutation

export interface FieldChange {
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
}

export const FIELD_LABELS: Record<string, string> = {
  record: "Record",
  title: "Action Point / Project",
  activityType: "Activity Type",
  project: "Related Project",
  projectStage: "Project Stage",
  currentStage: "Current Stage",
  ownerName: "Process Owner",
  originalTargetDate: "Original Target Date",
  revisedTargetDate: "Revised Target Date",
  revisedTargetText: "Revised Date (text)",
  priority: "Priority",
  status: "Status",
  feedback: "Feedback",
  nextAction: "Next Action",
  blocker: "Notes / Blocker",
  restricted: "Restricted",
};

interface MutationCtx {
  source: ChangeSource;
  meetingId?: string | null;
}

function same(a: unknown, b: unknown) {
  return (a ?? null) === (b ?? null);
}

/**
 * Applies a validated update with optimistic concurrency, field-level change history
 * and deadline history. Must be called inside a transaction.
 */
export async function applyUpdate(
  tx: Tx,
  user: AuthUser,
  id: string,
  expectedVersion: number,
  input: UpdateFields,
  ctx: MutationCtx,
): Promise<{ record: ApRecord; changes: FieldChange[] }> {
  if (!can(user, "actionPoint:write")) throw forbidden();
  const current = await getVisibleActionPoint(user, id, tx);
  if (current.version !== expectedVersion) {
    throw conflict("This action point was changed by someone else since you opened it.", {
      conflict: true,
      current: toDTO(current),
    });
  }

  const data: Prisma.ActionPointUncheckedUpdateInput = {};
  const changes: FieldChange[] = [];
  const push = (field: string, oldValue: string | null, newValue: string | null) =>
    changes.push({ field, label: FIELD_LABELS[field] ?? field, oldValue, newValue });

  if (input.title !== undefined && !same(input.title, current.title)) {
    data.title = input.title;
    push("title", current.title, input.title);
  }
  for (const f of ["currentStage", "ownerName", "feedback", "nextAction", "blocker"] as const) {
    const v = input[f];
    if (v !== undefined && !same(v, current[f])) {
      data[f] = v;
      push(f, current[f], v);
    }
  }
  if (input.status !== undefined && input.status !== current.status) {
    data.status = input.status;
    push("status", STATUS_LABEL[current.status], STATUS_LABEL[input.status]);
  }
  if (input.priority !== undefined && !same(input.priority, current.priority)) {
    data.priority = input.priority;
    push("priority", current.priority ? PRIORITY_LABEL[current.priority] : null, input.priority ? PRIORITY_LABEL[input.priority] : null);
  }
  if (input.restricted !== undefined && input.restricted !== current.restricted) {
    if (!can(user, "actionPoint:setRestricted")) throw forbidden("Only administrators can change record restrictions");
    data.restricted = input.restricted;
    push("restricted", current.restricted ? "Yes" : "No", input.restricted ? "Yes" : "No");
  }
  if (input.activityTypeId !== undefined && !same(input.activityTypeId, current.activityTypeId)) {
    let name: string | null = null;
    if (input.activityTypeId) {
      const t = await tx.activityType.findFirst({ where: { id: input.activityTypeId, isActive: true } });
      if (!t) throw badRequest("Unknown activity type");
      name = t.name;
    }
    data.activityTypeId = input.activityTypeId;
    push("activityType", current.activityType?.name ?? "Unclassified", name ?? "Unclassified");
  }
  let projectId = current.projectId;
  if (input.projectId !== undefined && !same(input.projectId, current.projectId)) {
    let name: string | null = null;
    if (input.projectId) {
      const p = await tx.project.findUnique({ where: { id: input.projectId } });
      if (!p) throw badRequest("Unknown project");
      name = p.name;
    }
    projectId = input.projectId ?? null;
    data.projectId = projectId;
    push("project", current.project?.name ?? null, name);
    // A stage belongs to a project; clear it when the project changes unless a new stage is given.
    if (input.projectStageId === undefined && current.projectStageId) input = { ...input, projectStageId: null };
  }
  if (input.projectStageId !== undefined && !same(input.projectStageId, current.projectStageId)) {
    let name: string | null = null;
    if (input.projectStageId) {
      const s = await tx.projectStage.findUnique({ where: { id: input.projectStageId } });
      if (!s || s.projectId !== projectId) throw badRequest("The selected stage does not belong to the related project");
      name = s.name;
    }
    data.projectStageId = input.projectStageId;
    push("projectStage", current.projectStage?.name ?? null, name);
  }

  const deadlineEntries: Prisma.DeadlineChangeUncheckedCreateInput[] = [];
  const curOriginal = dateToISO(current.originalTargetDate);
  if (input.originalTargetDate !== undefined && !same(input.originalTargetDate, curOriginal)) {
    const isCorrection = curOriginal !== null || current.originalTargetText !== null;
    if (isCorrection) {
      if (!can(user, "actionPoint:correctOriginalDate")) {
        throw forbidden("Only administrators can correct an original target date. Use the Revised Date to change the deadline.");
      }
      if (!input.deadlineReason) throw badRequest("A reason is required when correcting the original target date");
    }
    data.originalTargetDate = input.originalTargetDate ? isoToDate(input.originalTargetDate) : null;
    push("originalTargetDate", curOriginal ?? current.originalTargetText, input.originalTargetDate ?? null);
    deadlineEntries.push({
      actionPointId: id,
      kind: "ORIGINAL_CORRECTION",
      previousDate: current.originalTargetDate,
      previousText: current.originalTargetText,
      newDate: input.originalTargetDate ? isoToDate(input.originalTargetDate) : null,
      reason: input.deadlineReason ?? (isCorrection ? null : "Original target date set"),
      meetingId: ctx.meetingId ?? null,
      changedById: user.id,
    });
  }
  const curRevised = dateToISO(current.revisedTargetDate);
  if (input.revisedTargetDate !== undefined && !same(input.revisedTargetDate, curRevised)) {
    data.revisedTargetDate = input.revisedTargetDate ? isoToDate(input.revisedTargetDate) : null;
    push("revisedTargetDate", curRevised ?? current.revisedTargetText, input.revisedTargetDate ?? null);
    if (current.revisedTargetText && input.revisedTargetDate) {
      // The imported text (e.g. "Ongoing") is preserved in sourceRevisedRaw and in history.
      data.revisedTargetText = null;
    }
    deadlineEntries.push({
      actionPointId: id,
      kind: "REVISION",
      previousDate: current.revisedTargetDate ?? current.originalTargetDate,
      previousText: current.revisedTargetDate ? null : (current.revisedTargetText ?? current.originalTargetText),
      newDate: input.revisedTargetDate ? isoToDate(input.revisedTargetDate) : null,
      reason: input.deadlineReason ?? null,
      meetingId: ctx.meetingId ?? null,
      changedById: user.id,
    });
  }

  if (changes.length === 0) return { record: current, changes };

  const res = await tx.actionPoint.updateMany({
    where: { id, version: expectedVersion },
    data: { ...(data as Prisma.ActionPointUncheckedUpdateManyInput), version: { increment: 1 }, updatedById: user.id },
  });
  if (res.count !== 1) {
    const latest = await getVisibleActionPoint(user, id, tx);
    throw conflict("This action point was changed by someone else since you opened it.", { conflict: true, current: toDTO(latest) });
  }
  const changeGroupId = randomUUID();
  await tx.actionPointChange.createMany({
    data: changes.map((c) => ({
      actionPointId: id,
      changeGroupId,
      field: c.field,
      oldValue: c.oldValue,
      newValue: c.newValue,
      source: ctx.source,
      meetingId: ctx.meetingId ?? null,
      changedById: user.id,
    })),
  });
  if (deadlineEntries.length) await tx.deadlineChange.createMany({ data: deadlineEntries });
  const record = await tx.actionPoint.findUniqueOrThrow({ where: { id }, include: apInclude });
  return { record, changes };
}

export async function createActionPoint(
  tx: Tx,
  user: AuthUser,
  input: CreateInput,
  ctx: MutationCtx,
): Promise<{ record: ApRecord; created: boolean }> {
  if (!can(user, "actionPoint:write")) throw forbidden();
  if (input.restricted && !can(user, "actionPoint:setRestricted")) throw forbidden("Only administrators can create restricted records");
  if (input.clientRequestId) {
    const existing = await tx.actionPoint.findUnique({ where: { clientRequestId: input.clientRequestId }, include: apInclude });
    if (existing) {
      if (existing.createdById !== user.id) throw new ApiError(409, "Duplicate request identifier");
      return { record: existing, created: false };
    }
  }
  if (input.activityTypeId) {
    const t = await tx.activityType.findFirst({ where: { id: input.activityTypeId, isActive: true } });
    if (!t) throw badRequest("Unknown activity type");
  }
  if (input.projectId) {
    const p = await tx.project.findUnique({ where: { id: input.projectId } });
    if (!p) throw badRequest("Unknown project");
  }
  if (input.projectStageId) {
    const s = await tx.projectStage.findUnique({ where: { id: input.projectStageId } });
    if (!s || s.projectId !== input.projectId) throw badRequest("The selected stage does not belong to the related project");
  }
  const max = await tx.actionPoint.aggregate({ _max: { sortOrder: true } });
  const rec = await tx.actionPoint.create({
    data: {
      title: input.title,
      activityTypeId: input.activityTypeId ?? null,
      projectId: input.projectId ?? null,
      projectStageId: input.projectStageId ?? null,
      currentStage: input.currentStage ?? null,
      ownerName: input.ownerName ?? null,
      originalTargetDate: input.originalTargetDate ? isoToDate(input.originalTargetDate) : null,
      priority: input.priority ?? null,
      status: input.status,
      feedback: input.feedback ?? null,
      nextAction: input.nextAction ?? null,
      restricted: input.restricted ?? false,
      sortOrder: (max._max.sortOrder ?? 0) + 1,
      clientRequestId: input.clientRequestId ?? null,
      createdInMeetingId: ctx.meetingId ?? null,
      createdById: user.id,
      updatedById: user.id,
    },
    include: apInclude,
  });
  await tx.actionPointChange.create({
    data: {
      actionPointId: rec.id,
      changeGroupId: randomUUID(),
      field: "record",
      oldValue: null,
      newValue: ctx.meetingId ? "Created during meeting" : "Created",
      source: ctx.source,
      meetingId: ctx.meetingId ?? null,
      changedById: user.id,
    },
  });
  return { record: rec, created: true };
}

/** Snapshot stored in meeting agendas: plain JSON, never re-derived from live data. */
export function snapshotOf(dto: ActionPointDTO) {
  return {
    id: dto.id,
    legacySn: dto.legacySn,
    title: dto.title,
    activityType: dto.activityType?.name ?? null,
    supportsStages: dto.activityType?.supportsStages ?? false,
    project: dto.project?.name ?? null,
    currentStage: dto.currentStage,
    ownerName: dto.ownerName,
    originalTargetDate: dto.originalTargetDate,
    originalTargetText: dto.originalTargetText,
    revisedTargetDate: dto.revisedTargetDate,
    revisedTargetText: dto.revisedTargetText,
    effectiveDeadline: dto.deadline.effectiveDeadline,
    overdueDays: dto.deadline.overdueDays,
    priority: dto.priority,
    status: dto.status,
    feedback: dto.feedback,
    nextAction: dto.nextAction,
    blocker: dto.blocker,
    updatedAt: dto.updatedAt,
  };
}
export type ApSnapshot = ReturnType<typeof snapshotOf>;
