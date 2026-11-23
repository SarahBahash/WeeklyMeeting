"use client";
import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Inbox, Loader2, X } from "lucide-react";
import { STATUS_LABEL, PRIORITY_LABEL, type Status, type Priority } from "@/lib/domain";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }, ref) {
    const base = "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
    const sizes = { sm: "px-2.5 py-1.5 text-xs", md: "px-3.5 py-2 text-sm", lg: "px-5 py-2.5 text-base" };
    const variants: Record<Variant, string> = {
      primary: "bg-brand text-white hover:bg-brand-dark",
      secondary: "border border-line bg-white text-navy hover:bg-navy-50",
      ghost: "text-navy hover:bg-navy-50",
      danger: "border border-danger/30 bg-white text-danger hover:bg-danger-light",
    };
    return (
      <button ref={ref} className={cx(base, sizes[size], variants[variant], className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
        {children}
      </button>
    );
  },
);

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("card shadow-card", className)}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-navy">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STATUS_STYLE: Record<Status, string> = {
  NOT_STARTED: "border-line bg-white text-muted",
  IN_PROGRESS: "border-brand/30 bg-brand-light text-brand-dark",
  ON_HOLD: "border-warn/30 bg-warn-light text-warn",
  COMPLETED: "border-navy/20 bg-navy-50 text-navy",
  CLOSED: "border-line bg-navy-50 text-muted",
};
export function StatusBadge({ status }: { status: Status }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>;
}
export function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority) return <span className="text-xs text-muted">—</span>;
  const s = { HIGH: "text-danger", MEDIUM: "text-warn", LOW: "text-muted" }[priority];
  return <span className={cx("inline-flex items-center gap-1 text-xs font-semibold", s)}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{PRIORITY_LABEL[priority]}</span>;
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "navy" }) {
  const t = { neutral: "border-line text-muted", green: "border-brand/30 bg-brand-light text-brand-dark", amber: "border-warn/30 bg-warn-light text-warn", red: "border-danger/30 bg-danger-light text-danger", navy: "border-navy/20 bg-navy-50 text-navy" }[tone];
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

export function Field({ label, htmlFor, hint, error, children, className }: { label: string; htmlFor?: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted" role="status">
      <Loader2 className="h-5 w-5 animate-spin text-brand" aria-hidden /> {label}
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="text-muted">{icon ?? <Inbox className="h-8 w-8" aria-hidden />}</div>
      <p className="font-medium text-navy">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Alert({ tone = "error", children, onClose }: { tone?: "error" | "success" | "warning" | "info"; children: ReactNode; onClose?: () => void }) {
  const t = {
    error: "border-danger/30 bg-danger-light text-danger",
    success: "border-brand/30 bg-brand-light text-brand-dark",
    warning: "border-warn/30 bg-warn-light text-warn",
    info: "border-line bg-navy-50 text-navy",
  }[tone];
  const Icon = tone === "success" ? CheckCircle2 : AlertCircle;
  return (
    <div className={cx("flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm", t)} role={tone === "error" ? "alert" : "status"}>
      <Icon className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
      <div className="flex-1">{children}</div>
      {onClose && <button onClick={onClose} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const w = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose(); }} className={cx("w-[95vw] rounded-xl border border-line bg-white p-0 text-navy shadow-xl", w)} aria-labelledby="modal-title">
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 id="modal-title" className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-muted hover:bg-navy-50" aria-label="Close"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = "Confirm", danger, loading, onConfirm, onCancel }: { open: boolean; title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm" footer={<>
      <Button onClick={onCancel}>Cancel</Button>
      <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button>
    </>}>
      <div className="text-sm text-navy">{children}</div>
    </Modal>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-5 flex gap-1 border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx("-mb-px border-b-2 px-4 py-2 text-sm font-medium", value === t.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-navy")}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
