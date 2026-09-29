import type { ReactNode } from "react";

export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`screen enter ${className}`}>{children}</section>;
}

export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <footer className="action-bar">
      <div className="action-bar-inner">{children}</div>
    </footer>
  );
}

export function Progress({ value, total }: { value: number; total: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
      <div style={{ width: `${total > 0 ? (value / total) * 100 : 0}%` }} />
    </div>
  );
}

export function Header({ title, subtitle, hero = false }: { title: string; subtitle?: string; hero?: boolean }) {
  return (
    <header className="screen-header">
      <h1 className={hero ? "hero" : "display"}>{title}</h1>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
    </header>
  );
}

export function Skeleton() {
  return (
    <Screen>
      <div className="skeleton" style={{ height: 34, width: "55%" }} />
      <div className="skeleton" style={{ height: 20, width: "80%" }} />
      <div className="skeleton" style={{ height: 132 }} />
      <div className="skeleton" style={{ height: 132 }} />
    </Screen>
  );
}

export function clock(deadline: number, now: number): string {
  const seconds = Math.max(0, Math.round((deadline - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
