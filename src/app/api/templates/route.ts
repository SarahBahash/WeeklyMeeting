import { apiRoute, readJson } from "@/lib/api";
import { listTemplates, saveTemplate, templateSchema } from "@/lib/services/stages";

export const GET = apiRoute({ permissions: ["actionPoint:read"] }, async () => ({ templates: await listTemplates() }));
export const POST = apiRoute({ permissions: ["admin:templates"] }, async ({ req, user, ip }) => saveTemplate(user, null, templateSchema.parse(await readJson(req)), ip));
