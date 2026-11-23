import { describe, expect, it } from "vitest";
import { computeDeadlineInfo, normalizePriority, normalizeStatus, spreadsheetSafe } from "@/lib/domain";
import { diffDays, formatDate, isValidISODate, todayInRiyadh } from "@/lib/dates";

describe("status normalisation", () => {
  it.each([
    ["In Progress", "IN_PROGRESS"], [" in progress ", "IN_PROGRESS"], ["IN PROGRESS", "IN_PROGRESS"], ["In-Progress", "IN_PROGRESS"],
    ["Complete", "COMPLETED"], ["completed ", "COMPLETED"], ["Closed ", "CLOSED"], ["closed", "CLOSED"],
    ["On Hold", "ON_HOLD"], ["Not Started", "NOT_STARTED"],
  ])("%j → %s", (raw, expected) => {
    expect(normalizeStatus(raw)).toEqual({ status: expected, recognized: true });
  });
  it("does not guess unknown or blank values", () => {
    expect(normalizeStatus("Ongoing?")).toEqual({ status: null, recognized: false });
    expect(normalizeStatus("")).toEqual({ status: null, recognized: false });
  });
  it("normalises priority", () => {
    expect(normalizePriority("High").priority).toBe("HIGH");
    expect(normalizePriority(" medium ").priority).toBe("MEDIUM");
    expect(normalizePriority("P9").recognized).toBe(false);
    expect(normalizePriority("")).toEqual({ priority: null, recognized: true });
  });
});

describe("deadline calculation", () => {
  const today = "2026-11-23";
  it("uses the revised date as the effective deadline", () => {
    const d = computeDeadlineInfo({ originalTargetDate: "2026-11-01", revisedTargetDate: "2026-11-20", status: "IN_PROGRESS" }, today);
    expect(d).toMatchObject({ effectiveDeadline: "2026-11-20", effectiveSource: "REVISED", overdueDays: 3, extensionDays: 19, isOverdue: true });
  });
  it("falls back to the original target date", () => {
    const d = computeDeadlineInfo({ originalTargetDate: "2026-11-25", revisedTargetDate: null, status: "IN_PROGRESS" }, today);
    expect(d).toMatchObject({ effectiveDeadline: "2026-11-25", effectiveSource: "ORIGINAL", overdueDays: null, isDueSoon: true, daysUntilDue: 2 });
  });
  it("never marks undated / text-only items overdue", () => {
    const d = computeDeadlineInfo({ originalTargetDate: null, revisedTargetDate: null, status: "IN_PROGRESS" }, today);
    expect(d).toMatchObject({ effectiveDeadline: null, isOverdue: false, overdueDays: null, isDueSoon: false });
  });
  it("completed and closed items are never overdue", () => {
    for (const status of ["COMPLETED", "CLOSED"] as const) {
      expect(computeDeadlineInfo({ originalTargetDate: "2026-01-01", revisedTargetDate: null, status }, today).isOverdue).toBe(false);
    }
  });
  it("keeps extension days separate from overdue days", () => {
    const d = computeDeadlineInfo({ originalTargetDate: "2026-10-01", revisedTargetDate: "2026-12-31", status: "IN_PROGRESS" }, today);
    expect(d.extensionDays).toBe(91);
    expect(d.overdueDays).toBeNull();
  });
});

describe("dates (Asia/Riyadh, no shifts)", () => {
  it("computes today in Riyadh", () => {
    expect(todayInRiyadh(new Date("2026-11-21T21:30:00Z"))).toBe("2026-11-22"); // 00:30 Sunday in Riyadh
    expect(todayInRiyadh(new Date("2026-11-22T20:59:00Z"))).toBe("2026-11-22");
  });
  it("validates calendar dates", () => {
    expect(isValidISODate("2026-02-28")).toBe(true);
    expect(isValidISODate("2026-02-29")).toBe(false);
    expect(isValidISODate("2028-02-29")).toBe(true);
    expect(isValidISODate("22/11/2026")).toBe(false);
  });
  it("diff and format", () => {
    expect(diffDays("2026-12-05", "2026-11-25")).toBe(10);
    expect(formatDate("2026-11-22")).toBe("22 Nov 2026");
  });
});

describe("spreadsheet formula injection", () => {
  it.each(["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\t=1", "\r=1", "＝1"])("prefixes %j", (v) => {
    expect(spreadsheetSafe(v).startsWith("'")).toBe(true);
  });
  it("leaves normal text alone", () => {
    expect(spreadsheetSafe("Audit of A/R – phase 1")).toBe("Audit of A/R – phase 1");
  });
});
