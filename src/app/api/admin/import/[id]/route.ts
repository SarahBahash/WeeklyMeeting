import { apiRoute } from "@/lib/api";
import { getBatch } from "@/lib/import/service";

type P = { id: string };
export const GET = apiRoute<P>({ permissions: ["admin:import"] }, async ({ user, params }) => {
  const b = await getBatch(user, params.id);
  return { batch: { id: b.id, kind: b.kind, status: b.status, fileName: b.fileName, sheetName: b.sheetName, summary: b.summary, createdAt: b.createdAt, committedAt: b.committedAt, uploadedBy: b.uploadedBy.name } };
});
