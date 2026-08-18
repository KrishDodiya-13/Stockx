"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/** What the palette should show when it opens. */
export type PaletteIntent =
  | { kind: "root" }
  /** Jump straight to instrument selection for an order. */
  | { kind: "order"; side: "BUY" | "SELL" }
  /** Open with the symbol search already active. */
  | { kind: "search" };

interface CommandPaletteApi {
  readonly isOpen: boolean;
  readonly intent: PaletteIntent;
  open(intent?: PaletteIntent): void;
  close(): void;
  toggle(): void;
}

const CommandPaletteContext = createContext<CommandPaletteApi>({
  isOpen: false,
  intent: { kind: "root" },
  open: () => {},
  close: () => {},
  toggle: () => {},
});

export function useCommandPalette(): CommandPaletteApi {
  return useContext(CommandPaletteContext);
}

/**
 * Open/close state, split from the palette itself so the sidebar and topbar
 * can trigger it without importing the (heavier) palette component.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [intent, setIntent] = useState<PaletteIntent>({ kind: "root" });

  const open = useCallback((next: PaletteIntent = { kind: "root" }) => {
    setIntent(next);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  const toggle = useCallback(() => {
    setIsOpen((current) => {
      // Reopening always starts from the root, so a previous order flow never
      // reappears unexpectedly.
      if (!current) setIntent({ kind: "root" });
      return !current;
    });
  }, []);

  const api = useMemo<CommandPaletteApi>(
    () => ({ isOpen, intent, open, close, toggle }),
    [isOpen, intent, open, close, toggle],
  );

  return <CommandPaletteContext.Provider value={api}>{children}</CommandPaletteContext.Provider>;
}
