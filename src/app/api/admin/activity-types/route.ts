import { z } from "zod";
import { apiRoute, readJson } from "@/lib/api";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";

const schema = z.object({
  id: z.string().max(40).optional(),
  name: z.string().trim().min(2).max(80),
  supportsStages: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const POST = apiRoute({ permissions: ["admin:templates"] }, async ({ req, user, ip }) => {
  const input = schema.parse(await readJson(req));
  const code = input.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  const rec = input.id
    ? await prisma.activityType.update({ where: { id: input.id }, data: { name: input.name, supportsStages: input.supportsStages, isActive: input.isActive } })
    : await prisma.activityType.create({ data: { code, name: input.name, supportsStages: input.supportsStages, sortOrder: (await prisma.activityType.count()) + 1 } });
  await auditLog(user, input.id ? "activityType.update" : "activityType.create", { entityType: "ActivityType", entityId: rec.id, details: input, ip });
  return { id: rec.id };
});
