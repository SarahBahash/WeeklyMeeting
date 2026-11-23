import { apiRoute } from "@/lib/api";
import { prisma } from "@/lib/db";
import { titleSimilarity } from "@/lib/import/cells";
import { dateToISO } from "@/lib/dates";

/** Historical tracker records awaiting (or after) an administrator decision. */
export const GET = apiRoute({ permissions: ["admin:import"] }, async ({ req }) => {
  const decision = req.nextUrl.searchParams.get("decision");
  const records = await prisma.legacyHistoryRecord.findMany({
    where: decision && ["PENDING", "RETAIN", "MERGE", "SKIP"].includes(decision) ? { decision: decision as "PENDING" } : {},
    orderBy: [{ importBatchId: "asc" }, { sourceRow: "asc" }],
    take: 1000,
    include: { linkedActionPoint: { select: { id: true, title: true } } },
  });
  const aps = await prisma.actionPoint.findMany({ select: { id: true, title: true, ownerName: true } });
  return {
    records: records.map((r) => ({
      ...r,
      meetingDate: dateToISO(r.meetingDate),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      candidates: r.decision === "PENDING"
        ? aps.map((a) => ({ ...a, score: Math.max(titleSimilarity(a.title, r.actionText ?? ""), titleSimilarity(a.title, `${r.actionText ?? ""} ${r.projectText ?? ""}`)) }))
            .filter((a) => a.score >= 0.6).sort((a, b) => b.score - a.score).slice(0, 3)
        : [],
    })),
  };
});
