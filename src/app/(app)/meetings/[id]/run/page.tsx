import { MeetingRunner } from "./MeetingRunner";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MeetingRunner id={id} />;
}
