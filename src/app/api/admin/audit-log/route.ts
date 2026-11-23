import { apiRoute } from "@/lib/api";
import { prisma } from "@/lib/db";

/** Read-only view of the append-only system audit log. */
export const GET = apiRoute({ permissions: ["admin:auditLog"] }, async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action")?.slice(0, 60);
  const logs = await prisma.systemAuditLog.findMany({
    where: action ? { action: { startsWith: action } } : {},
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return { logs: logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })) };
});
