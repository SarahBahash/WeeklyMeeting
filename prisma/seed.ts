/* Seeds reference data (activity types, default audit-stage template) and, for local
 * development only, synthetic test users. Never seeds business records. Idempotent. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const ACTIVITY_TYPES = [
  { code: "AUDIT_REVIEW", name: "Audit Review", supportsStages: true, sortOrder: 1 },
  { code: "MANAGEMENT_MEETING", name: "Management Meeting", supportsStages: false, sortOrder: 2 },
  { code: "GENERAL_TASK", name: "General Task", supportsStages: false, sortOrder: 3 },
  { code: "OTHER", name: "Other Activity", supportsStages: false, sortOrder: 4 },
];

// Audit lifecycle from the tracker's Sheet1 (Accounts Receivable example) – configurable template.
const DEFAULT_TEMPLATE = [
  { part: 1, partName: "Planning and Understanding", stages: ["Scope Discussion", "Announcement Letter", "Kickoff Meeting & MOM", "Understanding Meetings", "PUD", "PUD Confirmation", "LOR", "RCM", "Discussion Meeting with SDR & DM"] },
  { part: 2, partName: "Initial Findings", stages: ["LOIF", "LOIF Validation with Process Owner"] },
  { part: 3, partName: "Reporting", stages: ["Draft Report", "Closing Meeting", "Report Issuance"] },
];

async function main() {
  for (const t of ACTIVITY_TYPES) {
    await prisma.activityType.upsert({ where: { code: t.code }, update: {}, create: t });
  }
  const name = "Standard Audit Lifecycle (14 steps)";
  if (!(await prisma.auditStageTemplate.findUnique({ where: { name } }))) {
    let order = 0;
    await prisma.auditStageTemplate.create({
      data: {
        name,
        isDefault: true,
        description: "Derived from the Accounts Receivable example in the tracker's Sheet1. Edit or extend per audit.",
        sourceNote: "Seeded default",
        stages: { create: DEFAULT_TEMPLATE.flatMap((p) => p.stages.map((s) => ({ partNumber: p.part, partName: p.partName, name: s, sortOrder: ++order }))) },
      },
    });
  }

  const isProd = process.env.NODE_ENV === "production";
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail) {
    // Production bootstrap: first administrator signs in through SSO (no password stored).
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: { email: adminEmail, name: process.env.SEED_ADMIN_NAME ?? "System Administrator", role: "ADMIN", canOrganizeMeetings: true },
    });
    console.log(`Bootstrap administrator ensured: ${adminEmail}`);
  }

  if (!isProd && process.env.AUTH_LOCAL_ENABLED === "true") {
    const password = process.env.SEED_DEV_PASSWORD || randomBytes(12).toString("base64url");
    const hash = await bcrypt.hash(password, 12);
    const users = [
      { email: "admin@example.test", name: "Test Admin", role: "ADMIN" as const, canOrganizeMeetings: true },
      { email: "organizer@example.test", name: "Test Organizer", role: "EDITOR" as const, canOrganizeMeetings: true },
      { email: "editor@example.test", name: "Test Editor", role: "EDITOR" as const, canOrganizeMeetings: false },
      { email: "viewer@example.test", name: "Test Viewer", role: "VIEWER" as const, canOrganizeMeetings: false },
    ];
    for (const u of users) {
      await prisma.user.upsert({ where: { email: u.email }, update: { passwordHash: hash }, create: { ...u, passwordHash: hash } });
    }
    console.log("Synthetic development users (local sign-in, development only):");
    for (const u of users) console.log(`  ${u.role.padEnd(6)} ${u.email}${u.canOrganizeMeetings ? " (meeting organizer)" : ""}`);
    console.log(`  Password: ${process.env.SEED_DEV_PASSWORD ? "(value of SEED_DEV_PASSWORD)" : password}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
