import { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-gradient">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-muted-foreground max-w-xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div className={`surface-card surface-glow ${padded ? "p-5" : ""} ${className}`}>{children}</div>
  );
}

export function Stat({
  label,
  value,
  hint,
  trend,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: { value: string; up?: boolean };
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        {trend && (
          <span
            className={`text-[11px] rounded-md px-1.5 py-0.5 border ${
              trend.up
                ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10"
                : "border-border text-muted-foreground bg-surface-2"
            }`}
          >
            {trend.up ? "↑" : "↓"} {trend.value}
          </span>
        )}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" }) {
  const styles = {
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    ghost: "text-foreground hover:bg-surface-2",
    outline: "border border-border text-foreground hover:bg-surface-2",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors ${styles} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
