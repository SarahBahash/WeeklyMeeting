"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/components/auth-context";
import { useMeta } from "@/components/hooks";
import { ActionPointTable, EMPTY_FILTERS, type Filters } from "@/components/ActionPointTable";
import { ActionPointForm } from "@/components/ActionPointForm";
import { Button, PageHeader } from "@/components/ui";
import { useToast } from "@/components/toast";

export function AllActionPoints() {
  const { can } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { meta, reload } = useMeta();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div>
      <PageHeader
        title="All Action Points"
        description="Audit reviews, management meetings, general tasks and other activities. Use Edit for quick changes; open an item for its full history."
        actions={can("actionPoint:write") && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New action point</Button>}
      />
      <ActionPointTable meta={meta} filters={filters} setFilters={setFilters} reloadKey={reloadKey} onChanged={reload} />
      <ActionPointForm open={creating} meta={meta} onClose={() => setCreating(false)} onSaved={(dto) => {
        setCreating(false);
        setReloadKey((k) => k + 1);
        reload();
        toast("success", "Action point created");
        router.prefetch(`/action-points/${dto.id}`);
      }} />
    </div>
  );
}
