import type { CellValue } from "exceljs";
import { isoFromParts, dateToISO, type ISODate } from "../dates";

/** Converts any exceljs cell value into plain text (no formulas are ever evaluated). */
export function cellText(v: CellValue | undefined, trim = true): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return trim ? v.replace(/\u00a0/g, " ").trim() : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return dateToISO(v) ?? "";
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) {
      const t = v.richText.map((r) => r.text).join("");
      return trim ? t.trim() : t;
    }
    if ("result" in v) return cellText((v as { result?: CellValue }).result, trim);
    if ("text" in v) return cellText((v as { text: CellValue }).text, trim);
    if ("error" in v) return "";
  }
  return String(v).trim();
}

/** Raw value suitable for date parsing (keeps numbers/dates typed). */
export function cellRaw(v: CellValue | undefined): string | number | Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === "number") return v;
  if (typeof v === "object" && "result" in v) return cellRaw((v as { result?: CellValue }).result);
  const t = cellText(v);
  return t === "" ? null : t;
}

export function excelSerialToISO(serial: number): ISODate | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 120_000) return null;
  // Excel's 1900 date system (includes the fictitious 29 Feb 1900 for serial >= 60).
  const days = Math.floor(serial) - (serial >= 60 ? 25569 : 25568);
  return dateToISO(new Date(days * 86_400_000));
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

const yr = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

export interface ParsedDate {
  date: ISODate | null;
  /** Non-date text preserved verbatim (e.g. "Ongoing"). */
  text: string | null;
  raw: string | null;
  ambiguous?: boolean;
}

/** Parses an Excel serial, a Date, or common text formats. Day-first is assumed for numeric text dates. */
export function parseDateCell(value: string | number | Date | null): ParsedDate {
  if (value === null || value === "") return { date: null, text: null, raw: null };
  if (value instanceof Date) {
    const iso = dateToISO(value);
    return { date: iso, text: null, raw: iso };
  }
  if (typeof value === "number") {
    const iso = excelSerialToISO(value);
    return iso ? { date: iso, text: null, raw: String(value) } : { date: null, text: String(value), raw: String(value) };
  }
  const s = value.trim().replace(/\s+/g, " ");
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s))) {
    const iso = isoFromParts(+m[1], +m[2], +m[3]);
    if (iso) return { date: iso, text: null, raw: s };
  }
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s))) {
    const a = +m[1], b = +m[2], y = yr(m[3]);
    const iso = isoFromParts(y, b, a) ?? isoFromParts(y, a, b);
    if (iso) return { date: iso, text: null, raw: s, ambiguous: a <= 12 && b <= 12 && a !== b };
  }
  if ((m = /^(\d{1,2})(?:st|nd|rd|th)?[ \-/.]([A-Za-z]{3,9})\.?[ \-/.,]*(\d{2}|\d{4})$/.exec(s))) {
    const mo = MONTHS[m[2].toLowerCase()];
    const iso = mo ? isoFromParts(yr(m[3]), mo, +m[1]) : null;
    if (iso) return { date: iso, text: null, raw: s };
  }
  if ((m = /^([A-Za-z]{3,9})\.?[ \-/.](\d{1,2})(?:st|nd|rd|th)?,?[ \-/.](\d{2}|\d{4})$/.exec(s))) {
    const mo = MONTHS[m[1].toLowerCase()];
    const iso = mo ? isoFromParts(yr(m[3]), mo, +m[2]) : null;
    if (iso) return { date: iso, text: null, raw: s };
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const iso = excelSerialToISO(Number(s));
    if (iso && Number(s) > 20000) return { date: iso, text: null, raw: s };
  }
  return { date: null, text: s.slice(0, 200), raw: s };
}

export function normalizeHeader(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeTitle(v: string): string {
  return v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a), nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if ((na.length > 8 && nb.includes(na)) || (nb.length > 8 && na.includes(nb))) return 0.9;
  const ta = new Set(na.split(" ")), tb = new Set(nb.split(" "));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
