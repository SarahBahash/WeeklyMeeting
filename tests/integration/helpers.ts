import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";

export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
export const PASSWORD = process.env.SEED_DEV_PASSWORD ?? "DevOnly-Synthetic-2026!";
export const WORKBOOK = path.resolve(__dirname, "../../samples/SYNTHETIC-IA-Weekly-Meeting-Action-points.xlsx");

/**
 * Recreates the schema of the dedicated *test* database (name must end in "_test") and applies
 * migrations + reference seed. Refuses to touch any other database.
 */
export function resetDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test") || process.env.INTEGRATION_ALLOW_RESET !== "1") {
    throw new Error("Integration tests only run against a disposable database whose name ends in _test, with INTEGRATION_ALLOW_RESET=1.");
  }
  const env = { ...process.env, AUTH_LOCAL_ENABLED: "true", SEED_DEV_PASSWORD: PASSWORD };
  execSync(`npx prisma db execute --url "${url}" --stdin`, { input: "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;", stdio: ["pipe", "ignore", "inherit"], env });
  execSync("npx prisma migrate deploy", { stdio: "ignore", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "ignore", env });
}

export class Client {
  cookie = "";
  constructor(public email?: string) {}
  async login() {
    const res = await this.req("POST", "/api/auth/login", { email: this.email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login failed for ${this.email}: ${res.status}`);
    return this;
  }
  async req(method: string, url: string, body?: unknown, opts: { origin?: string | null; form?: FormData } = {}) {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    if (opts.origin !== null && method !== "GET") headers.origin = opts.origin ?? BASE;
    let payload: BodyInit | undefined;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers, body: payload, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) {
      const m = /(iahub_session|__Host-iahub_session)=([^;]*)/.exec(set);
      if (m) this.cookie = m[2] ? `${m[1]}=${m[2]}` : "";
    }
    return res;
  }
  async json<T = any>(method: string, url: string, body?: unknown, expect = 200): Promise<T> {
    const res = await this.req(method, url, body);
    const data = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.arrayBuffer();
    if (res.status !== expect) throw new Error(`${method} ${url} → ${res.status} (expected ${expect}): ${JSON.stringify(data).slice(0, 400)}`);
    return data as T;
  }
  async upload(kind: string, file = WORKBOOK, extra: Record<string, string> = {}, name = "SYNTHETIC.xlsx") {
    const form = new FormData();
    form.set("file", new Blob([readFileSync(file)]), name);
    form.set("kind", kind);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return this.req("POST", "/api/admin/import", undefined, { form });
  }
  async exportXlsx(body: unknown) {
    const res = await this.req("POST", "/api/exports", body);
    if (res.status !== 200) return { status: res.status, wb: null as ExcelJS.Workbook | null, res };
    const buf = Buffer.from(await res.arrayBuffer());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    return { status: 200, wb, res, buf };
  }
}

export const sheetRows = (ws: ExcelJS.Worksheet) => {
  const out: Record<string, unknown>[] = [];
  const headers = (ws.getRow(1).values as unknown[]).slice(1).map(String);
  for (let r = 2; r <= ws.rowCount; r++) {
    const vals = (ws.getRow(r).values as unknown[]).slice(1);
    if (!vals.length) continue;
    out.push(Object.fromEntries(headers.map((h, i) => [h, vals[i]])));
  }
  return out;
};
