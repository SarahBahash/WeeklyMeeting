// Calendar-date helpers. Business dates are plain calendar dates (YYYY-MM-DD)
// interpreted in the Asia/Riyadh timezone, with no artificial timezone shifts.
export type ISODate = string;
export const APP_TIMEZONE = "Asia/Riyadh";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function todayInRiyadh(now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Prisma returns @db.Date as a Date at UTC midnight. */
export function dateToISO(d: Date | null | undefined): ISODate | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export function isoToDate(iso: ISODate): Date {
  if (!isValidISODate(iso)) throw new Error(`Invalid date: ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

export function isoFromParts(y: number, m: number, d: number): ISODate | null {
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidISODate(iso) ? iso : null;
}

/** a - b in whole days. */
export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((isoToDate(a).getTime() - isoToDate(b).getTime()) / 86_400_000);
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = isoToDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToISO(d)!;
}

export function formatDate(iso: ISODate | null | undefined): string {
  if (!iso || !isValidISODate(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}

/** Formats an instant in Asia/Riyadh, e.g. "22 Nov 2026, 14:05". */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/** Wall-clock time in Riyadh expressed as a "UTC" Date, for writing into Excel (which has no timezone). */
export function riyadhWallClock(value: Date): Date {
  return new Date(value.getTime() + 3 * 3_600_000); // Asia/Riyadh is UTC+3 with no DST.
}
