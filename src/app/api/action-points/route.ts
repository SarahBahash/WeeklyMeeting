import { apiRoute, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { apInclude, buildWhere, createActionPoint, createSchema, defaultOrder, toDTO } from "@/lib/services/action-points";
import { todayInRiyadh } from "@/lib/dates";

export const GET = apiRoute({ permissions: ["actionPoint:read"] }, async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  const today = todayInRiyadh();
  const where = buildWhere(user, {
    status: sp.getAll("status").flatMap((s) => s.split(",")).filter(Boolean),
    activityTypeId: sp.get("activityTypeId") ?? undefined,
    projectId: sp.get("projectId") ?? undefined,
    owner: sp.get("owner") ?? undefined,
    priority: sp.get("priority") ?? undefined,
    stage: sp.get("stage") ?? undefined,
    q: sp.get("q")?.trim() || undefined,
    overdue: sp.get("overdue") === "1",
    dueSoon: sp.get("dueSoon") === "1",
    ids: sp.get("ids")?.split(",").filter(Boolean).slice(0, 500),
  }, today);
  const rows = await prisma.actionPoint.findMany({ where, include: apInclude, orderBy: defaultOrder, take: 5000 });
  return { items: rows.map((r) => toDTO(r, today)), today };
});

export const POST = apiRoute({ permissions: ["actionPoint:write"] }, async ({ req, user }) => {
  const input = createSchema.parse(await readJson(req));
  const { record, created } = await prisma.$transaction((tx) => createActionPoint(tx, user, input, { source: "FORM" }));
  return { actionPoint: toDTO(record), created };
});
