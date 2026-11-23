import { apiRoute, readJson } from "@/lib/api";
import { deleteStage, stageUpdateSchema, updateStage } from "@/lib/services/stages";

type P = { id: string };
export const PATCH = apiRoute<P>({ permissions: ["stage:write"] }, async ({ req, user, params }) => updateStage(user, params.id, stageUpdateSchema.parse(await readJson(req))));
export const DELETE = apiRoute<P>({ permissions: ["stage:write"] }, async ({ user, params, ip }) => deleteStage(user, params.id, ip));
