import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Standard page heading.
 *
 * Consistent across every terminal screen so the eye always finds the title,
 * the context line and the primary action in the same place.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-6 border-b border-line-subtle pb-8",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-4">{eyebrow}</p> : null}
        <h1 className="text-display-m">{title}</h1>
        {description ? (
          <p className="mt-4 max-w-xl text-[0.9375rem] leading-relaxed text-ink-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/** Consistent page padding for every screen inside the shell. */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("px-4 py-8 md:px-6 md:py-10 xl:px-10", className)}>{children}</div>;
}
