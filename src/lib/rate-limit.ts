import "server-only";
// Fixed-window in-memory limiter. For multi-instance deployments, replace with a
// shared store (e.g. Redis) or enforce limits at the reverse proxy / WAF.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return { ok: true, retryAfterSec: 0 };
  }
  b.count += 1;
  return b.count > limit ? { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) } : { ok: true, retryAfterSec: 0 };
}
