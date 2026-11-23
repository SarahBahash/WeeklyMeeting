import "server-only";
import { z } from "zod";
import { Prisma, type ReviewState } from "@prisma/client";
import { prisma } from "../db";
import { can, type AuthUser } from "../auth/permissions";
import { visibleActionPoints } from "../visibility";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { dateToISO, isoToDate, isValidISODate, todayInRiyadh, type ISODate } from "../dates";
import { ACTIVE_STATUSES, STATUS_LABEL, computeDeadlineInfo, type Status } from "../domain";
import { auditLog } from "../audit";
import {
  apInclude, applyUpdate, createActionPoint, createSchema, snapshotOf, toDTO, updateFieldsSchema,
  type ApSnapshot, type FieldChange,
} from "./action-points";

type Tx = Prisma.TransactionClient;
const TX_OPTS = { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 20_000 } as const;

export const createMeetingSchema = z.object({
  meetingDate: z.string().refine(isValidISODate, "Meeting date must be a valid date"),
  attendees: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
});

export const saveItemSchema = z.object({
  version: z.number().int().positive(),
  fields: updateFieldsSchema.omit({ restricted: true, title: true, activityTypeId: true, projectId: true, projectStageId: true, originalTargetDate: true }),
  markReviewed: z.boolean().default(false),
});

export const reviewStateSchema = z.object({ state: z.enum(["PENDING", "REVIEWED", "SKIPPED"]) });
export const reorderSchema = z.object({ itemIds: z.array(z.string().max(40)).min(1).max(2000) });
export const addItemsSchema = z.object({ actionPointIds: z.array(z.string().max(40)).min(1).max(500) });
export const newActionSchema = createSchema.extend({ includeInAgenda: z.boolean().default(true) });
export const finalizeSchema = z.object({ confirmUnreviewed: z.boolean().default(false) });
export const updateMeetingSchema = z.object({
  version: z.number().int().positive(),
  attendees: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});
export const revisionSchema = z.object({
  reason: z.string().trim().min(5, "Please describe the reason for the correction").max(1000),
  attendees: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  updateCorrections: z
    .array(z.object({ meetingUpdateId: z.string().max(40), feedback: z.string().trim().max(10_000) }))
    .max(200)
    .optional(),
});

async function loadDraft(tx: Tx, meetingId: string) {
  const m = await tx.meeting.findUnique({ where: { id: meetingId } });
  if (!m) throw notFound("Meeting");
  if (m.status !== "DRAFT") throw conflict("This meeting has been finalized and can no longer be changed. Corrections are recorded as revisions.");
  return m;
}

// ------------------------------------------------------------------ create

export async function createMeeting(user: AuthUser, input: z.infer<typeof createMeetingSchema>, ip: string | null) {
  if (!can(user, "meeting:organize")) throw forbidden("You need meeting organizer permission to start a meeting");
  return prisma.$transaction(async (tx) => {
    // Serialize meeting creation so two organizers cannot start meetings at the same time.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(724001)`;
    const draft = await tx.meeting.findFirst({ where: { status: "DRAFT" } });
    if (draft) {
      throw conflict(`A draft meeting dated ${dateToISO(draft.meetingDate)} is already open. Resume or finish it first.`, {
        existingMeetingId: draft.id,
      });
    }
    const sameDate = await tx.meeting.findUnique({ where: { meetingDate: isoToDate(input.meetingDate) } });
    if (sameDate) throw conflict("A meeting already exists for this date.", { existingMeetingId: sameDate.id });

    const meeting = await tx.meeting.create({
      data: {
        meetingDate: isoToDate(input.meetingDate),
        organizerId: user.id,
        attendees: input.attendees || null,
        notes: input.notes || null,
      },
    });
    const items = await tx.actionPoint.findMany({
      where: { status: "IN_PROGRESS", ...visibleActionPoints(user) },
      include: apInclude,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    const today = input.meetingDate;
    if (items.length) {
      await tx.meetingAgendaItem.createMany({
        data: items.map((r, i) => ({
          meetingId: meeting.id,
          actionPointId: r.id,
          position: i + 1,
          snapshot: snapshotOf(toDTO(r, today)) as unknown as Prisma.InputJsonValue,
        })),
      });
    }
    await auditLog(user, "meeting.create", { entityType: "Meeting", entityId: meeting.id, details: { meetingDate: input.meetingDate, agendaItems: items.length }, ip }, tx);
    return meeting;
  }, TX_OPTS);
}

// ------------------------------------------------------------------ read

export async function getMeetingDetail(user: AuthUser, meetingId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      organizer: { select: { id: true, name: true } },
      revisions: { orderBy: { revisionNumber: "asc" }, include: { createdBy: { select: { name: true } } } },
    },
  });
  if (!meeting) throw notFound("Meeting");
  const allItems = await prisma.meetingAgendaItem.findMany({
    where: { meetingId },
    orderBy: { position: "asc" },
    include: { actionPoint: { include: apInclude } },
  });
  const visibleIds = new Set(
    (await prisma.actionPoint.findMany({
      where: { id: { in: allItems.map((i) => i.actionPointId) }, ...visibleActionPoints(user) },
      select: { id: true },
    })).map((a) => a.id),
  );
  const items = allItems.filter((i) => visibleIds.has(i.actionPointId));
  const apIds = items.map((i) => i.actionPointId);
  const updates = await prisma.meetingUpdate.findMany({
    where: { meetingId, actionPointId: { in: apIds } },
    orderBy: { createdAt: "asc" },
    include: { createdBy: { select: { name: true } } },
  });
  const previous = await prisma.meetingUpdate.findMany({
    where: { actionPointId: { in: apIds }, meetingId: { not: meetingId }, meeting: { meetingDate: { lt: meeting.meetingDate } } },
    orderBy: { createdAt: "desc" },
    distinct: ["actionPointId"],
    include: { meeting: { select: { meetingDate: true } }, createdBy: { select: { name: true } } },
  });
  const prevByAp = new Map(previous.map((p) => [p.actionPointId, p]));
  const today = todayInRiyadh();

  const agenda = items.map((i) => ({
    id: i.id,
    position: i.position,
    reviewState: i.reviewState,
    reviewedAt: i.reviewedAt?.toISOString() ?? null,
    addedDuringMeeting: i.addedDuringMeeting,
    isNewAction: i.isNewAction,
    snapshot: i.snapshot as unknown as ApSnapshot,
    finalSnapshot: (i.finalSnapshot as unknown as ApSnapshot | null) ?? null,
    current: toDTO(i.actionPoint, today),
    updates: updates
      .filter((u) => u.agendaItemId === i.id)
      .map((u) => ({
        id: u.id,
        feedback: u.feedback,
        nextAction: u.nextAction,
        blocker: u.blocker,
        changes: u.changes as unknown as FieldChange[],
        createdBy: u.createdBy.name,
        createdAt: u.createdAt.toISOString(),
      })),
    previousUpdate: prevByAp.has(i.actionPointId)
      ? (() => {
          const p = prevByAp.get(i.actionPointId)!;
          return {
            meetingDate: dateToISO(p.meeting.meetingDate),
            feedback: p.feedback,
            nextAction: p.nextAction,
            blocker: p.blocker,
            changes: (p.changes as unknown as FieldChange[]).filter((c) => c.field !== "feedback"),
            createdBy: p.createdBy.name,
            createdAt: p.createdAt.toISOString(),
          };
        })()
      : null,
  }));

  const counts = { total: agenda.length, reviewed: 0, skipped: 0, pending: 0 };
  for (const a of agenda) {
    if (a.reviewState === "REVIEWED") counts.reviewed++;
    else if (a.reviewState === "SKIPPED") counts.skipped++;
    else counts.pending++;
  }

  return {
    meeting: {
      id: meeting.id,
      meetingDate: dateToISO(meeting.meetingDate)!,
      status: meeting.status,
      organizer: meeting.organizer,
      attendees: meeting.attendees,
      notes: meeting.notes,
      summary: meeting.summary
        ? can(user, "actionPoint:viewRestricted")
          ? (meeting.summary as unknown as MeetingSummary)
          : filterSummary(meeting.summary as unknown as MeetingSummary, await allVisibleIds(user))
        : null,
      startedAt: meeting.startedAt.toISOString(),
      finalizedAt: meeting.finalizedAt?.toISOString() ?? null,
      version: meeting.version,
      hiddenItems: allItems.length - items.length,
      revisions: meeting.revisions.map((r) => ({
        id: r.id,
        revisionNumber: r.revisionNumber,
        reason: r.reason,
        changes: r.changes as unknown as RevisionChange[],
        createdBy: r.createdBy.name,
        createdAt: r.createdAt.toISOString(),
      })),
    },
    agenda,
    counts,
    permissions: {
      canOrganize: can(user, "meeting:organize") && meeting.status === "DRAFT",
      canParticipate: can(user, "meeting:participate") && meeting.status === "DRAFT",
      canCorrect: can(user, "meeting:correct") && meeting.status === "FINALIZED",
      canExport: can(user, "export:run"),
    },
  };
}
export type MeetingDetail = Awaited<ReturnType<typeof getMeetingDetail>>;
export interface RevisionChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
  meetingUpdateId?: string;
}

// ------------------------------------------------------------------ item updates

export async function saveAgendaItem(user: AuthUser, meetingId: string, itemId: string, input: z.infer<typeof saveItemSchema>) {
  if (!can(user, "meeting:participate")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const meeting = await loadDraft(tx, meetingId);
    const item = await tx.meetingAgendaItem.findFirst({ where: { id: itemId, meetingId } });
    if (!item) throw notFound("Agenda item");
    const { record, changes } = await applyUpdate(tx, user, item.actionPointId, input.version, input.fields, {
      source: "MEETING",
      meetingId,
    });
    const f = input.fields;
    const hasNotes = Boolean(f.feedback || f.nextAction || f.blocker);
    if (changes.length || hasNotes) {
      await tx.meetingUpdate.create({
        data: {
          meetingId,
          agendaItemId: itemId,
          actionPointId: item.actionPointId,
          feedback: changes.some((c) => c.field === "feedback") ? (f.feedback ?? null) : null,
          nextAction: changes.some((c) => c.field === "nextAction") ? (f.nextAction ?? null) : null,
          blocker: changes.some((c) => c.field === "blocker") ? (f.blocker ?? null) : null,
          changes: changes as unknown as Prisma.InputJsonValue,
          createdById: user.id,
        },
      });
    }
    const dto = toDTO(record, dateToISO(meeting.meetingDate)!);
    await tx.meetingAgendaItem.update({
      where: { id: itemId },
      data: {
        finalSnapshot: snapshotOf(dto) as unknown as Prisma.InputJsonValue,
        ...(input.markReviewed ? { reviewState: "REVIEWED", reviewedAt: new Date(), reviewedById: user.id } : {}),
      },
    });
    return { actionPoint: toDTO(record), changes };
  }, TX_OPTS);
}

export async function setReviewState(user: AuthUser, meetingId: string, itemId: string, state: ReviewState) {
  if (!can(user, "meeting:participate")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, meetingId);
    const item = await tx.meetingAgendaItem.findFirst({ where: { id: itemId, meetingId }, include: { actionPoint: { select: { restricted: true } } } });
    if (!item || (item.actionPoint.restricted && !can(user, "actionPoint:viewRestricted"))) throw notFound("Agenda item");
    await tx.meetingAgendaItem.update({
      where: { id: itemId },
      data: { reviewState: state, reviewedAt: state === "PENDING" ? null : new Date(), reviewedById: state === "PENDING" ? null : user.id },
    });
    return { ok: true };
  }, TX_OPTS);
}

export async function reorderAgenda(user: AuthUser, meetingId: string, itemIds: string[]) {
  if (!can(user, "meeting:organize")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, meetingId);
    const items = await tx.meetingAgendaItem.findMany({ where: { meetingId }, orderBy: { position: "asc" } });
    const known = new Set(items.map((i) => i.id));
    if (new Set(itemIds).size !== itemIds.length || itemIds.some((id) => !known.has(id))) throw badRequest("Invalid agenda order");
    // Items not visible to this organizer keep their relative order at the end.
    const rest = items.filter((i) => !itemIds.includes(i.id)).map((i) => i.id);
    const order = [...itemIds, ...rest];
    for (let i = 0; i < order.length; i++) {
      await tx.meetingAgendaItem.update({ where: { id: order[i] }, data: { position: i + 1 } });
    }
    return { ok: true };
  }, TX_OPTS);
}

async function appendItems(tx: Tx, user: AuthUser, meetingId: string, meetingDate: ISODate, apIds: string[], opts: { isNewAction: boolean }) {
  const aps = await tx.actionPoint.findMany({ where: { id: { in: apIds }, ...visibleActionPoints(user) }, include: apInclude });
  if (aps.length !== new Set(apIds).size) throw notFound("Action point");
  const existing = await tx.meetingAgendaItem.findMany({ where: { meetingId, actionPointId: { in: apIds } }, select: { actionPointId: true } });
  const skip = new Set(existing.map((e) => e.actionPointId));
  const max = await tx.meetingAgendaItem.aggregate({ where: { meetingId }, _max: { position: true } });
  let pos = max._max.position ?? 0;
  const toAdd = aps.filter((a) => !skip.has(a.id));
  for (const ap of toAdd) {
    await tx.meetingAgendaItem.create({
      data: {
        meetingId,
        actionPointId: ap.id,
        position: ++pos,
        snapshot: snapshotOf(toDTO(ap, meetingDate)) as unknown as Prisma.InputJsonValue,
        addedDuringMeeting: true,
        isNewAction: opts.isNewAction,
      },
    });
  }
  return toAdd.length;
}

export async function addAgendaItems(user: AuthUser, meetingId: string, apIds: string[], ip: string | null) {
  if (!can(user, "meeting:organize")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const m = await loadDraft(tx, meetingId);
    const added = await appendItems(tx, user, meetingId, dateToISO(m.meetingDate)!, apIds, { isNewAction: false });
    await auditLog(user, "meeting.agenda.add", { entityType: "Meeting", entityId: meetingId, details: { added }, ip }, tx);
    return { added };
  }, TX_OPTS);
}

export async function createActionInMeeting(user: AuthUser, meetingId: string, input: z.infer<typeof newActionSchema>) {
  if (!can(user, "meeting:participate") || !can(user, "actionPoint:write")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const m = await loadDraft(tx, meetingId);
    const { includeInAgenda, ...rest } = input;
    const { record, created } = await createActionPoint(tx, user, rest, { source: "MEETING", meetingId });
    if (includeInAgenda) await appendItems(tx, user, meetingId, dateToISO(m.meetingDate)!, [record.id], { isNewAction: true });
    return { actionPoint: toDTO(record), created };
  }, TX_OPTS);
}

export async function updateDraftMeeting(user: AuthUser, meetingId: string, input: z.infer<typeof updateMeetingSchema>) {
  if (!can(user, "meeting:organize")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    await loadDraft(tx, meetingId);
    const res = await tx.meeting.updateMany({
      where: { id: meetingId, version: input.version },
      data: {
        ...(input.attendees !== undefined ? { attendees: input.attendees || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) throw conflict("The meeting details were changed by someone else. Please reload.", { conflict: true });
    return { ok: true };
  }, TX_OPTS);
}

// ------------------------------------------------------------------ summary / finalize

export interface SummaryItem {
  actionPointId: string;
  title: string;
  ownerName: string | null;
  status: Status;
  effectiveDeadline: ISODate | null;
  overdueDays?: number | null;
  detail?: string | null;
}

export interface MeetingSummary {
  meetingDate: ISODate;
  organizer: string;
  attendees: string | null;
  generatedAt: string;
  totals: {
    agendaItems: number;
    reviewed: number;
    skipped: number;
    pending: number;
    completed: number;
    remainingInProgress: number;
    onHold: number;
    overdue: number;
    revisedDeadlines: number;
    newActions: number;
    followUps: number;
    unreviewed: number;
  };
  completedItems: SummaryItem[];
  remainingInProgress: SummaryItem[];
  onHoldItems: SummaryItem[];
  overdueItems: SummaryItem[];
  revisedDeadlines: { actionPointId: string; title: string; previous: string | null; next: string | null; reason: string | null; changedBy: string | null }[];
  newActions: SummaryItem[];
  followUps: { actionPointId: string; title: string; ownerName: string | null; nextAction: string }[];
  unreviewedItems: (SummaryItem & { reviewState: ReviewState })[];
}

export async function computeSummary(tx: Tx, meetingId: string): Promise<MeetingSummary> {
  const meeting = await tx.meeting.findUniqueOrThrow({ where: { id: meetingId }, include: { organizer: { select: { name: true } } } });
  const meetingDate = dateToISO(meeting.meetingDate)!;
  const items = await tx.meetingAgendaItem.findMany({
    where: { meetingId },
    orderBy: { position: "asc" },
    include: { actionPoint: { include: apInclude } },
  });
  const toItem = (ap: (typeof items)[number]["actionPoint"], detail?: string | null): SummaryItem => {
    const dto = toDTO(ap, meetingDate);
    return {
      actionPointId: ap.id,
      title: ap.title,
      ownerName: ap.ownerName,
      status: ap.status,
      effectiveDeadline: dto.deadline.effectiveDeadline,
      overdueDays: dto.deadline.overdueDays,
      detail: detail ?? null,
    };
  };
  const completedItems = items
    .filter((i) => ["COMPLETED", "CLOSED"].includes(i.actionPoint.status) && !["COMPLETED", "CLOSED"].includes((i.snapshot as unknown as ApSnapshot).status))
    .map((i) => toItem(i.actionPoint, `Status changed to ${STATUS_LABEL[i.actionPoint.status]}`));
  const remainingInProgress = items.filter((i) => i.actionPoint.status === "IN_PROGRESS").map((i) => toItem(i.actionPoint));
  const onHoldItems = items.filter((i) => i.actionPoint.status === "ON_HOLD").map((i) => toItem(i.actionPoint));
  const overdueItems = items
    .filter((i) => {
      const ap = i.actionPoint;
      return computeDeadlineInfo(
        { originalTargetDate: dateToISO(ap.originalTargetDate), revisedTargetDate: dateToISO(ap.revisedTargetDate), status: ap.status },
        meetingDate,
      ).isOverdue && ACTIVE_STATUSES.includes(ap.status);
    })
    .map((i) => toItem(i.actionPoint));
  const deadline = await tx.deadlineChange.findMany({
    where: { meetingId, kind: "REVISION" },
    orderBy: { changedAt: "asc" },
    include: { actionPoint: { select: { title: true } }, changedBy: { select: { name: true } } },
  });
  const revisedDeadlines = deadline.map((d) => ({
    actionPointId: d.actionPointId,
    title: d.actionPoint.title,
    previous: dateToISO(d.previousDate) ?? d.previousText,
    next: dateToISO(d.newDate) ?? d.newText,
    reason: d.reason,
    changedBy: d.changedBy?.name ?? null,
  }));
  const created = await tx.actionPoint.findMany({ where: { createdInMeetingId: meetingId }, include: apInclude, orderBy: { createdAt: "asc" } });
  const newActions = created.map((ap) => toItem(ap));
  const updates = await tx.meetingUpdate.findMany({
    where: { meetingId, nextAction: { not: null } },
    orderBy: { createdAt: "asc" },
    include: { actionPoint: { select: { title: true, ownerName: true } } },
  });
  const lastFollowUp = new Map<string, (typeof updates)[number]>();
  for (const u of updates) lastFollowUp.set(u.actionPointId, u);
  const followUps = [...lastFollowUp.values()].map((u) => ({
    actionPointId: u.actionPointId,
    title: u.actionPoint.title,
    ownerName: u.actionPoint.ownerName,
    nextAction: u.nextAction!,
  }));
  const unreviewedItems = items.filter((i) => i.reviewState !== "REVIEWED").map((i) => ({ ...toItem(i.actionPoint), reviewState: i.reviewState }));
  const reviewed = items.filter((i) => i.reviewState === "REVIEWED").length;
  const skipped = items.filter((i) => i.reviewState === "SKIPPED").length;
  return {
    meetingDate,
    organizer: meeting.organizer.name,
    attendees: meeting.attendees,
    generatedAt: new Date().toISOString(),
    totals: {
      agendaItems: items.length,
      reviewed,
      skipped,
      pending: items.length - reviewed - skipped,
      completed: completedItems.length,
      remainingInProgress: remainingInProgress.length,
      onHold: onHoldItems.length,
      overdue: overdueItems.length,
      revisedDeadlines: revisedDeadlines.length,
      newActions: newActions.length,
      followUps: followUps.length,
      unreviewed: unreviewedItems.length,
    },
    completedItems,
    remainingInProgress,
    onHoldItems,
    overdueItems,
    revisedDeadlines,
    newActions,
    followUps,
    unreviewedItems,
  };
}

/** Removes items the user may not see (restricted records) from a summary. */
export function filterSummary(summary: MeetingSummary, visible: Set<string>): MeetingSummary {
  const keep = <T extends { actionPointId: string }>(l: T[]) => l.filter((i) => visible.has(i.actionPointId));
  const s: MeetingSummary = {
    ...summary,
    completedItems: keep(summary.completedItems),
    remainingInProgress: keep(summary.remainingInProgress),
    onHoldItems: keep(summary.onHoldItems),
    overdueItems: keep(summary.overdueItems),
    revisedDeadlines: keep(summary.revisedDeadlines),
    newActions: keep(summary.newActions),
    followUps: keep(summary.followUps),
    unreviewedItems: keep(summary.unreviewedItems),
  };
  s.totals = {
    ...summary.totals,
    completed: s.completedItems.length,
    remainingInProgress: s.remainingInProgress.length,
    onHold: s.onHoldItems.length,
    overdue: s.overdueItems.length,
    revisedDeadlines: s.revisedDeadlines.length,
    newActions: s.newActions.length,
    followUps: s.followUps.length,
    unreviewed: s.unreviewedItems.length,
  };
  return s;
}

async function allVisibleIds(user: AuthUser) {
  return new Set((await prisma.actionPoint.findMany({ where: visibleActionPoints(user), select: { id: true } })).map((a) => a.id));
}

async function visibleIdSet(user: AuthUser, ids: string[]) {
  if (can(user, "actionPoint:viewRestricted")) return null;
  return new Set((await prisma.actionPoint.findMany({ where: { id: { in: ids }, restricted: false }, select: { id: true } })).map((a) => a.id));
}

export async function previewSummary(user: AuthUser, meetingId: string) {
  if (!can(user, "meeting:read")) throw forbidden();
  const summary = await prisma.$transaction((tx) => computeSummary(tx, meetingId));
  const ids = [...summary.unreviewedItems, ...summary.remainingInProgress, ...summary.completedItems, ...summary.newActions, ...summary.onHoldItems, ...summary.overdueItems].map((i) => i.actionPointId);
  const vis = await visibleIdSet(user, [...ids, ...summary.revisedDeadlines.map((r) => r.actionPointId), ...summary.followUps.map((f) => f.actionPointId)]);
  return vis ? filterSummary(summary, vis) : summary;
}

export async function finalizeMeeting(user: AuthUser, meetingId: string, input: z.infer<typeof finalizeSchema>, ip: string | null) {
  if (!can(user, "meeting:organize")) throw forbidden("Only the meeting organizer can finish the meeting");
  return prisma.$transaction(async (tx) => {
    const m = await loadDraft(tx, meetingId);
    const summary = await computeSummary(tx, meetingId);
    if (summary.totals.unreviewed > 0 && !input.confirmUnreviewed) {
      throw conflict(`${summary.totals.unreviewed} agenda item(s) have not been reviewed.`, { unreviewed: summary.totals.unreviewed, requiresConfirmation: true });
    }
    // Capture the end-of-meeting state for every item that was not saved during the meeting.
    const items = await tx.meetingAgendaItem.findMany({ where: { meetingId, finalSnapshot: { equals: Prisma.AnyNull } }, include: { actionPoint: { include: apInclude } } });
    for (const i of items) {
      await tx.meetingAgendaItem.update({
        where: { id: i.id },
        data: { finalSnapshot: snapshotOf(toDTO(i.actionPoint, dateToISO(m.meetingDate)!)) as unknown as Prisma.InputJsonValue },
      });
    }
    const res = await tx.meeting.updateMany({
      where: { id: meetingId, status: "DRAFT" },
      data: { status: "FINALIZED", summary: summary as unknown as Prisma.InputJsonValue, finalizedAt: new Date(), finalizedById: user.id, version: { increment: 1 } },
    });
    if (res.count !== 1) throw conflict("This meeting was already finalized.");
    await auditLog(user, "meeting.finalize", { entityType: "Meeting", entityId: meetingId, details: { totals: summary.totals }, ip }, tx);
    return summary;
  }, TX_OPTS);
}

export async function addRevision(user: AuthUser, meetingId: string, input: z.infer<typeof revisionSchema>, ip: string | null) {
  if (!can(user, "meeting:correct")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const m = await tx.meeting.findUnique({ where: { id: meetingId }, include: { revisions: { orderBy: { revisionNumber: "asc" } } } });
    if (!m) throw notFound("Meeting");
    if (m.status !== "FINALIZED") throw badRequest("Draft meetings can be edited directly; revisions apply to finalized meetings.");
    // Current corrected values = original values with all previous revisions applied.
    const effective: Record<string, string | null> = { attendees: m.attendees, notes: m.notes };
    const upd: Record<string, string | null> = {};
    for (const r of m.revisions) {
      for (const c of r.changes as unknown as RevisionChange[]) {
        if (c.meetingUpdateId) upd[c.meetingUpdateId] = c.newValue;
        else effective[c.field] = c.newValue;
      }
    }
    const changes: RevisionChange[] = [];
    if (input.attendees !== undefined && (input.attendees || null) !== effective.attendees) {
      changes.push({ field: "attendees", oldValue: effective.attendees, newValue: input.attendees || null });
    }
    if (input.notes !== undefined && (input.notes || null) !== effective.notes) {
      changes.push({ field: "notes", oldValue: effective.notes, newValue: input.notes || null });
    }
    for (const c of input.updateCorrections ?? []) {
      const u = await tx.meetingUpdate.findFirst({ where: { id: c.meetingUpdateId, meetingId } });
      if (!u) throw notFound("Meeting update");
      const old = c.meetingUpdateId in upd ? upd[c.meetingUpdateId] : u.feedback;
      if ((c.feedback || null) !== old) changes.push({ field: "feedback", meetingUpdateId: u.id, oldValue: old, newValue: c.feedback || null });
    }
    if (!changes.length) throw badRequest("No corrections were entered");
    const rev = await tx.meetingRevision.create({
      data: {
        meetingId,
        revisionNumber: (m.revisions.at(-1)?.revisionNumber ?? 0) + 1,
        reason: input.reason,
        changes: changes as unknown as Prisma.InputJsonValue,
        createdById: user.id,
      },
    });
    await auditLog(user, "meeting.revision", { entityType: "Meeting", entityId: meetingId, details: { revision: rev.revisionNumber, fields: changes.map((c) => c.field) }, ip }, tx);
    return { revisionNumber: rev.revisionNumber };
  }, TX_OPTS);
}

export async function listMeetings(
  user: AuthUser,
  f: { from?: string; to?: string; projectId?: string; activityTypeId?: string; owner?: string; q?: string },
) {
  const where: Prisma.MeetingWhereInput = {};
  const dateCond: Prisma.DateTimeFilter = {};
  if (f.from && isValidISODate(f.from)) dateCond.gte = isoToDate(f.from);
  if (f.to && isValidISODate(f.to)) dateCond.lte = isoToDate(f.to);
  if (Object.keys(dateCond).length) where.meetingDate = dateCond;
  const apCond: Prisma.ActionPointWhereInput = { ...visibleActionPoints(user) };
  let filterByAp = false;
  if (f.projectId) { apCond.projectId = f.projectId; filterByAp = true; }
  if (f.activityTypeId) { apCond.activityTypeId = f.activityTypeId === "none" ? null : f.activityTypeId; filterByAp = true; }
  if (f.owner) { apCond.ownerName = { equals: f.owner, mode: "insensitive" }; filterByAp = true; }
  if (f.q) { apCond.title = { contains: f.q.slice(0, 200), mode: "insensitive" }; filterByAp = true; }
  if (filterByAp) where.agendaItems = { some: { actionPoint: apCond } };
  const meetings = await prisma.meeting.findMany({
    where,
    orderBy: { meetingDate: "desc" },
    take: 500,
    include: {
      organizer: { select: { name: true } },
      _count: { select: { agendaItems: true, updates: true, createdActions: true, revisions: true } },
      agendaItems: { select: { reviewState: true } },
    },
  });
  return meetings.map((m) => ({
    id: m.id,
    meetingDate: dateToISO(m.meetingDate)!,
    status: m.status,
    organizer: m.organizer.name,
    attendees: m.attendees,
    agendaItems: m._count.agendaItems,
    reviewed: m.agendaItems.filter((a) => a.reviewState === "REVIEWED").length,
    updates: m._count.updates,
    newActions: m._count.createdActions,
    revisions: m._count.revisions,
    finalizedAt: m.finalizedAt?.toISOString() ?? null,
  }));
}
