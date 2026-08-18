"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/cn";
import { useMounted } from "@/hooks/use-mounted";

export type ToastTone = "neutral" | "success" | "error" | "warning";

export interface ToastOptions {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss. Pass 0 to require manual dismissal. */
  duration?: number;
}

interface ToastRecord extends Required<Omit<ToastOptions, "description">> {
  id: number;
  description?: string;
}

interface ToastApi {
  toast(options: ToastOptions): number;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi>({
  toast: () => -1,
  dismiss: () => {},
});

/** Fire a toast from anywhere under `ToastProvider`. */
export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const DEFAULT_DURATION = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const mounted = useMounted();

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    ({ title, description, tone = "neutral", duration = DEFAULT_DURATION }: ToastOptions) => {
      const id = nextIdRef.current++;

      setToasts((current) => {
        const next = [...current, { id, title, description, tone, duration }];
        // Cap the stack; a wall of toasts communicates nothing.
        return next.slice(-4);
      });

      if (duration > 0) {
        timersRef.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }

      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted
        ? createPortal(
            <div
              // Toasts announce results of the user's own actions, so polite.
              role="region"
              aria-live="polite"
              aria-label="Notifications"
              className="pointer-events-none fixed inset-x-0 bottom-0 z-[110] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end sm:p-6"
            >
              <AnimatePresence initial={false}>
                {toasts.map((item) => (
                  <ToastCard key={item.id} record={item} onDismiss={() => dismiss(item.id)} />
                ))}
              </AnimatePresence>
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}

const TONE_ACCENT: Record<ToastTone, string> = {
  neutral: "bg-ink-tertiary",
  success: "bg-up",
  error: "bg-down",
  warning: "bg-accent",
};

function ToastCard({ record, onDismiss }: { record: ToastRecord; onDismiss: () => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      className="glass pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-sm p-4 pl-5 shadow-xl"
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-0.5", TONE_ACCENT[record.tone])} />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.875rem] font-medium">{record.title}</p>
          {record.description ? (
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-secondary">
              {record.description}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="-mr-1 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-ink-tertiary transition-colors duration-200 hover:text-ink"
        >
          <svg viewBox="0 0 12 12" aria-hidden className="size-3">
            <path
              d="M1.5 1.5l9 9M10.5 1.5l-9 9"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}
