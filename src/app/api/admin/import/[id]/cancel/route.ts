import { apiRoute } from "@/lib/api";
import { cancelBatch } from "@/lib/import/service";

type P = { id: string };
export const POST = apiRoute<P>({ permissions: ["admin:import"] }, async ({ user, params, ip }) => cancelBatch(user, params.id, ip));
