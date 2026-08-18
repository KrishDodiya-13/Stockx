"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  MAX_TOTAL_DEPOSIT_RUPEES,
  MIN_INITIAL_DEPOSIT_RUPEES,
} from "@/domain/constants";
import { cn } from "@/lib/cn";
import { formatCompactCurrency } from "@/lib/format";
import { rupeesToPaise } from "@/lib/money";

type Mode = "signin" | "signup";

const MIN_DEPOSIT_LABEL = formatCompactCurrency(rupeesToPaise(MIN_INITIAL_DEPOSIT_RUPEES));
const MAX_DEPOSIT_LABEL = formatCompactCurrency(rupeesToPaise(MAX_TOTAL_DEPOSIT_RUPEES));

/**
 * Starting-capital presets.
 *
 * ── Why there is a "Custom" option ─────────────────────────────────────────
 *
 * Three cards were asked for: ₹1K, ₹5K and ₹10K. Offering only those would
 * quietly cap sign-up at ₹10,000, when an account may be funded up to
 * ₹10,00,000 — so the three presets are the primary choice and `Custom` keeps
 * the rest of the permitted range reachable. It is the least prominent option
 * and most people will never open it.
 */
const PRESETS = [1_000, 5_000, 10_000] as const;

/** The card selected before the user touches anything. */
const DEFAULT_PRESET = 10_000;

export function AuthForm({
  initialMode = "signin",
  next,
}: {
  initialMode?: Mode;
  /** Where to land after signing in. Already validated by the page. */
  next?: string;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  /** `null` means the custom field is in use; otherwise the chosen preset. */
  const [preset, setPreset] = useState<number | null>(DEFAULT_PRESET);
  const [customDeposit, setCustomDeposit] = useState(String(DEFAULT_PRESET));

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isSignUp = mode === "signup";
  const deposit = preset ?? Number(customDeposit);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    if (isSignUp) {
      if (
        !Number.isFinite(deposit) ||
        deposit < MIN_INITIAL_DEPOSIT_RUPEES ||
        deposit > MAX_TOTAL_DEPOSIT_RUPEES
      ) {
        setError(
          `Starting capital must be between ${MIN_DEPOSIT_LABEL} and ${MAX_DEPOSIT_LABEL}.`,
        );
        return;
      }
    }

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          email,
          password,
          ...(isSignUp ? { name, initialDeposit: deposit } : {}),
        }),
      });

      const payload = (await response.json()) as { message?: string };

      if (!response.ok) {
        setError(payload.message ?? "Could not sign you in.");
        setPending(false);
        return;
      }

      // Clear the password from state before navigating away.
      setPassword("");

      router.replace(next ?? "/dashboard");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-[26rem]" noValidate>
      <span className="eyebrow text-ink-tertiary">
        {isSignUp ? "Create account" : "Sign in"}
      </span>

      <h1 className="mt-5 text-[2rem] leading-[1.05] tracking-[-0.03em] sm:text-[2.25rem]">
        {isSignUp ? "Open a paper account" : "Welcome back"}
      </h1>

      <p className="mt-4 text-[0.875rem] leading-relaxed text-ink-secondary">
        {isSignUp
          ? "Choose your starting virtual capital. No real money is involved at any point."
          : "Your portfolio, strategies and history are tied to your account."}
      </p>

      <div className="mt-9 space-y-5">
        {isSignUp ? (
          <Input
            label="Name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            hint="Shown on the leaderboard. Leave blank to stay anonymous."
          />
        ) : null}

        <Input
          label="Email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <Input
          label="Password"
          type="password"
          required
          autoComplete={isSignUp ? "new-password" : "current-password"}
          placeholder={isSignUp ? "At least 10 characters" : "••••••••••"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {isSignUp ? (
          <Field
            label="Starting capital"
            hint={`You can add more later, up to ${MAX_DEPOSIT_LABEL} in total.`}
          >
            <div
              className="grid grid-cols-3 gap-2"
              role="radiogroup"
              aria-label="Starting capital"
            >
              {PRESETS.map((amount) => {
                const selected = preset === amount;
                return (
                  <button
                    key={amount}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setPreset(amount);
                      setCustomDeposit(String(amount));
                      setError(null);
                    }}
                    className={cn(
                      "group relative cursor-pointer rounded-sm border px-3 py-3.5 text-left",
                      "transition-[border-color,background-color,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
                      "focus-visible:outline-2 focus-visible:outline-offset-2",
                      "active:scale-[0.98]",
                      selected
                        ? "border-ink bg-raised"
                        : "border-line hover:border-line-strong hover:bg-raised/40",
                    )}
                  >
                    <span
                      className={cn(
                        "tabular block text-[1.0625rem] tracking-[-0.02em] transition-colors duration-200",
                        selected ? "text-ink" : "text-ink-secondary group-hover:text-ink",
                      )}
                    >
                      {formatCompactCurrency(rupeesToPaise(amount))}
                    </span>
                    <span className="mt-1 block text-[0.625rem] uppercase tracking-[0.12em] text-ink-tertiary">
                      {amount === DEFAULT_PRESET ? "Suggested" : "Virtual"}
                    </span>

                    {/* The selected marker: a hairline, not a glow. */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-x-3 bottom-0 h-px bg-ink transition-opacity duration-200",
                        selected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </button>
                );
              })}
            </div>

            <div className="mt-2.5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setPreset(preset === null ? DEFAULT_PRESET : null);
                  setError(null);
                }}
                aria-expanded={preset === null}
                className="cursor-pointer text-[0.75rem] text-ink-tertiary underline-offset-4 transition-colors duration-200 hover:text-ink hover:underline"
              >
                {preset === null ? "Use a preset" : "Enter a custom amount"}
              </button>
            </div>

            {preset === null ? (
              <div className="mt-2.5">
                <Input
                  type="number"
                  required
                  numeric
                  leading="₹"
                  aria-label="Custom starting capital in rupees"
                  min={MIN_INITIAL_DEPOSIT_RUPEES}
                  max={MAX_TOTAL_DEPOSIT_RUPEES}
                  step={1}
                  value={customDeposit}
                  onChange={(event) => setCustomDeposit(event.target.value)}
                  placeholder={String(MAX_TOTAL_DEPOSIT_RUPEES)}
                />
                <p className="mt-2 text-[0.6875rem] text-ink-tertiary">
                  Between {MIN_DEPOSIT_LABEL} and {MAX_DEPOSIT_LABEL}.
                </p>
              </div>
            ) : null}
          </Field>
        ) : null}
      </div>

      {error ? (
        <p className="mt-6 text-[0.8125rem] text-down" role="alert">
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="group mt-8 w-full" disabled={pending}>
        {pending ? "Working…" : isSignUp ? "Create paper account" : "Sign in"}
        {pending ? null : (
          <span
            aria-hidden
            className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1"
          >
            →
          </span>
        )}
      </Button>

      <p className="mt-6 text-[0.8125rem] text-ink-secondary">
        {isSignUp ? "Already have an account?" : "No account yet?"}{" "}
        <button
          type="button"
          className="cursor-pointer text-ink underline-offset-4 transition-opacity duration-200 hover:opacity-70 hover:underline"
          onClick={() => {
            setMode(isSignUp ? "signin" : "signup");
            setError(null);
          }}
        >
          {isSignUp ? "Sign in" : "Create one"}
        </button>
      </p>

      <p className="mt-10 border-t border-line-subtle pt-6 text-[0.6875rem] leading-relaxed text-ink-tertiary">
        STOCKX is a paper-trading simulator. All balances, orders and P&L are virtual. Nothing here
        places a real trade or moves real money.
      </p>
    </form>
  );
}
