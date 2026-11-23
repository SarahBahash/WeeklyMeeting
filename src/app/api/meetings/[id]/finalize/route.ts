import { apiRoute, readJson } from "@/lib/api";
import { finalizeMeeting, finalizeSchema } from "@/lib/services/meetings";

type P = { id: string };
export const POST = apiRoute<P>({ permissions: ["meeting:organize"] }, async ({ req, user, params, ip }) => ({
  summary: await finalizeMeeting(user, params.id, finalizeSchema.parse(await readJson(req)), ip),
}));
