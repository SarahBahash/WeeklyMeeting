import "server-only";
import { prisma } from "./db";
import type { AuthUser } from "./auth/permissions";
import type { Prisma } from "@prisma/client";

/** Writes to the append-only technical/security audit log. Never include secrets or file contents. */
export async function auditLog(
  actor: Pick<AuthUser, "id" | "email"> | null,
  action: string,
  opts: { entityType?: string; entityId?: string; details?: Prisma.InputJsonValue; ip?: string | null } = {},
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.systemAuditLog.create({
    data: {
      actorId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      details: opts.details,
      ip: opts.ip ?? null,
    },
  });
}
