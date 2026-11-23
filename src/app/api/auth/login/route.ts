import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config";
import { createSession, requestMeta } from "@/lib/auth/session";
import { auditLog } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { errorResponse, readJson } from "@/lib/api";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });
// Used to keep timing similar when the user does not exist.
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("not-a-real-password", 12));

/** Local password login – development/test with synthetic users only. Disabled in production builds. */
export async function POST(req: NextRequest) {
  try {
    if (!config.localAuthEnabled) return NextResponse.json({ error: "Local sign-in is disabled. Use company single sign-on." }, { status: 404 });
    const meta = await requestMeta();
    const body = schema.parse(await readJson(req, 4096));
    const rl = rateLimit(`login:${meta.ip}:${body.email}`, 5, 60_000);
    const rlIp = rateLimit(`login-ip:${meta.ip}`, 30, 300_000);
    if (!rl.ok || !rlIp.ok) {
      return NextResponse.json({ error: "Too many sign-in attempts. Please wait a minute." }, { status: 429 });
    }
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    const ok = await bcrypt.compare(body.password, user?.passwordHash ?? getDummyHash());
    if (!user || !ok || !user.isActive || !user.passwordHash) {
      await auditLog(null, "auth.login_failed", { details: { email: body.email, method: "local" }, ip: meta.ip });
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    await createSession(user.id, meta);
    await auditLog({ id: user.id, email: user.email }, "auth.login", { details: { method: "local-dev" }, ip: meta.ip });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
