import { requirePermission } from "@/lib/auth/current";
import { ExportsView } from "./ExportsView";
export default async function Page() {
  await requirePermission("export:run");
  return <ExportsView />;
}
