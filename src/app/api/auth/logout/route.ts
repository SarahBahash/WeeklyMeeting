import { NextResponse } from "next/server";
import { destroySession, getSessionUser, requestMeta } from "@/lib/auth/session";
import { auditLog } from "@/lib/audit";

export async function POST() {
  const user = await getSessionUser();
  await destroySession();
  if (user) await auditLog(user, "auth.logout", { ip: (await requestMeta()).ip });
  return NextResponse.json({ ok: true });
}
