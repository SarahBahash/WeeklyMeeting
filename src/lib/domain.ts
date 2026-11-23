// Shared (client + server) domain definitions. Must not import server-only code.
import { diffDays, type ISODate } from "./dates";

export const STATUSES = ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CLOSED"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  ON_HOLD: "On Hold",
  COMPLETED: "Completed",
  CLOSED: "Closed",
};
/** Statuses in which an item can be overdue / due soon. */
export const ACTIVE_STATUSES: Status[] = ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD"];

export const PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

export const STAGE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "NOT_APPLICABLE"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];
export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  NOT_APPLICABLE: "Not Applicable",
};

export const DUE_SOON_DAYS = 7;

export function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .replace(/ /g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-]+/g, " ");
}

const STATUS_SYNONYMS: Record<string, Status> = {
  "not started": "NOT_STARTED",
  "notstarted": "NOT_STARTED",
  "not yet started": "NOT_STARTED",
  "in progress": "IN_PROGRESS",
  "inprogress": "IN_PROGRESS",
  "in process": "IN_PROGRESS",
  "on hold": "ON_HOLD",
  "onhold": "ON_HOLD",
  "hold": "ON_HOLD",
  "complete": "COMPLETED",
  "completed": "COMPLETED",
  "closed": "CLOSED",
  "close": "CLOSED",
};

/** Maps legacy/imported status text to a standard status. Original text must be preserved separately. */
export function normalizeStatus(raw: unknown): { status: Status | null; recognized: boolean } {
  const key = normalizeKey(raw);
  if (!key) return { status: null, recognized: false };
  const s = STATUS_SYNONYMS[key];
  return s ? { status: s, recognized: true } : { status: null, recognized: false };
}

export function normalizePriority(raw: unknown): { priority: Priority | null; recognized: boolean } {
  const key = normalizeKey(raw);
  if (!key) return { priority: null, recognized: true };
  if (["high", "h", "critical", "urgent"].includes(key)) return { priority: "HIGH", recognized: true };
  if (["medium", "med", "m", "moderate", "normal"].includes(key)) return { priority: "MEDIUM", recognized: true };
  if (["low", "l"].includes(key)) return { priority: "LOW", recognized: true };
  return { priority: null, recognized: false };
}

export interface DeadlineInput {
  originalTargetDate: ISODate | null;
  revisedTargetDate: ISODate | null;
  status: Status;
}

export interface DeadlineInfo {
  effectiveDeadline: ISODate | null;
  effectiveSource: "REVISED" | "ORIGINAL" | null;
  /** Days past the effective deadline (active items only); null when not overdue/undated. */
  overdueDays: number | null;
  /** Days the deadline was extended (revised - original); independent of overdue days. */
  extensionDays: number | null;
  daysUntilDue: number | null;
  isOverdue: boolean;
  isDueSoon: boolean;
}

export function computeDeadlineInfo(item: DeadlineInput, today: ISODate): DeadlineInfo {
  const effectiveDeadline = item.revisedTargetDate ?? item.originalTargetDate ?? null;
  const effectiveSource = item.revisedTargetDate ? "REVISED" : item.originalTargetDate ? "ORIGINAL" : null;
  const active = ACTIVE_STATUSES.includes(item.status);
  const extensionDays =
    item.revisedTargetDate && item.originalTargetDate ? diffDays(item.revisedTargetDate, item.originalTargetDate) : null;
  if (!effectiveDeadline) {
    return { effectiveDeadline: null, effectiveSource: null, overdueDays: null, extensionDays, daysUntilDue: null, isOverdue: false, isDueSoon: false };
  }
  const daysUntilDue = diffDays(effectiveDeadline, today);
  const isOverdue = active && daysUntilDue < 0;
  const isDueSoon = active && daysUntilDue >= 0 && daysUntilDue <= DUE_SOON_DAYS;
  return {
    effectiveDeadline,
    effectiveSource,
    overdueDays: isOverdue ? -daysUntilDue : null,
    extensionDays,
    daysUntilDue: active ? daysUntilDue : null,
    isOverdue,
    isDueSoon,
  };
}

/** Text that is safe to write into a spreadsheet cell (prevents formula injection). */
export function spreadsheetSafe(value: string): string {
  const v = value.length > 32_000 ? value.slice(0, 32_000) + "…" : value;
  return /^[=+\-@\t\r＝＋－＠]/.test(v) ? `'${v}` : v;
}
