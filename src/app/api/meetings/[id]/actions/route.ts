import { apiRoute, readJson } from "@/lib/api";
import { createActionInMeeting, newActionSchema } from "@/lib/services/meetings";

type P = { id: string };
export const POST = apiRoute<P>({ permissions: ["meeting:participate", "actionPoint:write"] }, async ({ req, user, params }) =>
  createActionInMeeting(user, params.id, newActionSchema.parse(await readJson(req))));
