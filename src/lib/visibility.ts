import "server-only";
import type { Prisma } from "@prisma/client";
import { can, type AuthUser } from "./auth/permissions";

/** Row-level filter applied to every action-point query (prevents IDOR on restricted records). */
export function visibleActionPoints(user: AuthUser): Prisma.ActionPointWhereInput {
  return can(user, "actionPoint:viewRestricted") ? {} : { restricted: false };
}
