// A dashboard group the user can fold away. The header shows a one-line
// summary while folded; open/closed is remembered per browser (a per-viewer
// convenience: works without storage, falls back to the default).
import { useId, useState, type ReactNode } from "react";

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`dash-open:${id}`);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export default function Collapsible({ id, title, summary, defaultOpen = true, actions, children }: {
  id: string; title: ReactNode; summary?: ReactNode; defaultOpen?: boolean; actions?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const bodyId = useId();
  function toggle() {
    setOpen((o) => {
      try { localStorage.setItem(`dash-open:${id}`, o ? "0" : "1"); } catch { /* storage blocked */ }
      return !o;
    });
  }
  return (
    <section className={`collapsible${open ? " is-open" : ""}`}>
      <div className="collapsible-head">
        <h2 className="collapsible-title">
          <button type="button" className="collapsible-toggle" onClick={toggle} aria-expanded={open} aria-controls={bodyId}>
            <span className="collapsible-chevron" aria-hidden>{open ? "▾" : "▸"}</span>
            <span>{title}</span>
            {!open && summary && <span className="collapsible-summary">{summary}</span>}
          </button>
        </h2>
        {open && actions && <div className="collapsible-actions">{actions}</div>}
      </div>
      <div id={bodyId} hidden={!open}>{children}</div>
    </section>
  );
}
