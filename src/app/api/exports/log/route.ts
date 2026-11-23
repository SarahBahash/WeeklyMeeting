import { apiRoute } from "@/lib/api";
import { prisma } from "@/lib/db";
import { can } from "@/lib/auth/permissions";

export const GET = apiRoute({ permissions: ["export:run"] }, async ({ user }) => {
  const logs = await prisma.exportLog.findMany({
    where: can(user, "admin:auditLog") ? {} : { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { user: { select: { name: true } } },
  });
  return { logs: logs.map((l) => ({ id: l.id, reportType: l.reportType, fileName: l.fileName, rowCount: l.rowCount, user: l.user.name, createdAt: l.createdAt.toISOString() })) };
});
