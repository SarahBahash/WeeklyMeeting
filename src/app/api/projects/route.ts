import { apiRoute, readJson } from "@/lib/api";
import { createProject, listProjects, projectSchema } from "@/lib/services/stages";

export const GET = apiRoute({ permissions: ["actionPoint:read"] }, async ({ user }) => ({ projects: await listProjects(user) }));
export const POST = apiRoute({ permissions: ["stage:write"] }, async ({ req, user, ip }) => createProject(user, projectSchema.parse(await readJson(req)), ip));
