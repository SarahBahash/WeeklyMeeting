import { apiRoute } from "@/lib/api";
import { prisma } from "@/lib/db";
import { buildWhere } from "@/lib/services/action-points";
import { todayInRiyadh } from "@/lib/dates";

/** Summary counts, calculated from stored data. */
export const GET = apiRoute({ permissions: ["actionPoint:read"] }, async ({ user }) => {
  const today = todayInRiyadh();
  const count = (f: Parameters<typeof buildWhere>[1]) => prisma.actionPoint.count({ where: buildWhere(user, f, today) });
  const [total, inProgress, completed, closed, onHold, notStarted, overdue, dueSoon, unclassified] = await Promise.all([
    count({}),
    count({ status: ["IN_PROGRESS"] }),
    count({ status: ["COMPLETED"] }),
    count({ status: ["CLOSED"] }),
    count({ status: ["ON_HOLD"] }),
    count({ status: ["NOT_STARTED"] }),
    count({ overdue: true }),
    count({ dueSoon: true }),
    count({ activityTypeId: "none" }),
  ]);
  return { today, total, inProgress, completed, closed, onHold, notStarted, overdue, dueSoon, unclassified };
});
