import { requireUser } from "@/lib/auth/current";
import { permissionsFor } from "@/lib/auth/permissions";
import { AppShell } from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user} permissions={permissionsFor(user)}>{children}</AppShell>;
}
