import { ProjectStages } from "./ProjectStages";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectStages id={id} />;
}
