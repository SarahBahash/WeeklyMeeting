import { apiRoute, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { applyUpdate, getVisibleActionPoint, patchSchema, toDTO } from "@/lib/services/action-points";

type P = { id: string };

export const GET = apiRoute<P>({ permissions: ["actionPoint:read"] }, async ({ user, params }) => {
  const rec = await getVisibleActionPoint(user, params.id);
  return { actionPoint: toDTO(rec) };
});

/** Quick edit and full edit. Optimistic concurrency via `version`; every change is logged. */
export const PATCH = apiRoute<P>({ permissions: ["actionPoint:write"] }, async ({ req, user, params }) => {
  const { version, ...fields } = patchSchema.parse(await readJson(req));
  const source = req.nextUrl.searchParams.get("source") === "quick" ? "QUICK_EDIT" : "FORM";
  const { record, changes } = await prisma.$transaction((tx) => applyUpdate(tx, user, params.id, version, fields, { source }));
  return { actionPoint: toDTO(record), changes };
});
