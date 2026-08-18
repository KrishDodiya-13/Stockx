"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/cn";

const fieldBase =
  "w-full bg-transparent text-[0.9375rem] text-ink placeholder:text-ink-tertiary " +
  "border border-line rounded-sm px-3.5 h-11 " +
  "transition-colors duration-200 " +
  "hover:border-line-strong focus:border-ink focus:outline-none " +
  "disabled:opacity-40 disabled:cursor-not-allowed";

interface FieldShellProps {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}

/** Label + control + hint/error. Error replaces hint — never stack both. */
export function Field({ label, hint, error, children, htmlFor, className }: FieldShellProps) {
  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="eyebrow mb-2.5 block">
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="mt-2 text-xs text-down" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-2 text-xs text-ink-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  label?: string;
  hint?: string;
  error?: string;
  /** Right-aligned tabular figures — use for any monetary or share input. */
  numeric?: boolean;
  /** Static adornment inside the field, e.g. a ₹ sign. Not named `prefix`, which is a native HTML attribute. */
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, numeric, leading, trailing, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  const control = (
    <div className="relative flex items-center">
      {leading ? (
        <span className="pointer-events-none absolute left-3.5 text-[0.9375rem] text-ink-tertiary">
          {leading}
        </span>
      ) : null}
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(
          fieldBase,
          numeric && "tabular text-right",
          leading && "pl-8",
          trailing && "pr-12",
          error && "border-down hover:border-down focus:border-down",
          className,
        )}
        {...props}
      />
      {trailing ? (
        <span className="pointer-events-none absolute right-3.5 text-xs text-ink-tertiary">
          {trailing}
        </span>
      ) : null}
    </div>
  );

  if (!label && !hint && !error) return control;

  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId}>
      {control}
    </Field>
  );
});

/** Search field with a leading glyph and an escape-to-clear affordance. */
export const SearchInput = forwardRef<HTMLInputElement, InputProps>(function SearchInput(
  { className, ...props },
  ref,
) {
  return (
    <div className="relative flex items-center">
      <svg
        viewBox="0 0 16 16"
        aria-hidden
        className="pointer-events-none absolute left-3.5 size-3.5 text-ink-tertiary"
      >
        <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.3" fill="none" />
        <path d="m10.6 10.6 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      <input
        ref={ref}
        type="search"
        className={cn(fieldBase, "pl-10 [&::-webkit-search-cancel-button]:appearance-none", className)}
        {...props}
      />
    </div>
  );
});

/**
 * A range control styled for the risk simulator. Value is rendered by the
 * caller so it can be formatted in the right units.
 */
export function Slider({
  id,
  min,
  max,
  step = 1,
  value,
  onValueChange,
  label,
  describedBy,
  className,
}: {
  id: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onValueChange: (value: number) => void;
  label?: string;
  describedBy?: string;
  className?: string;
}) {
  return (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-describedby={describedBy}
      onChange={(event) => onValueChange(Number(event.target.value))}
      className={cn(
        "h-1 w-full cursor-pointer appearance-none rounded-full bg-line",
        "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none",
        "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink",
        "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-200",
        "hover:[&::-webkit-slider-thumb]:scale-125",
        "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full",
        "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink",
        className,
      )}
    />
  );
}

/** Segmented on/off control for settings. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full border transition-colors duration-300",
        checked ? "border-ink bg-ink" : "border-line-strong bg-transparent",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 size-4 -translate-y-1/2 rounded-full transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
          checked ? "left-[1.125rem] bg-ink-inverse" : "left-0.5 bg-ink-tertiary",
        )}
      />
    </button>
  );
}
