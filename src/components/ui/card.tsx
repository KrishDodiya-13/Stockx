import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Surface primitives.
 *
 * The design language builds panels out of *hairline grids* rather than
 * floating rounded cards — a 1px `bg-line` gap between `bg-base` cells reads as
 * a drawn table, which suits dense financial data far better than shadows.
 */

export function Panel({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article";
}) {
  /*
    Deliberately static on hover.

    Panels are containers, not controls. Making every data panel shift under the
    pointer turns incidental mouse movement into constant motion, which reads as
    gimmickry rather than polish. Depth here comes from the hairline grid; the
    `lift` utility is reserved for cards that are genuinely interactive.
  */
  return <Tag className={cn("border border-line bg-base", className)}>{children}</Tag>;
}

export function PanelHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4 md:px-6",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-medium tracking-[-0.01em]">{title}</h2>
        {description ? (
          <p className="mt-1.5 text-[0.8125rem] text-ink-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 py-5 md:px-6", className)}>{children}</div>;
}

/**
 * A hairline grid of cells. Children become the cells; the 1px gaps are the
 * rules. Pass `columns` to control the desktop track count.
 */
export function CellGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-px border border-line bg-line",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bg-base p-5 md:p-6", className)}>{children}</div>;
}
