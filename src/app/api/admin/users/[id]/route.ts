import { z } from "zod";
import bcrypt from "bcryptjs";
import { apiRoute, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { config } from "@/lib/config";
import { badRequest, notFound } from "@/lib/errors";

const schema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).optional(),
  canOrganizeMeetings: z.boolean().optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(12, "Use at least 12 characters").max(200).optional(),
});

type P = { id: string };
export const PATCH = apiRoute<P>({ permissions: ["admin:users"] }, async ({ req, user, params, ip }) => {
  const input = schema.parse(await readJson(req));
  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) throw notFound("User");
  if (target.id === user.id && (input.role && input.role !== "ADMIN" || input.isActive === false)) {
    throw badRequest("You cannot remove your own administrator access.");
  }
  if (target.role === "ADMIN" && ((input.role && input.role !== "ADMIN") || input.isActive === false)) {
    const admins = await prisma.user.count({ where: { role: "ADMIN", isActive: true } });
    if (admins <= 1) throw badRequest("At least one active administrator is required.");
  }
  const { password, ...rest } = input;
  if (password && !config.localAuthEnabled) throw badRequest("Local passwords are disabled; users sign in with SSO.");
  await prisma.user.update({ where: { id: target.id }, data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}) } });
  // Revoke sessions on deactivation or role change so new permissions apply immediately.
  if (input.isActive === false || (input.role && input.role !== target.role)) await prisma.session.deleteMany({ where: { userId: target.id } });
  await auditLog(user, "user.update", { entityType: "User", entityId: target.id, details: { ...rest, passwordChanged: Boolean(password) }, ip });
  return { ok: true };
});
