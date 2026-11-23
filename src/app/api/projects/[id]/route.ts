import { apiRoute, readJson } from "@/lib/api";
import { getProject, projectUpdateSchema, updateProject } from "@/lib/services/stages";

type P = { id: string };
export const GET = apiRoute<P>({ permissions: ["actionPoint:read"] }, async ({ user, params }) => ({ project: await getProject(user, params.id) }));
export const PATCH = apiRoute<P>({ permissions: ["stage:write"] }, async ({ req, user, params }) => updateProject(user, params.id, projectUpdateSchema.parse(await readJson(req))));
