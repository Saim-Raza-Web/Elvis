import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
}

const widthMap = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-2xl" };

export function Modal({ open, onClose, title, subtitle, children, footer, width = "md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className={`relative w-full ${widthMap[width]} bg-card border border-border rounded-2xl shadow-2xl animate-pop-in`}>
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4 border-b border-border">
          <div>
            <h2 className="font-bold text-lg leading-tight">{title}</h2>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="ml-4 p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-secondary/30 rounded-b-2xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Form helpers ── */
interface FieldProps { label: string; required?: boolean; children: ReactNode; hint?: string }
export function Field({ label, required, children, hint }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-semibold text-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export function Input(props: InputProps) {
  return (
    <input
      {...props}
      className={`w-full px-3 py-2.5 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 transition-all text-sm placeholder:text-muted-foreground ${props.className ?? ""}`}
    />
  );
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> { children: ReactNode }
export function Select({ children, ...props }: SelectProps) {
  return (
    <select
      {...props}
      className={`w-full px-3 py-2.5 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/60 transition-all text-sm ${props.className ?? ""}`}
    >
      {children}
    </select>
  );
}

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
export function Textarea(props: TextareaProps) {
  return (
    <textarea
      {...props}
      rows={props.rows ?? 3}
      className={`w-full px-3 py-2.5 rounded-lg border border-border bg-secondary/50 outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/10 transition-all text-sm placeholder:text-muted-foreground resize-none ${props.className ?? ""}`}
    />
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

export function ModalCancel({ onClose }: { onClose: () => void }) {
  return (
    <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-secondary transition-colors">
      Cancel
    </button>
  );
}

export function ModalSubmit({ children, onClick, variant = "primary" }: { children: ReactNode; onClick?: () => void; variant?: "primary" | "success" | "destructive" }) {
  const cls = variant === "success" ? "bg-success text-white hover:opacity-90" : variant === "destructive" ? "bg-destructive text-white hover:opacity-90" : "bg-primary text-primary-foreground hover:opacity-90";
  return (
    <button onClick={onClick} className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${cls}`}>
      {children}
    </button>
  );
}
