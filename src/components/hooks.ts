"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client";

export interface Meta {
  today: string;
  activityTypes: { id: string; code: string; name: string; supportsStages: boolean; isActive: boolean }[];
  projects: { id: string; name: string; isAudit: boolean; stages: { id: string; name: string }[] }[];
  owners: string[];
  stages: string[];
  draftMeeting: { id: string; meetingDate: string } | null;
}

export function useMeta() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const reload = useCallback(() => api<Meta>("/api/meta").then(setMeta).catch(() => undefined), []);
  useEffect(() => { reload(); }, [reload]);
  return { meta, reload };
}

/** Generic loader with loading/error state. */
export function useLoad<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(url));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => { reload(); }, [reload]);
  return { data, setData, error, loading, reload };
}

/** Warn before leaving the page with unsaved changes. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}
