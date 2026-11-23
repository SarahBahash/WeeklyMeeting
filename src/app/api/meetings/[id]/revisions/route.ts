import { apiRoute, readJson } from "@/lib/api";
import { addRevision, revisionSchema } from "@/lib/services/meetings";

type P = { id: string };
export const POST = apiRoute<P>({ permissions: ["meeting:correct"] }, async ({ req, user, params, ip }) =>
  addRevision(user, params.id, revisionSchema.parse(await readJson(req)), ip));
