"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useCommandPalette } from "@/components/command/command-palette-provider";
import { OrderFlow } from "@/components/command/order-flow";
import type { Instrument } from "@/domain/market";
import { GROUP_ORDER, filterCommands, type Command, type CommandGroup } from "@/components/command/commands";
import { NavIcon } from "@/components/layout/nav-icon";
import { useTheme } from "@/components/providers/theme-provider";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/cn";
import { stockRoute } from "@/lib/routes";
import { EQUITY_INSTRUMENTS } from "@/services/market-data";

const MAX_SYMBOL_RESULTS = 5;

/**
 * Command palette (⌘K / Ctrl+K).
 *
 * Two result sources: the static command registry, and a live symbol search so
 * "reli" reaches RELIANCE directly. Navigation is entirely keyboard-driven —
 * arrows move, Enter runs, Escape closes — and the list scrolls the active row
 * into view so keyboard and viewport never disagree.
 */
/**
 * What the palette is currently doing.
 *
 * `pickInstrument` and `order` are the two stages that make a command *execute*
 * rather than navigate: choosing a symbol, then a quantity, then placing a real
 * paper order through the same API the ticket uses.
 */
type Stage =
  | { kind: "root" }
  | { kind: "pickInstrument"; side: "BUY" | "SELL" }
  | { kind: "order"; side: "BUY" | "SELL"; instrument: Instrument };

export function CommandPalette() {
  const { isOpen, intent, close } = useCommandPalette();
  const mounted = useMounted();
  const router = useRouter();
  const { toggleTheme } = useTheme();

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [stage, setStage] = useState<Stage>({ kind: "root" });
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /*
    The ⌘K binding lives in the global shortcut layer, not here — one place
    owns every key, so bindings cannot silently conflict.
  */

  // Reset between openings — a stale query is never what the user wants next.
  useEffect(() => {
    if (!isOpen) return;

    setQuery("");
    setActiveIndex(0);
    setStage(
      intent.kind === "order" ? { kind: "pickInstrument", side: intent.side } : { kind: "root" },
    );

    const frame = requestAnimationFrame(() => inputRef.current?.focus());

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = overflow;
    };
  }, [isOpen, intent]);

  const picking = stage.kind === "pickInstrument";

  const commands = useMemo(
    // While choosing an instrument, commands are irrelevant noise.
    () => (picking ? [] : filterCommands(query)),
    [query, picking],
  );

  const symbols = useMemo(() => {
    const needle = query.trim().toLowerCase();

    // Instrument selection lists everything until narrowed; root search waits
    // for at least one character so the palette does not open full of symbols.
    if (!picking && needle.length < 1) return [];

    /*
      Equities only.

      Every symbol row here either opens a trade ticket or navigates to one, so
      an index in this list is a route to a BUY button for something that
      cannot be bought. Indices are reachable through the market pages instead.
    */
    const matches = EQUITY_INSTRUMENTS.filter(
      (instrument) =>
        needle.length === 0 ||
        instrument.symbol.toLowerCase().includes(needle) ||
        instrument.name.toLowerCase().includes(needle),
    );

    return matches.slice(0, picking ? 40 : MAX_SYMBOL_RESULTS);
  }, [query, picking]);

  /** One flat list so arrow keys traverse commands and symbols uniformly. */
  const rows = useMemo(
    () => [
      ...commands.map((command) => ({ kind: "command" as const, command })),
      ...symbols.map((instrument) => ({ kind: "symbol" as const, instrument })),
    ],
    [commands, symbols],
  );

  useEffect(() => setActiveIndex(0), [query, stage.kind]);

  const run = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return;

      if (row.kind === "symbol") {
        // Mid-order, choosing a symbol advances the flow instead of navigating.
        if (stage.kind === "pickInstrument") {
          setStage({ kind: "order", side: stage.side, instrument: row.instrument });
          setQuery("");
          return;
        }

        close();
        router.push(stockRoute(row.instrument.symbol));
        return;
      }

      const command: Command = row.command;

      if (command.action === "toggle-theme") {
        toggleTheme();
        close();
        return;
      }

      // Trade commands execute in place rather than navigating away — this is
      // what makes the palette a terminal rather than a menu.
      if (command.action === "buy" || command.action === "sell") {
        setStage({ kind: "pickInstrument", side: command.action === "buy" ? "BUY" : "SELL" });
        setQuery("");
        return;
      }

      if (command.href) {
        close();
        router.push(command.href);
      }
    },
    [rows, close, router, toggleTheme, stage],
  );

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (rows.length === 0 ? 0 : (index + 1) % rows.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (rows.length === 0 ? 0 : (index - 1 + rows.length) % rows.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(activeIndex);
    } else if (event.key === "Escape") {
      event.preventDefault();
      // Escape steps back through the flow before it closes the palette, so a
      // mistaken "Buy" does not throw away the whole session.
      if (stage.kind === "pickInstrument") setStage({ kind: "root" });
      else close();
    }
  };

  // Keep the highlighted row visible when it moves off-screen.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-row="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  if (!mounted) return null;

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    entries: commands
      .map((command, index) => ({ command, index }))
      .filter((entry) => entry.command.group === group),
  })).filter((section) => section.entries.length > 0);

  return createPortal(
    <AnimatePresence>
      {isOpen ? (
        <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 pt-[12vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            className="absolute inset-0 bg-inverse/40 backdrop-blur-[3px]"
            aria-hidden
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: -12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-xl overflow-hidden rounded-sm border border-line bg-base shadow-2xl"
          >
            {stage.kind === "order" ? (
              // Final stage: quantity and execution. The search field is gone
              // because there is nothing left to search for.
              <OrderFlow
                instrument={stage.instrument}
                side={stage.side}
                onDone={close}
                onCancel={() => setStage({ kind: "pickInstrument", side: stage.side })}
              />
            ) : (
              <>
                <div className="flex items-center gap-3 border-b border-line px-4">
                  {stage.kind === "pickInstrument" ? (
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2 py-0.5 text-[0.625rem] font-medium tracking-[0.1em]",
                        stage.side === "BUY" ? "border-up/40 text-up" : "border-down/40 text-down",
                      )}
                    >
                      {stage.side}
                    </span>
                  ) : (
                    <svg viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0 text-ink-tertiary" fill="none" stroke="currentColor" strokeWidth="1.3">
                      <circle cx="7" cy="7" r="4.6" />
                      <path d="m10.6 10.6 3 3" strokeLinecap="round" />
                    </svg>
                  )}

                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={
                      stage.kind === "pickInstrument"
                        ? "Which instrument?"
                        : "Search commands, screens and symbols…"
                    }
                    aria-label={
                      stage.kind === "pickInstrument" ? "Search instruments" : "Search commands"
                    }
                    aria-controls="command-results"
                    aria-activedescendant={rows.length > 0 ? `command-row-${activeIndex}` : undefined}
                    role="combobox"
                    aria-expanded
                    className="h-14 w-full bg-transparent text-[0.9375rem] text-ink placeholder:text-ink-tertiary focus:outline-none"
                  />

                  <kbd className="tabular hidden shrink-0 rounded-[3px] border border-line px-1.5 py-0.5 text-[0.625rem] text-ink-tertiary sm:block">
                    ESC
                  </kbd>
                </div>

                <div ref={listRef} id="command-results" role="listbox" className="max-h-[52vh] overflow-y-auto p-2">
              {rows.length === 0 ? (
                <p className="px-3 py-10 text-center text-[0.875rem] text-ink-tertiary">
                  Nothing matches “{query}”.
                </p>
              ) : (
                <>
                  {grouped.map((section) => (
                    <Section key={section.group} label={section.group}>
                      {section.entries.map(({ command, index }) => (
                        <Row
                          key={command.id}
                          index={index}
                          active={index === activeIndex}
                          onSelect={() => run(index)}
                          onHover={() => setActiveIndex(index)}
                          icon={<NavIcon name={command.icon} className="size-4 opacity-60" />}
                          title={command.label}
                          subtitle={command.description}
                        />
                      ))}
                    </Section>
                  ))}

                  {symbols.length > 0 ? (
                    <Section label="Symbols">
                      {symbols.map((instrument, offset) => {
                        const index = commands.length + offset;
                        return (
                          <Row
                            key={instrument.id}
                            index={index}
                            active={index === activeIndex}
                            onSelect={() => run(index)}
                            onHover={() => setActiveIndex(index)}
                            icon={
                              <span className="tabular w-4 text-center text-[0.625rem] text-ink-tertiary">
                                {instrument.exchange === "BSE" ? "B" : "N"}
                              </span>
                            }
                            title={instrument.symbol}
                            subtitle={instrument.name}
                          />
                        );
                      })}
                    </Section>
                  ) : null}
                </>
              )}
                </div>

                <footer className="flex items-center justify-between gap-4 border-t border-line px-4 py-2.5 text-[0.625rem] text-ink-tertiary">
                  <span className="flex items-center gap-3">
                    <Hint keys="↑↓" label="Navigate" />
                    <Hint keys="↵" label={stage.kind === "pickInstrument" ? "Choose" : "Select"} />
                    {stage.kind === "pickInstrument" ? <Hint keys="esc" label="Back" /> : null}
                  </span>
                  <span>Paper trading · Virtual money</span>
                </footer>
              </>
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function Section({ label, children }: { label: CommandGroup | "Symbols"; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 last:mb-0">
      <p className="eyebrow px-3 py-2">{label}</p>
      {children}
    </div>
  );
}

function Row({
  index,
  active,
  onSelect,
  onHover,
  icon,
  title,
  subtitle,
}: {
  index: number;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      role="option"
      id={`command-row-${index}`}
      data-row={index}
      aria-selected={active}
      onClick={onSelect}
      onPointerEnter={onHover}
      className={cn(
        "flex w-full items-center gap-3 rounded-[3px] px-3 py-2.5 text-left transition-colors duration-150",
        active && "bg-ink/8",
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.875rem]">{title}</span>
        <span className="block truncate text-[0.6875rem] text-ink-tertiary">{subtitle}</span>
      </span>
    </button>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded-[3px] border border-line px-1 py-0.5">{keys}</kbd>
      {label}
    </span>
  );
}
