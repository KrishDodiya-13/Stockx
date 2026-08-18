"use client";

import { motion } from "framer-motion";
import { useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface TabItem<T extends string = string> {
  readonly value: T;
  readonly label: string;
  /** Optional trailing count, e.g. the number of open positions. */
  readonly count?: number;
}

interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  /** `line` for page-level sections, `segment` for compact in-panel switches. */
  variant?: "line" | "segment";
  children?: ReactNode;
}

/**
 * Tabs with a shared layout indicator.
 *
 * The underline is a single `layoutId` element, so it slides between tabs
 * instead of cross-fading — the movement is what communicates that these are
 * views of one thing rather than separate destinations.
 *
 * Arrow keys move between tabs per the WAI-ARIA tabs pattern; only the active
 * tab is in the page tab order.
 */
export function Tabs<T extends string>({
  items,
  value,
  onValueChange,
  className,
  variant = "line",
  children,
}: TabsProps<T>) {
  const groupId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const currentIndex = items.findIndex((item) => item.value === value);
    if (currentIndex < 0) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;

    if (nextIndex === null) return;
    event.preventDefault();

    const next = items[nextIndex];
    if (!next) return;
    onValueChange(next.value);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab="${next.value}"]`)
      ?.focus();
  };

  return (
    <div className={className}>
      <div
        ref={listRef}
        role="tablist"
        onKeyDown={onKeyDown}
        className={cn(
          "flex items-center overflow-x-auto",
          variant === "line" && "gap-7 border-b border-line",
          variant === "segment" && "gap-1 rounded-full border border-line p-1",
        )}
      >
        {items.map((item) => {
          const active = item.value === value;

          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              data-tab={item.value}
              aria-selected={active}
              aria-controls={`${groupId}-${item.value}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onValueChange(item.value)}
              className={cn(
                "relative shrink-0 whitespace-nowrap transition-colors duration-300",
                variant === "line" && "py-3.5 text-[0.875rem]",
                variant === "segment" && "rounded-full px-3.5 py-1.5 text-[0.8125rem]",
                active ? "text-ink" : "text-ink-tertiary hover:text-ink-secondary",
              )}
            >
              {variant === "segment" && active ? (
                <motion.span
                  layoutId={`${groupId}-segment`}
                  className="absolute inset-0 rounded-full bg-ink/8"
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                />
              ) : null}

              <span className="relative flex items-center gap-2">
                {item.label}
                {typeof item.count === "number" ? (
                  <span className="tabular text-[0.6875rem] text-ink-tertiary">{item.count}</span>
                ) : null}
              </span>

              {variant === "line" && active ? (
                <motion.span
                  layoutId={`${groupId}-underline`}
                  className="absolute inset-x-0 -bottom-px h-px bg-ink"
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      {children ? (
        <div role="tabpanel" id={`${groupId}-${value}`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
