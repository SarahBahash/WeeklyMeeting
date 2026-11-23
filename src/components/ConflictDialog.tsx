"use client";
import type { ActionPointDTO } from "@/lib/services/action-points";
import { Button, Modal } from "./ui";
import { formatDateTime } from "@/lib/dates";

/** Shown when a save is rejected because someone else changed the record (optimistic concurrency). */
export function ConflictDialog({ open, current, mine, onReload, onReapply, onClose }: {
  open: boolean;
  current: ActionPointDTO | null;
  mine: Record<string, unknown>;
  onReload: () => void;
  onReapply: () => void;
  onClose: () => void;
}) {
  const keys = Object.keys(mine).filter((k) => !["version", "deadlineReason"].includes(k));
  return (
    <Modal open={open} onClose={onClose} title="This item was changed by someone else" size="lg" footer={<>
      <Button onClick={onReload}>Discard my changes and reload</Button>
      <Button variant="primary" onClick={onReapply}>Apply my changes to the latest version</Button>
    </>}>
      {current && (
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            <strong className="text-navy">{current.updatedBy ?? "Another user"}</strong> saved changes at {formatDateTime(current.updatedAt)} while you were editing.
            Your changes have <strong>not</strong> been saved. Review the differences below.
          </p>
          <table className="w-full border border-line text-sm">
            <thead><tr><th className="th">Field</th><th className="th">Latest saved value</th><th className="th">Your value</th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k}>
                  <td className="td font-medium">{k}</td>
                  <td className="td text-muted">{String((current as unknown as Record<string, unknown>)[k] ?? "—")}</td>
                  <td className="td">{String(mine[k] ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
