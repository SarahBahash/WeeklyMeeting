import { apiRoute, readJson } from "@/lib/api";
import { decideLegacy, legacyDecisionSchema } from "@/lib/import/service";

type P = { id: string };
export const POST = apiRoute<P>({ permissions: ["admin:import"] }, async ({ req, user, params, ip }) =>
  decideLegacy(user, params.id, legacyDecisionSchema.parse(await readJson(req)), ip));
