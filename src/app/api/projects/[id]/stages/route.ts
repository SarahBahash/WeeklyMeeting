import { apiRoute, readJson } from "@/lib/api";
import { addStage, stageCreateSchema } from "@/lib/services/stages";

type P = { id: string };
export const POST = apiRoute<P>({ permissions: ["stage:write"] }, async ({ req, user, params }) => addStage(user, params.id, stageCreateSchema.parse(await readJson(req))));
