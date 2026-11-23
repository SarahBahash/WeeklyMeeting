/* Generates a SYNTHETIC workbook with the same structure as
 * "IA Weekly Meeting-Action points (2)-project.xlsx" (sheets IA-MOM, IA-MOM (2), Sheet1)
 * to demonstrate and test the import workflow. Contains no real company data. */
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = process.argv[2] ?? path.join("samples", "SYNTHETIC-IA-Weekly-Meeting-Action-points.xlsx");
const wb = new ExcelJS.Workbook();
const serial = (iso: string) => Math.round(Date.parse(iso + "T00:00:00Z") / 86_400_000) + 25569;
const date = (iso: string) => new Date(iso + "T00:00:00Z");

// ---------------- IA-MOM (main tracker)
const ws = wb.addWorksheet("IA-MOM");
const TITLE = "IA Weekly Meeting – Action Points (SYNTHETIC TEST DATA)";
const HEAD = ["SN", "Action points / Project", "Current Stage", "Process Owner", "Targeted Date", "Revised Date", "Delays", "Priority", "Status", "Feedback"];
ws.addRow([TITLE]);
ws.mergeCells("A1:J1");
ws.addRow(HEAD);
type R = [number | string, string, string, string, string | number | Date | null, string | number | Date | null, string | number | null, string, string, string];
const ip: R[] = [
  [1, "Accounts Receivable Audit", "LOIF", "Finance Dept.", date("2026-10-15"), date("2026-11-30"), null, "High", "In Progress", "LOIF shared with process owner; awaiting responses."],
  [2, "Procurement Process Review", "RCM", "Procurement Dept.", date("2026-11-10"), null, null, "High", "In progress", "RCM drafted, walkthroughs pending for two sub-processes."],
  [3, "IT General Controls Review", "Understanding Meetings", "IT Dept.", serial("2026-12-20"), null, null, "Medium", " In Progress", "Access-management walkthrough scheduled."],
  [4, "Quarterly Audit Committee pack preparation", "", "IA Team", date("2026-11-25"), null, null, "High", "In Progress", "Draft pack under internal review."],
  [5, "Monthly meeting with CFO", "", "Head of IA", "Ongoing", "Ongoing", null, "Medium", "In Progress", "Recurring – next session first week of month."],
  [6, "Update IA Charter", "", "IA Team", "25/11/2026", null, null, "Low", "in progress", "Comments received from legal."],
  [7, "Payroll Audit", "Draft Report", "HR Dept.", date("2026-09-30"), date("2026-11-15"), 46, "High", "In Progress", "Draft report issued for management comments."],
  [8, "Inventory Management Audit", "Kickoff Meeting & MOM", "Supply Chain", date("2026-12-31"), null, null, "Medium", "In Progress", "Kickoff held; MOM circulated."],
  [9, "Follow-up on prior audit observations", "", "All Departments", date("2026-11-20"), "TBD", null, "Medium", "In Progress", "Follow-up responses received from 4 of 6 owners."],
  [10, "Annual risk assessment refresh", "", "IA Team", date("2027-01-15"), null, null, "High", "In Progress", "Risk survey distributed."],
  [11, "Fixed Assets Audit", "PUD Confirmation", "Finance Dept.", date("2026-11-05"), date("2026-12-10"), 35, "Medium", "In Progress", "Awaiting PUD confirmation."],
  [12, "Vendor master data review", "Testing Phase", "Procurement Dept.", date("2026-12-15"), null, null, "Low", "IN PROGRESS", "Sample selection completed."],
  [13, "Meeting with External Auditor", "", "Head of IA", date("2026-11-28"), null, null, "Medium", "In Progress", "Agenda shared."],
  [14, "QAIP self-assessment", "", "IA Team", "Q1 2027", null, null, "Low", "In Progress", "Template prepared."],
  [15, "Treasury Audit", "Scope Discussion", "Treasury", date("2027-02-28"), null, null, "Medium", "In Progress", "Scope discussion scheduled."],
  [16, "Data analytics tool rollout", "", "IA Team", date("2026-12-01"), date("2027-01-31"), 61, "Low", "In Progress", "Licences approved."],
  [17, "Contract management review", "LOR", "Legal Dept.", date("2026-11-18"), null, null, "High", "In Progress", "LOR sent."],
  [18, "Business continuity audit", "Announcement Letter", "Risk Dept.", date("2027-01-10"), null, null, "Medium", "In Progress", "Announcement letter drafted."],
  [19, "Staff training plan 2027", "", "Head of IA", date("2026-12-15"), null, null, "Low", "In Progress", "Needs analysis in progress."],
  [20, "Board audit committee meeting minutes", "", "IA Team", date("2026-11-22"), null, null, "Medium", "In Progress", "Minutes being finalised."],
  [21, "Expense claims audit", "LOIF Validation with Process Owner", "Finance Dept.", date("2026-10-31"), date("2026-11-21"), 21, "High", "In Progress", "Validation meeting held; two findings disputed."],
  [22, "Cybersecurity awareness follow-up", "", "IT Dept.", date("2026-12-31"), null, null, "Low", "In Progress", ""],
  [23, "Customer complaints process review", "Discussion Meeting with SDR & DM", "Customer Service", date("2026-12-05"), null, null, "Medium", "In Progress", "Discussion meeting scheduled."],
];
const done: R[] = [
  [24, "Cash handling audit", "Report Issuance", "Finance Dept.", date("2026-06-30"), null, null, "High", "Completed", "Final report issued."],
  [25, "Audit plan 2026 approval", "", "Head of IA", date("2026-01-31"), null, null, "High", "Complete", "Approved by audit committee."],
  [26, "Petty cash surprise count", "", "Finance Dept.", date("2026-03-15"), null, null, "Low", "closed", "No exceptions."],
  [27, "Travel policy review", "Closing Meeting", "HR Dept.", date("2026-05-31"), date("2026-07-15"), 45, "Medium", "Closed ", "Closed after management action plan accepted."],
  [28, "Sales commission audit", "Report Issuance", "Sales Dept.", date("2026-08-31"), null, null, "Medium", "completed", "Report issued."],
  [29, "Quarterly meeting with CEO (Q3)", "", "Head of IA", date("2026-09-30"), null, null, "Medium", "Complete ", "Held as planned."],
];
const add = (r: R) => ws.addRow(r);
ip.slice(0, 12).forEach(add);
// Repeated title and header block inside the data (as happens when trackers are copy-pasted).
ws.addRow([]);
ws.addRow([TITLE]);
ws.mergeCells(`A${ws.rowCount}:J${ws.rowCount}`);
ws.addRow(HEAD);
ip.slice(12).forEach(add);
done.forEach(add);
// Delay formulas (G = F - E) for a few rows to mimic the original workbook.
ws.eachRow((row, n) => {
  if (n > 2 && typeof row.getCell(7).value === "number") {
    const v = row.getCell(7).value as number;
    row.getCell(7).value = { formula: `F${n}-E${n}`, result: v };
  }
  [5, 6].forEach((c) => { if (row.getCell(c).value instanceof Date) row.getCell(c).numFmt = "dd-mmm-yy"; });
});
ws.columns.forEach((c, i) => (c.width = [6, 44, 26, 20, 14, 14, 8, 10, 12, 50][i]));

// ---------------- IA-MOM (2) (older historical tracker)
const h = wb.addWorksheet("IA-MOM (2)");
h.addRow(["IA Weekly Meeting – historical tracker (SYNTHETIC)"]);
h.addRow(["Action points", "Project", "Process Owner", "Meeting date", "Target Date", "Revised Date", "Status", "Feedback"]);
const hist: (string | Date | number | null)[][] = [
  ["Share LOIF with process owner", "Accounts Receivable Audit", "Finance Dept.", date("2026-09-06"), date("2026-09-30"), null, "In Progress", "Drafting LOIF."],
  ["Kick-off meeting", "Payroll Audit", "HR Dept.", date("2026-07-12"), date("2026-07-20"), null, "Completed", "Held."],
  ["Prepare Audit Committee pack", "Quarterly Audit Committee pack preparation", "IA Team", date("2026-08-16"), date("2026-08-30"), null, "Complete", "Submitted."],
  ["Cash handling audit", "Cash handling audit", "Finance Dept.", date("2026-05-10"), date("2026-06-30"), null, "Closed", "Report issued."],
  ["Review travel policy draft", "Travel policy review", "HR Dept.", date("2026-04-19"), date("2026-05-31"), date("2026-07-15"), "In Progress", "Awaiting HR comments."],
  ["Organise IA team offsite", "", "Head of IA", serial("2026-03-01"), "Ongoing", null, "Closed", "Cancelled."],
  ["Procurement process review", "Procurement Process Review", "Procurement Dept.", date("2026-09-13"), date("2026-11-10"), null, "In progress", "Planning."],
  ["Collect follow-up responses", "Follow-up on prior audit observations", "All Departments", date("2026-10-04"), date("2026-10-31"), date("2026-11-20"), "In Progress", "3 responses outstanding."],
];
hist.forEach((r) => h.addRow(r));
h.eachRow((row, n) => { if (n > 2) [4, 5, 6].forEach((c) => { if (row.getCell(c).value instanceof Date) row.getCell(c).numFmt = "dd/mm/yyyy"; }); });
h.columns.forEach((c, i) => (c.width = [36, 36, 20, 14, 14, 14, 12, 40][i]));

// ---------------- Sheet1 (audit lifecycle)
const s = wb.addWorksheet("Sheet1");
s.addRow(["Accounts Receivable – Audit Stages (example)"]);
const parts: [string, string[]][] = [
  ["Part 1 - Planning and Understanding", ["Scope Discussion", "Announcement Letter", "Kickoff Meeting & MOM", "Understanding Meetings", "PUD", "PUD Confirmation", "LOR", "RCM", "Discussion Meeting with SDR & DM"]],
  ["Part 2 - Initial Findings", ["LOIF", "LOIF Validation with Process Owner"]],
  ["Part 3 - Reporting", ["Draft Report", "Closing Meeting", "Report Issuance"]],
];
let n = 0;
for (const [p, steps] of parts) {
  s.addRow([p]);
  for (const st of steps) s.addRow([++n, st]);
}
s.getColumn(1).width = 34;
s.getColumn(2).width = 40;

mkdirSync(path.dirname(out), { recursive: true });
wb.xlsx.writeFile(out).then(() => console.log(`Synthetic workbook written to ${out} (23 In Progress items + ${done.length} closed/completed)`));
