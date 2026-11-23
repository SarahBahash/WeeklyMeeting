import { apiRoute, readJson } from "@/lib/api";
import { commitBatch, commitSchema } from "@/lib/import/service";

type P = { id: string };
export const POST = apiRoute<P>({ permissions: ["admin:import"] }, async ({ req, user, params, ip }) =>
  commitBatch(user, params.id, commitSchema.parse(await readJson(req)), ip));
