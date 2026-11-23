/* Loads the SYNTHETIC sample workbook into an EMPTY database through the real import
 * workflow (preview → commit), for test/demo deployments only (DEMO_MODE=true).
 * Run with: npm run demo:data   (idempotent – does nothing if action points already exist). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { commitBatch, createPreview } from "../src/lib/import/service";

async function main() {
  if (process.env.DEMO_MODE !== "true") {
    console.log("demo-data: DEMO_MODE is not enabled – skipped.");
    return;
  }
  if ((await prisma.actionPoint.count()) > 0) {
    console.log("demo-data: database already contains action points – skipped.");
    return;
  }
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" } });
  if (!admin) {
    console.log("demo-data: no administrator account exists yet – skipped.");
    return;
  }
  const user = { id: admin.id, email: admin.email, name: admin.name, role: admin.role, canOrganizeMeetings: admin.canOrganizeMeetings };
  const file = path.resolve(__dirname, "../samples/SYNTHETIC-IA-Weekly-Meeting-Action-points.xlsx");
  const buffer = readFileSync(file);
  for (const kind of ["MAIN_TRACKER", "HISTORICAL"] as const) {
    const preview = await createPreview(user, { name: path.basename(file), buffer }, { kind }, null);
    const result = await commitBatch(user, preview.batchId, { decisions: {} }, null);
    console.log(`demo-data: ${kind} imported`, JSON.stringify(result.summary));
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("demo-data failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
