"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { useMounted } from "@/hooks/use-mounted";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** `md` for forms, `lg` for data-heavy panels like a trade ticket. */
  size?: "sm" | "md" | "lg";
  /** Hide the visible title when the content supplies its own heading. */
  hideTitle?: boolean;
}

/**
 * Dialog.
 *
 * Handles the parts that are easy to leave out and expensive to omit: Escape
 * closes, the background is inert to scroll, focus is trapped inside while
 * open and restored to the trigger on close.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  hideTitle = false,
}: ModalProps) {
  const mounted = useMounted();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  // Unique per instance — a fixed id would collide if two dialogs ever mount.
  const descriptionId = useId();

  const onKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      // Wrap focus rather than letting it escape to the page behind.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  /*
    Focus ownership and scroll lock depend on `open` alone.

    These were once combined with the keydown listener below, but `onKeyDown`
    changes identity whenever the caller passes an inline `onClose` — so the
    effect re-ran on every parent render and its cleanup yanked focus back to
    the trigger while the dialog was still open. Keeping the two effects
    separate means focus is captured once on open and restored once on close.
  */
  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Move focus in on the next frame, once the panel has rendered.
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      const target = panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      target?.focus();
    });

    return () => {
      document.body.style.overflow = overflow;
      cancelAnimationFrame(frame);
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onKeyDown]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            className="absolute inset-0 bg-inverse/45 backdrop-blur-[2px]"
            aria-hidden
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.99 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "relative w-full border border-line bg-base shadow-2xl",
              "max-h-[90svh] overflow-y-auto rounded-t-lg sm:rounded-sm",
              size === "sm" && "sm:max-w-md",
              size === "md" && "sm:max-w-lg",
              size === "lg" && "sm:max-w-2xl",
            )}
          >
            <header className="flex items-start justify-between gap-6 border-b border-line px-6 py-5">
              <div className={cn("min-w-0", hideTitle && "sr-only")}>
                <h2 className="text-base font-medium tracking-[-0.01em]">{title}</h2>
                {description ? (
                  <p id={descriptionId} className="mt-1.5 text-[0.8125rem] text-ink-secondary">
                    {description}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="-mr-1.5 -mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors duration-200 hover:text-ink"
              >
                <svg viewBox="0 0 14 14" aria-hidden className="size-3.5">
                  <path
                    d="M1.5 1.5l11 11M12.5 1.5l-11 11"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </header>

            <div className="px-6 py-6">{children}</div>

            {footer ? (
              <footer className="flex flex-wrap justify-end gap-3 border-t border-line px-6 py-4">
                {footer}
              </footer>
            ) : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
