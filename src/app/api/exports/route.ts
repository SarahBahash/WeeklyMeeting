import { NextResponse } from "next/server";
import { apiRoute, readJson } from "@/lib/api";
import { auditLog } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { assertMeetingRequest, buildMeetingExport, buildTrackerExport, exportSchema } from "@/lib/export/workbook";

/** Generates a real .xlsx workbook server-side, after permission checks, and logs the export. */
export const POST = apiRoute(
  { permissions: ["export:run"], rateLimit: { key: "export", limit: 30, windowMs: 60_000 } },
  async ({ req, user, ip }) => {
    const input = exportSchema.parse(await readJson(req));
    assertMeetingRequest(input);
    const out = input.type === "MEETING" ? await buildMeetingExport(user, input.meetingId!) : await buildTrackerExport(user, input);
    await prisma.exportLog.create({
      data: { userId: user.id, reportType: input.type, parameters: input, fileName: out.fileName, rowCount: out.rowCount },
    });
    await auditLog(user, "export.download", { entityType: "Export", details: { type: input.type, status: input.status, separateSheets: input.separateSheets, meetingId: input.meetingId ?? null, rows: out.rowCount, fileName: out.fileName }, ip });
    return new NextResponse(new Uint8Array(out.buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${out.fileName}"`,
        "Content-Length": String(out.buffer.length),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
);
