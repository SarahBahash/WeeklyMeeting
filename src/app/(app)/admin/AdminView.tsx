"use client";
import { useState } from "react";
import { PageHeader, Tabs } from "@/components/ui";
import { UsersPanel } from "./UsersPanel";
import { ImportPanel } from "./ImportPanel";
import { LegacyPanel } from "./LegacyPanel";
import { AuditLogPanel, ActivityTypesPanel } from "./MiscPanels";

type Tab = "import" | "legacy" | "users" | "types" | "audit";

export function AdminView() {
  const [tab, setTab] = useState<Tab>("import");
  return (
    <div>
      <PageHeader title="Administration" description="Data migration, users and permissions, reference data and the system audit log. Administrators only." />
      <Tabs value={tab} onChange={setTab} tabs={[
        { id: "import", label: "Import Data" },
        { id: "legacy", label: "Historical Records" },
        { id: "users", label: "Users & Roles" },
        { id: "types", label: "Activity Types" },
        { id: "audit", label: "System Audit Log" },
      ]} />
      {tab === "import" && <ImportPanel onGoLegacy={() => setTab("legacy")} />}
      {tab === "legacy" && <LegacyPanel />}
      {tab === "users" && <UsersPanel />}
      {tab === "types" && <ActivityTypesPanel />}
      {tab === "audit" && <AuditLogPanel />}
    </div>
  );
}
