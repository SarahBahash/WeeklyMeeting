import { apiRoute, readJson } from "@/lib/api";
import { getMeetingDetail, updateDraftMeeting, updateMeetingSchema } from "@/lib/services/meetings";

type P = { id: string };
export const GET = apiRoute<P>({ permissions: ["meeting:read"] }, async ({ user, params }) => getMeetingDetail(user, params.id));
export const PATCH = apiRoute<P>({ permissions: ["meeting:organize"] }, async ({ req, user, params }) =>
  updateDraftMeeting(user, params.id, updateMeetingSchema.parse(await readJson(req))));
