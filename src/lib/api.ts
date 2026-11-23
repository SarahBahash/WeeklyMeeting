import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { ApiError } from "./errors";
import { getSessionUser, requestMeta } from "./auth/session";
import { can, type AuthUser, type Permission } from "./auth/permissions";
import { rateLimit } from "./rate-limit";

export interface RouteCtx<P> {
  req: NextRequest;
  user: AuthUser;
  params: P;
  ip: string | null;
}

interface Options {
  /** Every listed permission is required. Routes without permissions still require authentication. */
  permissions?: Permission[];
  rateLimit?: { limit: number; windowMs: number; key: string };
}

/**
 * Wraps a route handler with authentication, server-side authorization (default deny),
 * rate limiting and safe error handling (no internals leaked to the client).
 */
export function apiRoute<P = Record<string, string>>(opts: Options, handler: (ctx: RouteCtx<P>) => Promise<unknown>) {
  return async (req: NextRequest, context: { params: Promise<P> }) => {
    try {
      const user = await getSessionUser();
      if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      for (const p of opts.permissions ?? []) {
        if (!can(user, p)) return NextResponse.json({ error: "You do not have permission to perform this action" }, { status: 403 });
      }
      if (opts.rateLimit) {
        const r = rateLimit(`${opts.rateLimit.key}:${user.id}`, opts.rateLimit.limit, opts.rateLimit.windowMs);
        if (!r.ok) return NextResponse.json({ error: "Too many requests. Please wait and try again." }, { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } });
      }
      const { ip } = await requestMeta();
      const params = (await context.params) as P;
      const result = await handler({ req, user, params, ip });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) return NextResponse.json({ error: err.message, ...(err.data ?? {}) }, { status: err.status });
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Some fields are invalid", fieldErrors: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return NextResponse.json({ error: "A record with the same unique value already exists" }, { status: 409 });
    if (err.code === "P2025") return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }
  const ref = randomUUID().slice(0, 8);
  console.error(`[api-error ${ref}]`, err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : err);
  return NextResponse.json({ error: `An unexpected error occurred (reference ${ref})` }, { status: 500 });
}

export async function readJson(req: NextRequest, maxBytes = 512 * 1024): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new ApiError(413, "Request body is too large");
  const text = await req.text();
  if (text.length > maxBytes) throw new ApiError(413, "Request body is too large");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Malformed JSON body");
  }
}
