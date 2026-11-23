import "server-only";
import { redirect } from "next/navigation";
import { getSessionUser } from "./session";
import { can, type Permission } from "./permissions";

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePermission(p: Permission) {
  const user = await requireUser();
  if (!can(user, p)) redirect("/forbidden");
  return user;
}
