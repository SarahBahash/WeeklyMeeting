/**
 * End-to-end API tests against a running server and a disposable PostgreSQL database.
 * Run:  INTEGRATION_ALLOW_RESET=1 npm run test:integration   (server on TEST_BASE_URL)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { Client, resetDatabase, sheetRows } from "./helpers";

const prisma = new PrismaClient();
const admin = new Client("admin@example.test");
const organizer = new Client("organizer@example.test");
const editor = new Client("editor@example.test");
const viewer = new Client("viewer@example.test");
const anon = new Client();

let aps: any[] = [];
const byTitle = (t: string) => aps.find((a) => a.title === t);

beforeAll(async () => {
  resetDatabase();
  await Promise.all([admin.login(), organizer.login(), editor.login(), viewer.login()]);
});

describe("security", () => {
  it("rejects unauthenticated access to business data", async () => {
    for (const url of ["/api/action-points", "/api/meetings", "/api/dashboard", "/api/admin/users"]) {
      expect((await anon.req("GET", url)).status).toBe(401);
    }
    expect((await anon.req("POST", "/api/exports", { type: "FULL_TRACKER" })).status).toBe(401);
  });
  it("rejects wrong passwords and unknown users with the same message", async () => {
    const a = await anon.req("POST", "/api/auth/login", { email: "admin@example.test", password: "wrong-password-123" });
    const b = await anon.req("POST", "/api/auth/login", { email: "nobody@example.test", password: "wrong-password-123" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect((await a.json()).error).toBe((await b.json()).error);
  });
  it("blocks cross-site state-changing requests (CSRF)", async () => {
    expect((await editor.req("POST", "/api/action-points", { title: "x" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await editor.req("POST", "/api/action-points", { title: "x" }, { origin: null })).status).toBe(403);
  });
  it("sets security headers", async () => {
    const res = await admin.req("GET", "/");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("viewer and editor cannot use admin APIs", async () => {
    for (const c of [viewer, editor]) {
      expect((await c.req("GET", "/api/admin/users")).status).toBe(403);
      expect((await c.req("GET", "/api/admin/audit-log")).status).toBe(403);
      expect((await c.upload("MAIN_TRACKER")).status).toBe(403);
    }
  });
});

describe("Excel import", () => {
  let batchId = "";
  it("rejects files that are not real .xlsx workbooks", async () => {
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("SN,Title\n1,=cmd|' /C calc'!A0")]), "fake.xlsx");
    form.set("kind", "MAIN_TRACKER");
    const res = await admin.req("POST", "/api/admin/import", undefined, { form });
    expect(res.status).toBe(422);
  });
  it("previews the main tracker: headers, repeated rows, statuses, dates", async () => {
    const res = await admin.upload("MAIN_TRACKER");
    expect(res.status).toBe(200);
    const p = await res.json();
    batchId = p.batchId;
    expect(p.sheetName).toBe("IA-MOM");
    expect(p.headerRow).toBe(2);
    expect(p.sheets).toEqual(["IA-MOM", "IA-MOM (2)", "Sheet1"]);
    expect(p.stats.dataRows).toBe(29);
    expect(p.stats.headerRepeats).toBe(1);
    expect(p.stats.titleRepeats).toBe(1);
    expect(p.stats.status_IN_PROGRESS).toBe(23);
    expect(p.stats.status_COMPLETED).toBe(4);
    expect(p.stats.status_CLOSED).toBe(2);
    const rows = p.rows.filter((r: any) => r.kind === "data");
    const ongoing = rows.find((r: any) => r.values.title === "Monthly meeting with CFO");
    expect(ongoing.parsed.target).toMatchObject({ date: null, text: "Ongoing" });
    const serial = rows.find((r: any) => r.values.title === "IT General Controls Review");
    expect(serial.parsed.target.date).toBe("2026-12-20");
    const textDate = rows.find((r: any) => r.values.title === "Update IA Charter");
    expect(textDate.parsed.target.date).toBe("2026-11-25");
    expect(rows.filter((r: any) => !r.values.stage).length).toBeGreaterThan(5);
    // Nothing is written before confirmation.
    expect(await prisma.actionPoint.count()).toBe(0);
  });
  it("commits the import and preserves original values", async () => {
    const r = await admin.json("POST", `/api/admin/import/${batchId}/commit`, { decisions: {} });
    expect(r.summary.created).toBe(29);
    expect(r.summary.byStatus.IN_PROGRESS).toBe(23);
    const list = await admin.json("GET", "/api/action-points");
    aps = list.items;
    expect(aps).toHaveLength(29);
    const ip = aps.find((a: any) => a.title === "IT General Controls Review");
    expect(ip.sourceStatus).toBe(" In Progress");
    expect(ip.status).toBe("IN_PROGRESS");
    expect(ip.sourceSheet).toBe("IA-MOM");
    expect(ip.id).not.toBe(ip.legacySn);
    const closed = byTitle("Travel policy review");
    expect(closed.status).toBe("CLOSED");
    expect(closed.sourceStatus).toBe("Closed ");
    expect(closed.sourceDelays).toBe("45");
    expect(byTitle("Audit plan 2026 approval").status).toBe("COMPLETED");
    expect(byTitle("Audit plan 2026 approval").sourceStatus).toBe("Complete");
    expect(byTitle("Monthly meeting with CFO").originalTargetText).toBe("Ongoing");
    expect(byTitle("Monthly meeting with CFO").activityType).toBeNull(); // not guessed
  });
  it("retrying the same commit or re-importing the same workbook cannot duplicate records", async () => {
    const again = await admin.json("POST", `/api/admin/import/${batchId}/commit`, { decisions: {} });
    expect(again.alreadyCommitted).toBe(true);
    const res = await admin.upload("MAIN_TRACKER");
    const p = await res.json();
    expect(p.stats.alreadyImported).toBe(29);
    expect(p.previouslyCommitted.length).toBe(1);
    // Force "import" on every row: the unique import key still prevents duplicates.
    const decisions = Object.fromEntries(p.rows.filter((r: any) => r.kind === "data").map((r: any) => [r.rowNumber, "import"]));
    const r = await admin.json("POST", `/api/admin/import/${p.batchId}/commit`, { decisions });
    expect(r.summary.created).toBe(0);
    expect(await prisma.actionPoint.count()).toBe(29);
  });
  it("concurrent confirmations of one preview commit exactly once", async () => {
    // A modified copy (different file hash) flags duplicates by title instead.
    const res = await admin.upload("MAIN_TRACKER", undefined, {}, "copy.xlsx");
    const p = await res.json();
    const [a, b] = await Promise.all([
      admin.req("POST", `/api/admin/import/${p.batchId}/commit`, { decisions: {} }),
      admin.req("POST", `/api/admin/import/${p.batchId}/commit`, { decisions: {} }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await prisma.actionPoint.count()).toBe(29);
  });
  it("imports the historical sheet for review without merging", async () => {
    const res = await admin.upload("HISTORICAL");
    const p = await res.json();
    expect(p.sheetName).toBe("IA-MOM (2)");
    expect(p.stats.dataRows).toBe(8);
    expect(p.stats.possibleDuplicates).toBeGreaterThan(0);
    const r = await admin.json("POST", `/api/admin/import/${p.batchId}/commit`, {});
    expect(r.summary.storedForReview).toBe(8);
    expect(await prisma.actionPoint.count()).toBe(29); // no automatic merge
    const { records } = await admin.json("GET", "/api/admin/legacy?decision=PENDING");
    const merge = records.find((x: any) => x.actionText === "Share LOIF with process owner");
    expect(merge.candidates[0].title).toBe("Accounts Receivable Audit");
    await admin.json("POST", `/api/admin/legacy/${merge.id}`, { decision: "MERGE", actionPointId: merge.candidates[0].id });
    const retain = records.find((x: any) => x.actionText === "Organise IA team offsite");
    const ret = await admin.json("POST", `/api/admin/legacy/${retain.id}`, { decision: "RETAIN" });
    expect(ret.linkedActionPointId).toBeTruthy();
    expect((await admin.req("POST", `/api/admin/legacy/${retain.id}`, { decision: "RETAIN" })).status).toBe(409);
    const hist = await admin.json("GET", `/api/action-points/${merge.candidates[0].id}/history`);
    expect(hist.changes.some((c: any) => c.field === "historicalRecord")).toBe(true);
    aps = (await admin.json("GET", "/api/action-points")).items;
    expect(aps).toHaveLength(30);
  });
  it("creates an audit-stage template from Sheet1 (not action points)", async () => {
    const res = await admin.upload("STAGE_TEMPLATE");
    const p = await res.json();
    expect(p.stats).toMatchObject({ parts: 3, stages: 14 });
    const r = await admin.json("POST", `/api/admin/import/${p.batchId}/commit`, { templateName: "Imported AR lifecycle" });
    expect(r.summary.stages).toBe(14);
    const { templates } = await admin.json("GET", "/api/templates");
    const t = templates.find((x: any) => x.name === "Imported AR lifecycle");
    expect(t.stages.map((s: any) => s.name).slice(0, 3)).toEqual(["Scope Discussion", "Announcement Letter", "Kickoff Meeting & MOM"]);
    expect(t.stages[13].name).toBe("Report Issuance");
    expect(await prisma.actionPoint.count()).toBe(30);
  });
});

describe("dashboard", () => {
  it("counts match the database", async () => {
    const d = await viewer.json("GET", "/api/dashboard");
    expect(d.total).toBe(await prisma.actionPoint.count());
    expect(d.inProgress).toBe(await prisma.actionPoint.count({ where: { status: "IN_PROGRESS" } }));
    expect(d.completed).toBe(await prisma.actionPoint.count({ where: { status: "COMPLETED" } }));
    expect(d.closed).toBe(await prisma.actionPoint.count({ where: { status: "CLOSED" } }));
    expect(d.inProgress).toBe(23);
  });
  it("filters by status, owner and search; blank-stage items appear", async () => {
    const ip = await viewer.json("GET", "/api/action-points?status=IN_PROGRESS");
    expect(ip.items).toHaveLength(23);
    expect(ip.items.some((a: any) => !a.currentStage)).toBe(true);
    const done = await viewer.json("GET", "/api/action-points?status=COMPLETED,CLOSED");
    expect(done.items.every((a: any) => ["COMPLETED", "CLOSED"].includes(a.status))).toBe(true);
    const owner = await viewer.json("GET", "/api/action-points?owner=finance%20dept.");
    expect(owner.items.length).toBeGreaterThan(2);
    expect(owner.items.every((a: any) => a.ownerName === "Finance Dept.")).toBe(true);
    const q = await viewer.json("GET", "/api/action-points?q=payroll");
    expect(q.items.map((a: any) => a.title)).toContain("Payroll Audit");
  });
  it("never marks undated / 'Ongoing' items overdue", async () => {
    const od = await viewer.json("GET", "/api/action-points?overdue=1");
    expect(od.items.find((a: any) => a.title === "Monthly meeting with CFO")).toBeUndefined();
    expect(od.items.every((a: any) => a.deadline.isOverdue)).toBe(true);
    const payroll = od.items.find((a: any) => a.title === "Payroll Audit");
    expect(payroll.deadline.effectiveSource).toBe("REVISED");
    expect(payroll.deadline.extensionDays).toBe(46);
  });
});

describe("quick edit and deadline history", () => {
  it("viewer cannot modify records through the API", async () => {
    const a = byTitle("Treasury Audit");
    expect((await viewer.req("PATCH", `/api/action-points/${a.id}`, { version: a.version, status: "ON_HOLD" })).status).toBe(403);
    expect((await viewer.req("POST", "/api/action-points", { title: "Should fail" })).status).toBe(403);
  });
  it("editor quick-edits, history is recorded, version increments", async () => {
    const a = byTitle("Treasury Audit");
    const r = await editor.json("PATCH", `/api/action-points/${a.id}?source=quick`, { version: a.version, status: "ON_HOLD", priority: "HIGH", ownerName: "Treasury Team" });
    expect(r.actionPoint.status).toBe("ON_HOLD");
    expect(r.actionPoint.version).toBe(a.version + 1);
    const hist = await viewer.json("GET", `/api/action-points/${a.id}/history`);
    const fields = hist.changes.filter((c: any) => c.source === "QUICK_EDIT").map((c: any) => c.field).sort();
    expect(fields).toEqual(["ownerName", "priority", "status"]);
    const status = hist.changes.find((c: any) => c.field === "status");
    expect(status).toMatchObject({ oldValue: "In Progress", newValue: "On Hold", changedBy: "Test Editor" });
  });
  it("concurrent edits cannot silently overwrite each other", async () => {
    const a = byTitle("Treasury Audit"); // stale version
    const res = await organizer.req("PATCH", `/api/action-points/${a.id}`, { version: a.version, status: "IN_PROGRESS" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.conflict).toBe(true);
    expect(body.current.status).toBe("ON_HOLD");
  });
  it("rejects invalid edits", async () => {
    const a = (await editor.json("GET", `/api/action-points/${byTitle("Treasury Audit").id}`)).actionPoint;
    expect((await editor.req("PATCH", `/api/action-points/${a.id}`, { version: a.version, status: "DONE" })).status).toBe(400);
    expect((await editor.req("PATCH", `/api/action-points/${a.id}`, { version: a.version, revisedTargetDate: "2026-02-31" })).status).toBe(400);
    expect((await editor.req("PATCH", `/api/action-points/${a.id}`, { version: a.version, title: "" })).status).toBe(400);
  });
  it("logs every deadline revision and protects original target dates", async () => {
    let a = (await editor.json("GET", `/api/action-points/${byTitle("Inventory Management Audit").id}`)).actionPoint;
    expect(a.originalTargetDate).toBe("2026-12-31");
    a = (await editor.json("PATCH", `/api/action-points/${a.id}`, { version: a.version, revisedTargetDate: "2027-01-15", deadlineReason: "Scope extended" })).actionPoint;
    a = (await editor.json("PATCH", `/api/action-points/${a.id}`, { version: a.version, revisedTargetDate: "2027-02-01" })).actionPoint;
    // Editors cannot change an existing original date…
    expect((await editor.req("PATCH", `/api/action-points/${a.id}`, { version: a.version, originalTargetDate: "2026-12-01" })).status).toBe(403);
    // …admins can correct it, with a reason, logged separately.
    expect((await admin.req("PATCH", `/api/action-points/${a.id}`, { version: a.version, originalTargetDate: "2026-12-01" })).status).toBe(400);
    a = (await admin.json("PATCH", `/api/action-points/${a.id}`, { version: a.version, originalTargetDate: "2026-12-01", deadlineReason: "Data correction – wrong date imported" })).actionPoint;
    const h = await viewer.json("GET", `/api/action-points/${a.id}/history`);
    const rev = h.deadlines.filter((d: any) => d.kind === "REVISION").reverse();
    expect(rev).toHaveLength(2);
    expect(rev[0]).toMatchObject({ previousDate: "2026-12-31", newDate: "2027-01-15", reason: "Scope extended", changedBy: "Test Editor" });
    expect(rev[1]).toMatchObject({ previousDate: "2027-01-15", newDate: "2027-02-01" });
    expect(h.deadlines.find((d: any) => d.kind === "ORIGINAL_CORRECTION")).toMatchObject({ previousDate: "2026-12-31", newDate: "2026-12-01", changedBy: "Test Admin" });
    expect(a.deadline.effectiveDeadline).toBe("2027-02-01");
    expect(a.deadline.extensionDays).toBe(62);
  });
  it("history tables are append-only in the database", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE deadline_changes SET reason = 'tampered'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM action_point_changes`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM system_audit_logs`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM action_points`)).rejects.toThrow(/append-only/);
  });
});

describe("restricted records (IDOR protection)", () => {
  it("restricted items are invisible to non-admins by list, id and export", async () => {
    const a = (await admin.json("GET", `/api/action-points/${byTitle("Staff training plan 2027").id}`)).actionPoint;
    await admin.json("PATCH", `/api/action-points/${a.id}`, { version: a.version, restricted: true });
    expect((await viewer.req("GET", `/api/action-points/${a.id}`)).status).toBe(404);
    expect((await editor.req("GET", `/api/action-points/${a.id}/history`)).status).toBe(404);
    expect((await editor.req("PATCH", `/api/action-points/${a.id}`, { version: a.version + 1, status: "CLOSED" })).status).toBe(404);
    const list = await editor.json("GET", "/api/action-points");
    expect(list.items.find((x: any) => x.id === a.id)).toBeUndefined();
    const x = await editor.exportXlsx({ type: "FULL_TRACKER" });
    const titles = sheetRows(x.wb!.getWorksheet("Action Points")!).map((r) => r["Action points / Project"]);
    expect(titles).not.toContain("Staff training plan 2027");
    expect((await editor.req("PATCH", `/api/action-points/${byTitle("Treasury Audit").id}`, { version: 99, restricted: true })).status).toBeGreaterThanOrEqual(403);
    // un-restrict for the meeting tests
    await admin.json("PATCH", `/api/action-points/${a.id}`, { version: a.version + 1, restricted: false });
  });
});

describe("Sunday meeting", () => {
  let meetingId = "";
  let detail: any;
  it("only organizers can start meetings", async () => {
    expect((await editor.req("POST", "/api/meetings", { meetingDate: "2026-11-22" })).status).toBe(403);
    expect((await viewer.req("POST", "/api/meetings", { meetingDate: "2026-11-22" })).status).toBe(403);
  });
  it("creates a meeting with every In Progress item (audit and non-audit, blank stages)", async () => {
    const ipCount = await prisma.actionPoint.count({ where: { status: "IN_PROGRESS" } });
    const r = await organizer.json("POST", "/api/meetings", { meetingDate: "2026-11-22", attendees: "Head of IA, Auditor A" });
    meetingId = r.meetingId;
    detail = await viewer.json("GET", `/api/meetings/${meetingId}`);
    expect(detail.agenda).toHaveLength(ipCount);
    expect(detail.agenda.some((a: any) => !a.current.currentStage)).toBe(true);
    expect(detail.agenda.map((a: any) => a.current.title)).toContain("Monthly meeting with CFO");
    expect(detail.agenda.map((a: any) => a.position)).toEqual(detail.agenda.map((_: any, i: number) => i + 1));
    expect(detail.counts).toMatchObject({ total: ipCount, reviewed: 0, pending: ipCount });
    expect(detail.permissions.canParticipate).toBe(false); // viewer
  });
  it("prevents duplicate meetings", async () => {
    expect((await organizer.req("POST", "/api/meetings", { meetingDate: "2026-11-22" })).status).toBe(409);
    expect((await admin.req("POST", "/api/meetings", { meetingDate: "2026-11-29" })).status).toBe(409); // a draft is open
  });
  it("Save & Next persists updates, marks reviewed and keeps the snapshot", async () => {
    const item = detail.agenda[0];
    const r = await editor.json("POST", `/api/meetings/${meetingId}/items/${item.id}/save`, {
      version: item.current.version,
      fields: { feedback: "Management responses received; closing.", status: "COMPLETED", nextAction: "Issue final report" },
      markReviewed: true,
    });
    expect(r.actionPoint.status).toBe("COMPLETED");
    expect(r.actionPoint.feedback).toBe("Management responses received; closing.");
    const d = await editor.json("GET", `/api/meetings/${meetingId}`);
    const same = d.agenda.find((a: any) => a.id === item.id);
    expect(same.reviewState).toBe("REVIEWED");
    expect(same.snapshot.status).toBe("IN_PROGRESS"); // snapshot unchanged
    expect(same.current.status).toBe("COMPLETED"); // still visible in this meeting
    expect(same.updates[0].feedback).toBe("Management responses received; closing.");
    expect(d.counts.reviewed).toBe(1);
    const h = await viewer.json("GET", `/api/action-points/${item.current.id}/history`);
    const fb = h.changes.find((c: any) => c.field === "feedback");
    expect(fb.oldValue).toBe(item.current.feedback); // previous feedback preserved
    expect(fb.meeting.id).toBe(meetingId);
  });
  it("detects concurrent edits during the meeting", async () => {
    const item = detail.agenda[0]; // stale version
    const res = await organizer.req("POST", `/api/meetings/${meetingId}/items/${item.id}/save`, { version: item.current.version, fields: { status: "IN_PROGRESS" }, markReviewed: true });
    expect(res.status).toBe(409);
  });
  it("revises a deadline in the meeting, skips an item, saves a draft", async () => {
    const item = detail.agenda[1];
    await organizer.json("POST", `/api/meetings/${meetingId}/items/${item.id}/save`, { version: item.current.version, fields: { revisedTargetDate: "2026-12-20", deadlineReason: "Awaiting walkthroughs" }, markReviewed: false });
    let d = await organizer.json("GET", `/api/meetings/${meetingId}`);
    expect(d.agenda[1].reviewState).toBe("PENDING"); // Save Draft does not mark reviewed
    await organizer.json("POST", `/api/meetings/${meetingId}/items/${detail.agenda[2].id}/review`, { state: "SKIPPED" });
    d = await organizer.json("GET", `/api/meetings/${meetingId}`);
    expect(d.counts).toMatchObject({ reviewed: 1, skipped: 1 });
    expect((await viewer.req("POST", `/api/meetings/${meetingId}/items/${detail.agenda[3].id}/review`, { state: "REVIEWED" })).status).toBe(403);
  });
  it("adds a new action during the meeting (idempotent) and reorders the agenda", async () => {
    const body = { title: "Prepare IA budget 2027", activityTypeId: null, ownerName: "Head of IA", originalTargetDate: "2026-12-15", priority: "MEDIUM", status: "IN_PROGRESS", feedback: "Raised in meeting", includeInAgenda: true, clientRequestId: "req-test-000000001" };
    const a = await editor.json("POST", `/api/meetings/${meetingId}/actions`, body);
    const b = await editor.json("POST", `/api/meetings/${meetingId}/actions`, body);
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.actionPoint.id).toBe(a.actionPoint.id);
    const d = await organizer.json("GET", `/api/meetings/${meetingId}`);
    const last = d.agenda.at(-1);
    expect(last.current.title).toBe("Prepare IA budget 2027");
    expect(last.isNewAction).toBe(true);
    const order = d.agenda.map((x: any) => x.id);
    const reversed = [...order].reverse();
    expect((await editor.req("PUT", `/api/meetings/${meetingId}/agenda`, { itemIds: reversed })).status).toBe(403);
    await organizer.json("PUT", `/api/meetings/${meetingId}/agenda`, { itemIds: reversed });
    const d2 = await organizer.json("GET", `/api/meetings/${meetingId}`);
    expect(d2.agenda[0].id).toBe(order.at(-1));
    await organizer.json("PUT", `/api/meetings/${meetingId}/agenda`, { itemIds: order });
  });
  it("warns about unreviewed items, then finalizes with a stored summary", async () => {
    const res = await organizer.req("POST", `/api/meetings/${meetingId}/finalize`, {});
    expect(res.status).toBe(409);
    expect((await res.json()).requiresConfirmation).toBe(true);
    const r = await organizer.json("POST", `/api/meetings/${meetingId}/finalize`, { confirmUnreviewed: true });
    expect(r.summary.totals.reviewed).toBe(1);
    expect(r.summary.totals.completed).toBe(1);
    expect(r.summary.totals.newActions).toBe(1);
    expect(r.summary.totals.revisedDeadlines).toBe(1);
    expect(r.summary.totals.followUps).toBe(1);
    expect(r.summary.unreviewedItems.length).toBe(r.summary.totals.agendaItems - 1);
    const d = await viewer.json("GET", `/api/meetings/${meetingId}`);
    expect(d.meeting.status).toBe("FINALIZED");
    expect(d.meeting.summary.totals.reviewed).toBe(1);
  });
  it("finalized meetings are immutable; corrections become revisions", async () => {
    const item = detail.agenda[4];
    const cur = (await editor.json("GET", `/api/action-points/${item.current.id}`)).actionPoint;
    expect((await editor.req("POST", `/api/meetings/${meetingId}/items/${item.id}/save`, { version: cur.version, fields: { feedback: "late" }, markReviewed: true })).status).toBe(409);
    await expect(prisma.$executeRawUnsafe(`UPDATE meetings SET attendees = 'x' WHERE id = '${meetingId}'`)).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRawUnsafe(`UPDATE meeting_agenda_items SET position = 99 WHERE "meetingId" = '${meetingId}'`)).rejects.toThrow(/finalized/);
    expect((await editor.req("POST", `/api/meetings/${meetingId}/revisions`, { reason: "Fix attendees", attendees: "Everyone" })).status).toBe(403);
    const d = await admin.json("GET", `/api/meetings/${meetingId}`);
    const upd = d.agenda.flatMap((a: any) => a.updates)[0];
    const r = await admin.json("POST", `/api/meetings/${meetingId}/revisions`, { reason: "Attendee list was incomplete", attendees: "Head of IA, Auditor A, Auditor B", updateCorrections: [{ meetingUpdateId: upd.id, feedback: "Management responses received; report to be issued." }] });
    expect(r.revisionNumber).toBe(1);
    const d2 = await viewer.json("GET", `/api/meetings/${meetingId}`);
    expect(d2.meeting.attendees).toBe("Head of IA, Auditor A"); // original preserved
    expect(d2.meeting.revisions[0].changes).toHaveLength(2);
  });
  it("completed items are excluded from the next meeting's default agenda", async () => {
    const r = await organizer.json("POST", "/api/meetings", { meetingDate: "2026-11-29" });
    const d = await organizer.json("GET", `/api/meetings/${r.meetingId}`);
    expect(d.agenda.map((a: any) => a.current.id)).not.toContain(detail.agenda[0].current.id);
    expect(d.agenda.map((a: any) => a.current.title)).toContain("Prepare IA budget 2027");
    const prev = d.agenda.find((a: any) => a.current.id === detail.agenda[1].current.id);
    expect(prev.previousUpdate.meetingDate).toBe("2026-11-22");
    const list = await viewer.json("GET", "/api/meetings?owner=Head%20of%20IA");
    expect(list.meetings.length).toBe(2);
  });
});

describe("Excel export", () => {
  const meetingDate = "2026-11-22";
  it("viewer cannot export", async () => {
    expect((await viewer.req("POST", "/api/exports", { type: "FULL_TRACKER" })).status).toBe(403);
  });
  it("exports all statuses as a real, formatted .xlsx", async () => {
    const x = await editor.exportXlsx({ type: "FULL_TRACKER", includeUpdateHistory: true, includeDeadlineHistory: true, includeAuditStages: true });
    expect(x.status).toBe(200);
    expect(x.res.headers.get("content-type")).toContain("spreadsheetml");
    expect(x.buf!.subarray(0, 2).toString()).toBe("PK");
    const ws = x.wb!.getWorksheet("Action Points")!;
    expect((ws.getRow(1).values as string[]).slice(1, 11)).toEqual(["SN", "Action points / Project", "Current Stage", "Process Owner", "Targeted Date", "Revised Date", "Delays", "Priority", "Status", "Feedback"]);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(ws.autoFilter).toBeTruthy();
    const rows = sheetRows(ws);
    expect(rows.length).toBe(await prisma.actionPoint.count());
    const inv = rows.find((r) => r["Action points / Project"] === "Inventory Management Audit")!;
    expect((inv["Revised Date"] as Date).toISOString().slice(0, 10)).toBe("2027-02-01");
    expect(x.wb!.worksheets.map((w) => w.name)).toEqual(expect.arrayContaining(["Update History", "Deadline Change History", "Audit Stages", "Report Info"]));
  });
  it.each(["IN_PROGRESS", "COMPLETED", "CLOSED", "ON_HOLD", "NOT_STARTED"])("exports only %s when one status is selected", async (status) => {
    const x = await editor.exportXlsx({ type: "SELECTED_STATUS", status });
    const ws = x.wb!.worksheets[0];
    const expected = await prisma.actionPoint.count({ where: { status: status as any } });
    const label = { IN_PROGRESS: "In Progress", COMPLETED: "Completed", CLOSED: "Closed", ON_HOLD: "On Hold", NOT_STARTED: "Not Started" }[status];
    expect(ws.name).toBe(label);
    const rows = sheetRows(ws);
    if (expected === 0) {
      expect(rows).toHaveLength(1);
      expect(String(rows[0].SN)).toMatch(/No action points/);
    } else {
      expect(rows).toHaveLength(expected);
      expect(rows.every((r) => r.Status === label)).toBe(true);
    }
  });
  it("separates each status into its own worksheet", async () => {
    const x = await editor.exportXlsx({ type: "FULL_TRACKER", separateSheets: true });
    expect(x.wb!.worksheets.map((w) => w.name)).toEqual(["Not Started", "In Progress", "On Hold", "Completed", "Closed", "Report Info"]);
    const ns = sheetRows(x.wb!.getWorksheet("Not Started")!);
    expect(String(ns[0].SN)).toMatch(/No action points/);
  });
  it("admin can export by original imported status (Complete vs Completed)", async () => {
    expect((await editor.req("POST", "/api/exports", { type: "FULL_TRACKER", separateSheets: true, useOriginalStatus: true })).status).toBe(403);
    const x = await admin.exportXlsx({ type: "FULL_TRACKER", separateSheets: true, useOriginalStatus: true });
    const names = x.wb!.worksheets.map((w) => w.name);
    expect(names).toContain("Complete");
    expect(names).toContain("Completed");
  });
  it("neutralises spreadsheet formula injection", async () => {
    await editor.json("POST", "/api/action-points", { title: "=HYPERLINK(\"http://evil.example\",\"click\")", feedback: "+cmd|' /C calc'!A0", status: "NOT_STARTED" });
    const x = await editor.exportXlsx({ type: "SELECTED_STATUS", status: "NOT_STARTED" });
    const row = sheetRows(x.wb!.worksheets[0])[0];
    expect(row["Action points / Project"]).toBe("'=HYPERLINK(\"http://evil.example\",\"click\")");
    expect(row.Feedback).toBe("'+cmd|' /C calc'!A0");
    x.wb!.worksheets[0].eachRow((r) => r.eachCell((c) => expect(c.formula).toBeUndefined()));
  });
  it("exports a historical meeting as recorded", async () => {
    const m = await prisma.meeting.findUniqueOrThrow({ where: { meetingDate: new Date(meetingDate + "T00:00:00Z") } });
    const x = await editor.exportXlsx({ type: "MEETING", meetingId: m.id });
    expect(x.wb!.worksheets.map((w) => w.name)).toEqual(["Meeting Summary", "Agenda (at start)", "Outcome (after meeting)", "Updates Recorded"]);
    const agenda = sheetRows(x.wb!.getWorksheet("Agenda (at start)")!);
    expect(agenda.every((r) => r.Status === "In Progress")).toBe(true); // snapshot, not today's values
    const outcome = sheetRows(x.wb!.getWorksheet("Outcome (after meeting)")!);
    expect(outcome.filter((r) => r.Status === "Completed")).toHaveLength(1);
    const updates = sheetRows(x.wb!.getWorksheet("Updates Recorded")!);
    expect(updates.find((u) => u.Corrected === "Yes")!["Meeting Update / Feedback"]).toBe("Management responses received; report to be issued.");
  });
  it("logs every export", async () => {
    const logs = await prisma.exportLog.count();
    expect(logs).toBeGreaterThanOrEqual(10);
    const audit = await admin.json("GET", "/api/admin/audit-log?action=export");
    expect(audit.logs[0].actorEmail).toBeTruthy();
    const imp = await admin.json("GET", "/api/admin/audit-log?action=import");
    expect(imp.logs.some((l: any) => l.action === "import.commit")).toBe(true);
  });
});
