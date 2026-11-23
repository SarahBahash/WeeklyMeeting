import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { can, type AuthUser } from "../auth/permissions";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { auditLog } from "../audit";
import { dateToISO, isoToDate, isValidISODate } from "../dates";
import { STAGE_STATUSES } from "../domain";
import { visibleActionPoints } from "../visibility";

const optDate = z.preprocess((v) => (v === "" ? null : v), z.string().refine(isValidISODate, "Invalid date").nullable()).optional();

export const projectSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  isAudit: z.boolean().default(true),
  templateId: z.string().max(40).optional(),
});
export const projectUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  isAudit: z.boolean().optional(),
});
export const stageCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  partName: z.string().trim().max(200).nullable().optional(),
  afterStageId: z.string().max(40).optional(),
  templateId: z.string().max(40).optional(),
});
export const stageUpdateSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  partName: z.string().trim().max(200).nullable().optional(),
  ownerName: z.preprocess((v) => (v === "" ? null : v), z.string().trim().max(200).nullable()).optional(),
  status: z.enum(STAGE_STATUSES).optional(),
  targetDate: optDate,
  actualCompletionDate: optDate,
  move: z.enum(["up", "down"]).optional(),
});
export const templateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  isDefault: z.boolean().optional(),
  stages: z.array(z.object({ partNumber: z.number().int().min(1).max(20), partName: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(200) })).min(1).max(100),
});

export function serializeStage(s: Prisma.ProjectStageGetPayload<{ include: { actionPoints: { select: { id: true; title: true; status: true } } } }>) {
  return {
    id: s.id, name: s.name, partName: s.partName, sortOrder: s.sortOrder, ownerName: s.ownerName, status: s.status,
    targetDate: dateToISO(s.targetDate), actualCompletionDate: dateToISO(s.actualCompletionDate), version: s.version,
    actionPoints: s.actionPoints,
  };
}

export async function listProjects(user: AuthUser) {
  const projects = await prisma.project.findMany({
    orderBy: { name: "asc" },
    include: {
      stages: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, status: true, partName: true } },
      _count: { select: { actionPoints: { where: visibleActionPoints(user) } } },
    },
  });
  return projects.map((p) => ({
    id: p.id, name: p.name, description: p.description, isAudit: p.isAudit, actionPointCount: p._count.actionPoints,
    stages: p.stages,
  }));
}

export async function getProject(user: AuthUser, id: string) {
  const p = await prisma.project.findUnique({
    where: { id },
    include: {
      stages: { orderBy: { sortOrder: "asc" }, include: { actionPoints: { where: visibleActionPoints(user), select: { id: true, title: true, status: true } } } },
      actionPoints: { where: visibleActionPoints(user), select: { id: true, title: true, status: true, ownerName: true, currentStage: true, projectStageId: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!p) throw notFound("Project");
  return { id: p.id, name: p.name, description: p.description, isAudit: p.isAudit, stages: p.stages.map(serializeStage), actionPoints: p.actionPoints };
}

async function copyTemplate(tx: Prisma.TransactionClient, projectId: string, templateId: string) {
  const t = await tx.auditStageTemplate.findUnique({ where: { id: templateId }, include: { stages: { orderBy: { sortOrder: "asc" } } } });
  if (!t) throw notFound("Stage template");
  const max = await tx.projectStage.aggregate({ where: { projectId }, _max: { sortOrder: true } });
  let order = max._max.sortOrder ?? 0;
  await tx.projectStage.createMany({
    data: t.stages.map((s) => ({ projectId, name: s.name, partName: `Part ${s.partNumber} – ${s.partName}`, sortOrder: ++order })),
  });
  return t.stages.length;
}

export async function createProject(user: AuthUser, input: z.infer<typeof projectSchema>, ip: string | null) {
  if (!can(user, "stage:write")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const existing = await tx.project.findFirst({ where: { name: { equals: input.name, mode: "insensitive" } } });
    if (existing) throw conflict(`A project named "${existing.name}" already exists.`, { existingProjectId: existing.id });
    const p = await tx.project.create({ data: { name: input.name, description: input.description ?? null, isAudit: input.isAudit } });
    if (input.templateId) await copyTemplate(tx, p.id, input.templateId);
    await auditLog(user, "project.create", { entityType: "Project", entityId: p.id, details: { name: p.name, templateId: input.templateId ?? null }, ip }, tx);
    return { id: p.id };
  });
}

export async function updateProject(user: AuthUser, id: string, input: z.infer<typeof projectUpdateSchema>) {
  if (!can(user, "stage:write")) throw forbidden();
  await prisma.project.update({ where: { id }, data: input });
  return { ok: true };
}

export async function addStage(user: AuthUser, projectId: string, input: z.infer<typeof stageCreateSchema>) {
  if (!can(user, "stage:write")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: projectId } });
    if (!p) throw notFound("Project");
    if (input.templateId) return { added: await copyTemplate(tx, projectId, input.templateId) };
    const stages = await tx.projectStage.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } });
    let insertAt = stages.length;
    if (input.afterStageId) {
      const idx = stages.findIndex((s) => s.id === input.afterStageId);
      if (idx < 0) throw badRequest("Unknown stage");
      insertAt = idx + 1;
    }
    for (let i = stages.length - 1; i >= insertAt; i--) {
      await tx.projectStage.update({ where: { id: stages[i].id }, data: { sortOrder: i + 2 } });
    }
    const partName = input.partName ?? (insertAt > 0 ? stages[insertAt - 1].partName : null);
    await tx.projectStage.create({ data: { projectId, name: input.name, partName, sortOrder: insertAt + 1 } });
    return { added: 1 };
  });
}

export async function updateStage(user: AuthUser, id: string, input: z.infer<typeof stageUpdateSchema>) {
  if (!can(user, "stage:write")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const s = await tx.projectStage.findUnique({ where: { id } });
    if (!s) throw notFound("Stage");
    if (s.version !== input.version) throw conflict("This stage was changed by someone else. Please reload.", { conflict: true });
    if (input.move) {
      const sib = await tx.projectStage.findFirst({
        where: { projectId: s.projectId, sortOrder: input.move === "up" ? { lt: s.sortOrder } : { gt: s.sortOrder } },
        orderBy: { sortOrder: input.move === "up" ? "desc" : "asc" },
      });
      if (sib) {
        await tx.projectStage.update({ where: { id: sib.id }, data: { sortOrder: s.sortOrder, version: { increment: 1 } } });
        await tx.projectStage.update({ where: { id: s.id }, data: { sortOrder: sib.sortOrder, version: { increment: 1 } } });
      }
      return { ok: true };
    }
    const data: Prisma.ProjectStageUpdateManyMutationInput = { version: { increment: 1 } };
    if (input.name !== undefined) data.name = input.name;
    if (input.partName !== undefined) data.partName = input.partName;
    if (input.ownerName !== undefined) data.ownerName = input.ownerName;
    if (input.status !== undefined) data.status = input.status;
    if (input.targetDate !== undefined) data.targetDate = input.targetDate ? isoToDate(input.targetDate) : null;
    if (input.actualCompletionDate !== undefined) data.actualCompletionDate = input.actualCompletionDate ? isoToDate(input.actualCompletionDate) : null;
    if (input.status === "COMPLETED" && input.actualCompletionDate === undefined && !s.actualCompletionDate) {
      data.actualCompletionDate = isoToDate(new Date().toISOString().slice(0, 10));
    }
    const res = await tx.projectStage.updateMany({ where: { id, version: input.version }, data });
    if (res.count !== 1) throw conflict("This stage was changed by someone else. Please reload.", { conflict: true });
    return { ok: true };
  });
}

export async function deleteStage(user: AuthUser, id: string, ip: string | null) {
  if (!can(user, "stage:write")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const s = await tx.projectStage.findUnique({ where: { id }, include: { _count: { select: { actionPoints: true } } } });
    if (!s) throw notFound("Stage");
    if (s._count.actionPoints) throw conflict("This stage has linked action points. Unlink them before removing the stage.");
    await tx.projectStage.delete({ where: { id } });
    await auditLog(user, "stage.delete", { entityType: "ProjectStage", entityId: id, details: { name: s.name, projectId: s.projectId }, ip }, tx);
    return { ok: true };
  });
}

export async function listTemplates() {
  const ts = await prisma.auditStageTemplate.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }], include: { stages: { orderBy: { sortOrder: "asc" } } } });
  return ts.map((t) => ({ id: t.id, name: t.name, description: t.description, isDefault: t.isDefault, sourceNote: t.sourceNote, stages: t.stages.map((s) => ({ id: s.id, partNumber: s.partNumber, partName: s.partName, name: s.name, sortOrder: s.sortOrder })) }));
}

export async function saveTemplate(user: AuthUser, id: string | null, input: z.infer<typeof templateSchema>, ip: string | null) {
  if (!can(user, "admin:templates")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const clash = await tx.auditStageTemplate.findFirst({ where: { name: { equals: input.name, mode: "insensitive" }, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw conflict("Another template already uses this name.");
    if (input.isDefault) await tx.auditStageTemplate.updateMany({ data: { isDefault: false } });
    let tid = id;
    if (id) {
      const t = await tx.auditStageTemplate.findUnique({ where: { id } });
      if (!t) throw notFound("Template");
      await tx.auditStageTemplate.update({ where: { id }, data: { name: input.name, description: input.description ?? null, ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}) } });
      // Template stages are a blueprint only; projects keep their own copies, so replacing is safe.
      await tx.auditStageTemplateStage.deleteMany({ where: { templateId: id } });
    } else {
      tid = (await tx.auditStageTemplate.create({ data: { name: input.name, description: input.description ?? null, isDefault: input.isDefault ?? false } })).id;
    }
    await tx.auditStageTemplateStage.createMany({ data: input.stages.map((s, i) => ({ templateId: tid!, partNumber: s.partNumber, partName: s.partName, name: s.name, sortOrder: i + 1 })) });
    await auditLog(user, id ? "template.update" : "template.create", { entityType: "AuditStageTemplate", entityId: tid!, details: { name: input.name, stages: input.stages.length }, ip }, tx);
    return { id: tid };
  });
}
