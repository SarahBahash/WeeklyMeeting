import { apiRoute, readJson } from "@/lib/api";
import { addAgendaItems, addItemsSchema, reorderAgenda, reorderSchema } from "@/lib/services/meetings";

type P = { id: string };
/** Add existing action points to the agenda. */
export const POST = apiRoute<P>({ permissions: ["meeting:organize"] }, async ({ req, user, params, ip }) =>
  addAgendaItems(user, params.id, addItemsSchema.parse(await readJson(req)).actionPointIds, ip));
/** Reorder the agenda. */
export const PUT = apiRoute<P>({ permissions: ["meeting:organize"] }, async ({ req, user, params }) =>
  reorderAgenda(user, params.id, reorderSchema.parse(await readJson(req)).itemIds));
