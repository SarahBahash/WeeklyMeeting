import { apiRoute, readJson } from "@/lib/api";
import { saveAgendaItem, saveItemSchema } from "@/lib/services/meetings";

type P = { id: string; itemId: string };
export const POST = apiRoute<P>({ permissions: ["meeting:participate", "actionPoint:write"] }, async ({ req, user, params }) =>
  saveAgendaItem(user, params.id, params.itemId, saveItemSchema.parse(await readJson(req))));
