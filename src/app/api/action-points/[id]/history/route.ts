import { apiRoute } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getVisibleActionPoint } from "@/lib/services/action-points";
import { dateToISO } from "@/lib/dates";

type P = { id: string };

export const GET = apiRoute<P>({ permissions: ["actionPoint:read"] }, async ({ user, params }) => {
  const ap = await getVisibleActionPoint(user, params.id);
  const [changes, deadlines, updates, legacy, meetings] = await Promise.all([
    prisma.actionPointChange.findMany({
      where: { actionPointId: ap.id },
      orderBy: { changedAt: "desc" },
      include: { changedBy: { select: { name: true } }, meeting: { select: { id: true, meetingDate: true } } },
    }),
    prisma.deadlineChange.findMany({
      where: { actionPointId: ap.id },
      orderBy: { changedAt: "desc" },
      include: { changedBy: { select: { name: true } }, meeting: { select: { id: true, meetingDate: true } } },
    }),
    prisma.meetingUpdate.findMany({
      where: { actionPointId: ap.id },
      orderBy: { createdAt: "desc" },
      include: { createdBy: { select: { name: true } }, meeting: { select: { id: true, meetingDate: true, status: true } } },
    }),
    prisma.legacyHistoryRecord.findMany({ where: { linkedActionPointId: ap.id }, orderBy: { sourceRow: "asc" } }),
    prisma.meetingAgendaItem.findMany({
      where: { actionPointId: ap.id },
      include: { meeting: { select: { id: true, meetingDate: true, status: true } } },
      orderBy: { meeting: { meetingDate: "desc" } },
    }),
  ]);
  return {
    changes: changes.map((c) => ({
      id: c.id, changeGroupId: c.changeGroupId, field: c.field, oldValue: c.oldValue, newValue: c.newValue, source: c.source,
      changedBy: c.changedBy?.name ?? "System", changedAt: c.changedAt.toISOString(),
      meeting: c.meeting ? { id: c.meeting.id, meetingDate: dateToISO(c.meeting.meetingDate) } : null,
    })),
    deadlines: deadlines.map((d) => ({
      id: d.id, kind: d.kind, previousDate: dateToISO(d.previousDate), previousText: d.previousText,
      newDate: dateToISO(d.newDate), newText: d.newText, reason: d.reason,
      changedBy: d.changedBy?.name ?? "System", changedAt: d.changedAt.toISOString(),
      meeting: d.meeting ? { id: d.meeting.id, meetingDate: dateToISO(d.meeting.meetingDate) } : null,
    })),
    meetingUpdates: updates.map((u) => ({
      id: u.id, feedback: u.feedback, nextAction: u.nextAction, blocker: u.blocker, changes: u.changes,
      createdBy: u.createdBy.name, createdAt: u.createdAt.toISOString(),
      meeting: { id: u.meeting.id, meetingDate: dateToISO(u.meeting.meetingDate), status: u.meeting.status },
    })),
    legacy: legacy.map((l) => ({ ...l, meetingDate: dateToISO(l.meetingDate), decidedAt: l.decidedAt?.toISOString() ?? null })),
    meetings: meetings.map((m) => ({ id: m.meeting.id, meetingDate: dateToISO(m.meeting.meetingDate), status: m.meeting.status, reviewState: m.reviewState })),
  };
});
