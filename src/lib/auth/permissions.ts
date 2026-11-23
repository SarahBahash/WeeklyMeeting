// Central, default-deny permission model. Used by every API route and page.
export type Role = "ADMIN" | "EDITOR" | "VIEWER";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  canOrganizeMeetings: boolean;
}

export type Permission =
  | "actionPoint:read"
  | "actionPoint:write"
  | "actionPoint:correctOriginalDate"
  | "actionPoint:viewRestricted"
  | "actionPoint:setRestricted"
  | "meeting:read"
  | "meeting:participate"
  | "meeting:organize"
  | "meeting:correct"
  | "stage:write"
  | "export:run"
  | "export:originalStatus"
  | "admin:users"
  | "admin:import"
  | "admin:templates"
  | "admin:auditLog"
  | "admin:classify";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  VIEWER: ["actionPoint:read", "meeting:read"],
  EDITOR: ["actionPoint:read", "actionPoint:write", "meeting:read", "meeting:participate", "stage:write", "export:run", "admin:classify"],
  ADMIN: [
    "actionPoint:read", "actionPoint:write", "actionPoint:correctOriginalDate", "actionPoint:viewRestricted",
    "actionPoint:setRestricted", "meeting:read", "meeting:participate", "meeting:organize", "meeting:correct",
    "stage:write", "export:run", "export:originalStatus", "admin:users", "admin:import", "admin:templates",
    "admin:auditLog", "admin:classify",
  ],
};

export function can(user: AuthUser | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  if (permission === "meeting:organize" && user.role === "EDITOR" && user.canOrganizeMeetings) return true;
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}

export function permissionsFor(user: AuthUser): Permission[] {
  const all = new Set<Permission>(ROLE_PERMISSIONS[user.role] ?? []);
  if (can(user, "meeting:organize")) all.add("meeting:organize");
  return [...all];
}
