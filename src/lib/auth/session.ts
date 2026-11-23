import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "../db";
import { config, isProduction, SESSION_COOKIE } from "../config";
import type { AuthUser } from "./permissions";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.sessionAbsoluteHours * 3_600_000);
  await prisma.session.create({
    data: { tokenHash: sha256(token), userId, expiresAt, ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null },
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Validates the session cookie (absolute + idle expiry, active user). Returns null when not authenticated. */
export async function getSessionUser(): Promise<AuthUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session) return null;
  const now = Date.now();
  const idleLimit = session.lastSeenAt.getTime() + config.sessionIdleMinutes * 60_000;
  if (session.expiresAt.getTime() <= now || idleLimit <= now || !session.user.isActive) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined);
  }
  const u = session.user;
  return { id: u.id, email: u.email, name: u.name, role: u.role, canOrganizeMeetings: u.canOrganizeMeetings };
}

export async function requestMeta() {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  return { ip: (fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip")) ?? null, userAgent: h.get("user-agent") };
}

export async function purgeExpiredSessions() {
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}
