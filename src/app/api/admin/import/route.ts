import { apiRoute } from "@/lib/api";
import { badRequest, ApiError } from "@/lib/errors";
import { config } from "@/lib/config";
import { createPreview, listBatches, previewOptionsSchema } from "@/lib/import/service";

export const GET = apiRoute({ permissions: ["admin:import"] }, async ({ user }) => ({ batches: await listBatches(user) }));

/** Upload a workbook and build a preview. Nothing is written to the tracker until the admin confirms. */
export const POST = apiRoute(
  { permissions: ["admin:import"], rateLimit: { key: "import", limit: 20, windowMs: 60_000 } },
  async ({ req, user, ip }) => {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > config.maxUploadBytes + 64 * 1024) throw new ApiError(413, "The file is too large.");
    const form = await req.formData().catch(() => null);
    if (!form) throw badRequest("Expected a file upload.");
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Choose an .xlsx file to upload.");
    if (file.size > config.maxUploadBytes) throw new ApiError(413, "The file is too large.");
    const opts = previewOptionsSchema.parse({
      kind: form.get("kind"),
      sheetName: (form.get("sheetName") as string | null) || undefined,
      mapping: form.get("mapping") ? JSON.parse(String(form.get("mapping"))) : undefined,
    });
    const buffer = Buffer.from(await file.arrayBuffer());
    return createPreview(user, { name: file.name, buffer }, opts, ip);
  },
);
