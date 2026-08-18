"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useCommandPalette } from "@/components/command/command-palette-provider";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/cn";
import {
  IDLE_CHORD,
  SHORTCUTS,
  SHORTCUT_ROUTES,
  matchShortcut,
  renderKeys,
  shouldIgnoreTarget,
  type ChordState,
} from "@/lib/shortcuts";

/**
 * The global keyboard layer.
 *
 * Every binding in the application is registered here, in one place, so two
 * features cannot silently claim the same key. Matching itself lives in
 * `lib/shortcuts.ts` and is unit-tested; this component only binds it to the
 * document and performs the resulting action.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const { open, isOpen, toggle } = useCommandPalette();
  const [helpOpen, setHelpOpen] = useState(false);
  const chordRef = useRef<ChordState>(IDLE_CHORD);
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Never steal a key from a field the user is typing into.
      if (shouldIgnoreTarget(event.target, event)) return;

      const result = matchShortcut(event, chordRef.current, Date.now());

      if (result.kind === "armed") {
        event.preventDefault();
        chordRef.current = result.state;
        setArmed(result.state.prefix);
        return;
      }

      // Any resolved key ends the chord, matched or not.
      chordRef.current = IDLE_CHORD;
      setArmed(null);

      if (result.kind !== "match") return;

      /*
        While the palette is open it owns the keyboard: its own handler runs
        arrows, Enter and Escape. Only the palette toggle is honoured here.
      */
      if (isOpen && result.id !== "palette") return;

      const route = SHORTCUT_ROUTES[result.id];
      if (route) {
        event.preventDefault();
        router.push(route);
        return;
      }

      switch (result.id) {
        case "palette":
          event.preventDefault();
          toggle();
          break;
        case "help":
          event.preventDefault();
          setHelpOpen((current) => !current);
          break;
        case "search":
          event.preventDefault();
          open({ kind: "search" });
          break;
        case "buy":
          event.preventDefault();
          open({ kind: "order", side: "BUY" });
          break;
        case "sell":
          event.preventDefault();
          open({ kind: "order", side: "SELL" });
          break;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, open, toggle, isOpen]);

  // Let an armed chord lapse visibly rather than lingering.
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), 1200);
    return () => window.clearTimeout(timer);
  }, [armed]);

  return (
    <>
      <ChordIndicator prefix={armed} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  );
}

/**
 * Shows the armed prefix while a chord is pending.
 *
 * Without it, pressing `g` appears to do nothing and the user cannot tell the
 * application is waiting for a second key.
 */
function ChordIndicator({ prefix }: { prefix: string | null }) {
  return (
    <AnimatePresence>
      {prefix ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
          className="glass pointer-events-none fixed bottom-6 left-1/2 z-[130] -translate-x-1/2 rounded-full px-4 py-2"
        >
          <span className="flex items-center gap-2 text-[0.75rem] text-ink-secondary">
            <kbd className="rounded-[3px] border border-line px-1.5 py-0.5 text-[0.6875rem]">
              {prefix.toUpperCase()}
            </kbd>
            waiting for the next key…
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const mounted = useMounted();
  const isMac = mounted && /Mac|iPhone|iPad/.test(navigator.platform);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const groups = ["General", "Navigate", "Trade"] as const;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[125] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-inverse/45 backdrop-blur-[2px]"
            aria-hidden
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            initial={{ opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-2xl overflow-hidden rounded-sm border border-line bg-base shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-line px-6 py-4">
              <h2 className="text-[0.9375rem] font-medium">Keyboard shortcuts</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="text-[0.6875rem] text-ink-tertiary hover:text-ink"
              >
                ESC
              </button>
            </header>

            <div className="grid gap-px bg-line sm:grid-cols-3">
              {groups.map((group) => (
                <div key={group} className="bg-base px-5 py-5">
                  <p className="eyebrow">{group}</p>
                  <ul className="mt-4 space-y-2.5">
                    {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                      <li key={shortcut.id} className="flex items-center justify-between gap-3">
                        <span className="text-[0.8125rem] text-ink-secondary">
                          {shortcut.label}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {renderKeys(shortcut.keys, isMac).map((part, index) => (
                            <kbd
                              key={index}
                              className={cn(
                                "tabular rounded-[3px] border border-line px-1.5 py-0.5",
                                "text-[0.625rem] text-ink-tertiary",
                              )}
                            >
                              {part}
                            </kbd>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <p className="border-t border-line px-6 py-3 text-[0.6875rem] text-ink-tertiary">
              Two-key shortcuts are pressed in sequence, not together — press{" "}
              <kbd className="rounded-[3px] border border-line px-1 py-0.5">G</kbd> then{" "}
              <kbd className="rounded-[3px] border border-line px-1 py-0.5">D</kbd>. Shortcuts are
              inactive while you are typing in a field.
            </p>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
