import { apiRoute } from "@/lib/api";
import { prisma } from "@/lib/db";
import { visibleActionPoints } from "@/lib/visibility";
import { todayInRiyadh } from "@/lib/dates";

/** Reference data for filters and dropdowns. */
export const GET = apiRoute({ permissions: ["actionPoint:read"] }, async ({ user }) => {
  const vis = visibleActionPoints(user);
  const [activityTypes, projects, owners, stages, draft] = await Promise.all([
    prisma.activityType.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.project.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, isAudit: true, stages: { select: { id: true, name: true }, orderBy: { sortOrder: "asc" } } } }),
    prisma.actionPoint.findMany({ where: { ...vis, ownerName: { not: null } }, distinct: ["ownerName"], select: { ownerName: true }, orderBy: { ownerName: "asc" } }),
    prisma.actionPoint.findMany({ where: { ...vis, currentStage: { not: null } }, distinct: ["currentStage"], select: { currentStage: true }, orderBy: { currentStage: "asc" } }),
    prisma.meeting.findFirst({ where: { status: "DRAFT" }, select: { id: true, meetingDate: true } }),
  ]);
  return {
    today: todayInRiyadh(),
    activityTypes,
    projects,
    owners: owners.map((o) => o.ownerName!).filter(Boolean),
    stages: stages.map((s) => s.currentStage!).filter(Boolean),
    draftMeeting: draft ? { id: draft.id, meetingDate: draft.meetingDate.toISOString().slice(0, 10) } : null,
  };
});
