"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";

/** Tallest the menu ever grows. */
const PREFERRED_MAX_HEIGHT = 360;

/** Below this the list is too short to be worth opening downward. */
const MIN_USABLE_HEIGHT = 160;

/** Breathing room kept between the menu and the edge of the viewport. */
const VIEWPORT_MARGIN = 12;

export interface SelectOption<T extends string = string> {
  readonly value: T;
  readonly label: string;
  readonly hint?: string;
  /**
   * Extra text the search should match but not display — a BSE scrip code, for
   * instance, so `506655` finds Sudarshan Chemical without putting a number in
   * the option row.
   */
  readonly keywords?: readonly string[];
}

interface SelectProps<T extends string> {
  options: readonly SelectOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  label?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /**
   * Adds a filter box at the top of the menu.
   *
   * Opt-in rather than automatic: a four-item interval picker is worse with a
   * search box in it, while a ninety-instrument list is unusable without one.
   * The caller knows which it has.
   */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Shown when a search matches nothing. */
  emptyMessage?: string;
}

/** Case-insensitive match across the label, the hint and any keywords. */
function matches(option: SelectOption<string>, needle: string): boolean {
  if (needle === "") return true;

  const haystack = [option.label, option.hint ?? "", ...(option.keywords ?? [])];
  return haystack.some((text) => text.toLowerCase().includes(needle));
}

/**
 * Split text around a match so the matching run can be emphasised.
 *
 * Returns the parts rather than markup, so the caller decides how a match
 * looks and this stays free of styling.
 */
function splitOnMatch(text: string, needle: string): readonly [string, string, string] {
  if (needle === "") return [text, "", ""];

  const index = text.toLowerCase().indexOf(needle);
  if (index === -1) return [text, "", ""];

  return [
    text.slice(0, index),
    text.slice(index, index + needle.length),
    text.slice(index + needle.length),
  ];
}

/** Renders `text` with the matching run emphasised. */
function Highlighted({ text, needle }: { text: string; needle: string }) {
  const [before, match, after] = splitOnMatch(text, needle);
  if (match === "") return <>{text}</>;

  return (
    <>
      {before}
      {/* Weight and colour, not a coloured block — green and red are reserved
          for market direction throughout this product. */}
      <span className="font-medium text-ink underline decoration-line-strong underline-offset-2">
        {match}
      </span>
      {after}
    </>
  );
}

/**
 * Listbox dropdown, optionally searchable.
 *
 * Built on a button + `role="listbox"` rather than a native `<select>` so the
 * options can carry a hint line and match the rest of the type system, with
 * the full keyboard contract implemented by hand: arrows move, Home/End jump,
 * Enter commits, Escape reverts, and focus returns to the trigger on close.
 *
 * When `searchable`, focus moves into the filter box on open and the ARIA
 * combobox role moves with it — `aria-activedescendant` is read from whatever
 * holds focus, so it has to travel to the input rather than stay on a trigger
 * the user is no longer on.
 */
export function Select<T extends string>({
  options,
  value,
  onValueChange,
  label,
  placeholder = "Select…",
  className,
  disabled = false,
  searchable = false,
  searchPlaceholder = "Search…",
  emptyMessage = "No matches found",
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const needle = searchable ? query.trim().toLowerCase() : "";

  /** The options actually on screen. All indexing below is against this. */
  const visible = useMemo(
    () => (needle === "" ? options : options.filter((option) => matches(option, needle))),
    [options, needle],
  );

  const selected = options.find((option) => option.value === value) ?? null;

  /**
   * Where the list opens and how tall it may be.
   *
   * A long instrument list is the case that matters: a fixed cap opens the
   * menu straight off the bottom of the screen when the trigger sits low in
   * the page, and the options below the fold cannot be reached. Measuring the
   * space on each side lets the list flip upward when there is more room there
   * and cap itself to what actually fits, so it always scrolls inside the
   * viewport instead of past it.
   */
  const [placement, setPlacement] = useState<{ above: boolean; maxHeight: number }>({
    above: false,
    maxHeight: PREFERRED_MAX_HEIGHT,
  });

  useEffect(() => {
    if (!open) return;

    const measure = (): void => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const above = rect.top - VIEWPORT_MARGIN;

      // Only flip when below is genuinely cramped *and* above is roomier —
      // a menu that jumps sides for a few pixels is worse than a short one.
      const flip = below < MIN_USABLE_HEIGHT && above > below;
      const available = flip ? above : below;

      setPlacement({
        above: flip,
        maxHeight: Math.max(MIN_USABLE_HEIGHT, Math.min(PREFERRED_MAX_HEIGHT, available)),
      });
    };

    measure();
    window.addEventListener("resize", measure);
    // Capture phase: the page may scroll inside a panel rather than the window.
    window.addEventListener("scroll", measure, true);

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open]);

  const close = useCallback(
    (returnFocus = true) => {
      setOpen(false);
      setQuery("");
      if (returnFocus) triggerRef.current?.focus();
    },
    [],
  );

  // Opening starts on the current selection, so arrowing begins where the user
  // already is rather than at the top of ninety rows.
  useEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, visible.findIndex((option) => option.value === value)));
    if (searchable) searchRef.current?.focus();
    // Only on open: re-running as `visible` changes would fight the reset below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A new query renders a different list, so the highlight has to come back to
  // the top or it would point at a row that is no longer there.
  useEffect(() => {
    setActiveIndex(0);
  }, [needle]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  // Clicking away commits nothing and closes.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  const commit = (index: number): void => {
    const option = visible[index];
    if (!option) return;
    onValueChange(option.value);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!open) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, visible.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(visible.length - 1);
        break;
      case "Enter":
        event.preventDefault();
        commit(activeIndex);
        break;
      case " ":
        // Space types a space while filtering; it only commits when there is
        // no text field to type into.
        if (!searchable) {
          event.preventDefault();
          commit(activeIndex);
        }
        break;
    }
  };

  /** ARIA combobox attributes, on whichever element holds focus. */
  const comboboxProps = {
    role: "combobox" as const,
    "aria-haspopup": "listbox" as const,
    "aria-expanded": open,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": open && visible.length > 0 ? `${listId}-${activeIndex}` : undefined,
  };

  return (
    <div ref={rootRef} className={cn("relative w-full", className)}>
      {label ? <span className="eyebrow mb-2.5 block">{label}</span> : null}

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        {...(searchable
          ? { "aria-haspopup": "listbox" as const, "aria-expanded": open }
          : comboboxProps)}
        onClick={() => setOpen((isOpen) => !isOpen)}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-3 rounded-sm border border-line px-3.5",
          "text-left text-[0.9375rem] transition-colors duration-200",
          "hover:border-line-strong focus:border-ink focus:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-40",
          open && "border-ink",
        )}
      >
        <span className={cn("truncate", !selected && "text-ink-tertiary")}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          viewBox="0 0 12 12"
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-ink-tertiary transition-transform duration-300",
            open && "rotate-180",
          )}
        >
          <path d="m2.5 4.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.3" fill="none" />
        </svg>
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: placement.above ? 6 : -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: placement.above ? 6 : -6 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={{ maxHeight: placement.maxHeight }}
            className={cn(
              /*
                `popover-surface` rather than `glass`: glass is translucent,
                which is right for the sticky header and wrong for a menu that
                has to hide the table it covers.

                z-50 clears the app chrome (topbar 30, mobile nav 40) while
                staying below the modal at 100, so a menu on the page cannot
                paint over a dialog.
              */
              "popover-surface absolute z-50 flex w-full flex-col overflow-hidden rounded-sm",
              placement.above ? "bottom-full mb-1.5" : "top-full mt-1.5",
            )}
          >
            {searchable ? (
              // Outside the scroll container rather than `position: sticky`
              // inside it — a flex column pins it just as firmly and avoids the
              // rows showing through a sticky element during momentum scroll.
              <div className="shrink-0 border-b border-line-subtle px-3">
                <div className="flex items-center gap-2.5">
                  <svg viewBox="0 0 16 16" aria-hidden className="size-3.5 shrink-0 text-ink-tertiary">
                    <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.3" fill="none" />
                    <path d="m10.6 10.6 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    autoComplete="off"
                    {...comboboxProps}
                    className="h-11 w-full bg-transparent text-[0.875rem] text-ink placeholder:text-ink-tertiary focus:outline-none"
                  />
                </div>
              </div>
            ) : null}

            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              onKeyDown={onKeyDown}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1"
            >
              {visible.length === 0 ? (
                <li className="px-3 py-6 text-center text-[0.8125rem] text-ink-tertiary">
                  {emptyMessage}
                </li>
              ) : (
                visible.map((option, index) => (
                  <li
                    key={option.value}
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={option.value === value}
                    onPointerEnter={() => setActiveIndex(index)}
                    onClick={() => commit(index)}
                    className={cn(
                      "cursor-pointer rounded-[3px] px-3 py-2.5 text-[0.875rem] transition-colors duration-150",
                      index === activeIndex && "bg-ink/8",
                      option.value === value && "font-medium",
                    )}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate">
                        <Highlighted text={option.label} needle={needle} />
                      </span>
                      {option.value === value ? (
                        <svg viewBox="0 0 12 12" aria-hidden className="size-3 shrink-0">
                          <path
                            d="m2 6.2 2.6 2.6L10 3.4"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            fill="none"
                            strokeLinecap="round"
                          />
                        </svg>
                      ) : null}
                    </span>
                    {option.hint ? (
                      <span className="mt-0.5 block truncate text-[0.6875rem] text-ink-tertiary">
                        <Highlighted text={option.hint} needle={needle} />
                      </span>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
