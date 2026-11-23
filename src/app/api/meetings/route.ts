import { apiRoute, readJson } from "@/lib/api";
import { createMeeting, createMeetingSchema, listMeetings } from "@/lib/services/meetings";

export const GET = apiRoute({ permissions: ["meeting:read"] }, async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  const meetings = await listMeetings(user, {
    from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined, projectId: sp.get("projectId") ?? undefined,
    activityTypeId: sp.get("activityTypeId") ?? undefined, owner: sp.get("owner") ?? undefined, q: sp.get("q") ?? undefined,
  });
  return { meetings };
});

export const POST = apiRoute({ permissions: ["meeting:organize"] }, async ({ req, user, ip }) => {
  const input = createMeetingSchema.parse(await readJson(req));
  const meeting = await createMeeting(user, input, ip);
  return { meetingId: meeting.id };
});
