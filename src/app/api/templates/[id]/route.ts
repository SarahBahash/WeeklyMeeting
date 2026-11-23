import { apiRoute, readJson } from "@/lib/api";
import { saveTemplate, templateSchema } from "@/lib/services/stages";

type P = { id: string };
export const PUT = apiRoute<P>({ permissions: ["admin:templates"] }, async ({ req, user, params, ip }) => saveTemplate(user, params.id, templateSchema.parse(await readJson(req)), ip));
