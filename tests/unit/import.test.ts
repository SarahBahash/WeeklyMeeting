import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { excelSerialToISO, parseDateCell, titleSimilarity } from "@/lib/import/cells";
import { parseMainSheet, parseHistoricalSheet, parseStageSheet } from "@/lib/import/parsers";
import { UploadRejected, validateXlsxContainer, DEFAULT_LIMITS } from "@/lib/import/xlsx-guard";
import { safeSheetName } from "@/lib/export/workbook";

const WB = path.resolve(__dirname, "../../samples/SYNTHETIC-IA-Weekly-Meeting-Action-points.xlsx");

describe("date parsing", () => {
  it("converts Excel serial numbers", () => {
    expect(excelSerialToISO(46348)).toBe("2026-11-22");
    expect(excelSerialToISO(1)).toBe("1900-01-01");
    expect(parseDateCell(46348).date).toBe("2026-11-22");
  });
  it("parses common text formats (day first)", () => {
    expect(parseDateCell("25/11/2026").date).toBe("2026-11-25");
    expect(parseDateCell("25-Nov-26").date).toBe("2026-11-25");
    expect(parseDateCell("25 November 2026").date).toBe("2026-11-25");
    expect(parseDateCell("Nov 25, 2026").date).toBe("2026-11-25");
    expect(parseDateCell("2026-11-25").date).toBe("2026-11-25");
    expect(parseDateCell("05/11/2026").ambiguous).toBe(true);
  });
  it("preserves non-date text such as Ongoing", () => {
    expect(parseDateCell("Ongoing")).toEqual({ date: null, text: "Ongoing", raw: "Ongoing" });
    expect(parseDateCell("TBD").text).toBe("TBD");
    expect(parseDateCell("31/02/2026").date).toBeNull();
  });
  it("Date cells are taken as calendar dates without timezone shift", () => {
    expect(parseDateCell(new Date("2026-11-22T00:00:00Z")).date).toBe("2026-11-22");
  });
});

describe("sheet parsers (synthetic workbook)", () => {
  it("parses IA-MOM", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(WB);
    const p = parseMainSheet(wb.getWorksheet("IA-MOM")!);
    expect(p.headerRow).toBe(2);
    expect(p.mapping).toMatchObject({ sn: 1, title: 2, stage: 3, owner: 4, target: 5, revised: 6, delays: 7, priority: 8, status: 9, feedback: 10 });
    const data = p.rows.filter((r) => r.kind === "data");
    expect(data).toHaveLength(29);
    expect(data.filter((r) => r.parsed?.status === "IN_PROGRESS")).toHaveLength(23);
    expect(p.rows.filter((r) => r.kind === "header_repeat")).toHaveLength(1);
    expect(p.rows.filter((r) => r.kind === "title_repeat")).toHaveLength(1);
    const payroll = data.find((r) => r.values.title === "Payroll Audit")!;
    expect(payroll.values.delays).toBe("46"); // formula result, never evaluated
  });
  it("parses IA-MOM (2) and Sheet1", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(WB);
    const h = parseHistoricalSheet(wb.getWorksheet("IA-MOM (2)")!);
    expect(h.rows.filter((r) => r.kind === "data")).toHaveLength(8);
    expect(h.mapping).toMatchObject({ title: 1, project: 2, meetingDate: 4 });
    const s = parseStageSheet(wb.getWorksheet("Sheet1")!);
    expect(s.parts.map((p) => p.steps.length)).toEqual([9, 2, 3]);
    expect(s.parts[0].partName).toBe("Planning and Understanding");
    expect(s.parts[2].steps.at(-1)!.name).toBe("Report Issuance");
  });
});

describe("upload guard", () => {
  it("accepts the synthetic workbook", () => {
    expect(validateXlsxContainer(readFileSync(WB)).entries).toBeGreaterThan(5);
  });
  it("rejects non-zip content, oversized files and macros", () => {
    expect(() => validateXlsxContainer(Buffer.from("SN,Title\n1,x"))).toThrow(UploadRejected);
    expect(() => validateXlsxContainer(readFileSync(WB), { ...DEFAULT_LIMITS, maxBytes: 100 })).toThrow(/larger/);
    expect(() => validateXlsxContainer(readFileSync(WB), { ...DEFAULT_LIMITS, maxUncompressedBytes: 1000 })).toThrow(/unsafe size/);
  });
});

describe("misc", () => {
  it("builds safe, unique worksheet names", () => {
    const used = new Set<string>();
    expect(safeSheetName("In Progress", used)).toBe("In Progress");
    expect(safeSheetName("In Progress", used)).toBe("In Progress (2)");
    expect(safeSheetName("A/B:C*D?[E]", used)).toBe("A-B-C-D--E-");
    expect(safeSheetName("x".repeat(40), used).length).toBe(31);
  });
  it("scores title similarity for duplicate detection", () => {
    expect(titleSimilarity("Accounts Receivable Audit", "accounts receivable audit")).toBe(1);
    expect(titleSimilarity("Payroll Audit", "Fixed Assets Audit")).toBeLessThan(0.6);
  });
});
