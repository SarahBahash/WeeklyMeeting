import { requirePermission } from "@/lib/auth/current";
import { AdminView } from "./AdminView";
export default async function Page() {
  await requirePermission("admin:users");
  return <AdminView />;
}
