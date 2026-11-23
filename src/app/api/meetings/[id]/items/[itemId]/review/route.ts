import { apiRoute, readJson } from "@/lib/api";
import { reviewStateSchema, setReviewState } from "@/lib/services/meetings";

type P = { id: string; itemId: string };
export const POST = apiRoute<P>({ permissions: ["meeting:participate"] }, async ({ req, user, params }) =>
  setReviewState(user, params.id, params.itemId, reviewStateSchema.parse(await readJson(req)).state));
