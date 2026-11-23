"use client";
import { formatDate } from "@/lib/dates";
import type { ActionPointDTO } from "@/lib/services/action-points";

export function DateText({ date, text }: { date: string | null; text: string | null }) {
  if (date) return <span className="whitespace-nowrap">{formatDate(date)}</span>;
  if (text) return <span className="italic text-muted" title="Imported text value (not a date)">{text}</span>;
  return <span className="text-muted">—</span>;
}

export function DeadlineFlag({ ap }: { ap: ActionPointDTO }) {
  const d = ap.deadline;
  if (d.isOverdue) return <span className="mt-1 inline-block rounded bg-danger-light px-1.5 py-0.5 text-[11px] font-semibold text-danger">Overdue {d.overdueDays}d</span>;
  if (d.isDueSoon) return <span className="mt-1 inline-block rounded bg-warn-light px-1.5 py-0.5 text-[11px] font-semibold text-warn">{d.daysUntilDue === 0 ? "Due today" : `Due in ${d.daysUntilDue}d`}</span>;
  return null;
}
