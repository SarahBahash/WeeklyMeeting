import { apiRoute } from "@/lib/api";
import { getMeetingDetail, previewSummary } from "@/lib/services/meetings";

type P = { id: string };
export const GET = apiRoute<P>({ permissions: ["meeting:read"] }, async ({ user, params }) => {
  const d = await getMeetingDetail(user, params.id); // visibility + existence check
  return { summary: d.meeting.summary ?? (await previewSummary(user, params.id)), final: Boolean(d.meeting.summary) };
});
