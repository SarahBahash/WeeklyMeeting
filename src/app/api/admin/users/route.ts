import { z } from "zod";
import bcrypt from "bcryptjs";
import { apiRoute, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { config } from "@/lib/config";
import { conflict } from "@/lib/errors";

const userSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(2).max(120),
  role: z.enum(["ADMIN", "EDITOR", "VIEWER"]),
  canOrganizeMeetings: z.boolean().default(false),
  password: z.string().min(12, "Use at least 12 characters").max(200).optional(),
});

export const GET = apiRoute({ permissions: ["admin:users"] }, async () => {
  const users = await prisma.user.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  return {
    localAuthEnabled: config.localAuthEnabled,
    users: users.map((u) => ({
      id: u.id, email: u.email, name: u.name, role: u.role, canOrganizeMeetings: u.canOrganizeMeetings, isActive: u.isActive,
      ssoLinked: Boolean(u.oidcSubject), hasLocalPassword: Boolean(u.passwordHash), lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    })),
  };
});

/** Users are provisioned by administrators only (no public sign-up). */
export const POST = apiRoute({ permissions: ["admin:users"] }, async ({ req, user, ip }) => {
  const input = userSchema.parse(await readJson(req));
  if (await prisma.user.findUnique({ where: { email: input.email } })) throw conflict("A user with this email already exists.");
  const created = await prisma.user.create({
    data: {
      email: input.email, name: input.name, role: input.role, canOrganizeMeetings: input.canOrganizeMeetings,
      passwordHash: config.localAuthEnabled && input.password ? await bcrypt.hash(input.password, 12) : null,
    },
  });
  await auditLog(user, "user.create", { entityType: "User", entityId: created.id, details: { email: created.email, role: created.role, canOrganizeMeetings: created.canOrganizeMeetings }, ip });
  return { id: created.id };
});
