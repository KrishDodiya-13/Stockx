"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTheme, type Theme } from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/card";
import { Input, Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { publicEnv } from "@/config/env";
import { MAX_TOTAL_DEPOSIT_RUPEES, MIN_INITIAL_DEPOSIT_RUPEES } from "@/domain/constants";
import { formatCurrency } from "@/lib/format";
import { type Paise, ZERO_PAISE, rupeesToPaise, subPaise } from "@/lib/money";
import { cn } from "@/lib/cn";
import { watchlistStore } from "@/services/watchlist/watchlist-store";

const THEMES: readonly { value: Theme; label: string; hint: string }[] = [
  { value: "dark", label: "Dark", hint: "The primary surface" },
  { value: "light", label: "Light", hint: "Warm paper" },
];

export function SettingsPanels({
  email,
  name,
  cashBalance,
  startingCapital,
}: {
  email: string | null;
  name: string | null;
  /** Null when signed out, or when the account row could not be read. */
  cashBalance: Paise | null;
  /** Total virtual capital ever deposited — the lifetime-cap ledger. */
  startingCapital: Paise | null;
}) {
  const { theme, setTheme } = useTheme();
  const reducedMotion = useReducedMotion();
  const { toast } = useToast();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const [account, setAccount] = useState({ cashBalance, startingCapital });
  const [depositAmount, setDepositAmount] = useState("");
  const [depositing, setDepositing] = useState(false);

  const remainingCapacity =
    account.startingCapital === null
      ? null
      : (subPaise(rupeesToPaise(MAX_TOTAL_DEPOSIT_RUPEES), account.startingCapital) as Paise);

  async function addFunds(): Promise<void> {
    if (depositing) return;

    const rupees = Number(depositAmount);
    if (!Number.isFinite(rupees) || rupees < MIN_INITIAL_DEPOSIT_RUPEES) {
      toast({
        title: "Enter a valid amount",
        description: `Deposits start at ${formatCurrency(rupeesToPaise(MIN_INITIAL_DEPOSIT_RUPEES), { whole: true })}.`,
      });
      return;
    }

    setDepositing(true);
    try {
      const response = await fetch("/api/account/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: rupees }),
      });

      const payload = (await response.json()) as {
        cashBalance?: number;
        startingCapital?: number;
        message?: string;
      };

      if (!response.ok) {
        toast({ title: "Could not add funds", description: payload.message ?? "Try again." });
        return;
      }

      setAccount({
        cashBalance: (payload.cashBalance ?? account.cashBalance) as Paise,
        startingCapital: (payload.startingCapital ?? account.startingCapital) as Paise,
      });
      setDepositAmount("");
      toast({
        title: "Funds added",
        description: `${formatCurrency(rupeesToPaise(rupees), { whole: true })} added to your virtual cash balance.`,
      });
      router.refresh();
    } catch {
      toast({ title: "Could not reach the server", description: "Check your connection and try again." });
    } finally {
      setDepositing(false);
    }
  }

  async function signOut(): Promise<void> {
    setSigningOut(true);
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "signout" }),
      });
      /*
        Clear the cached watchlist before navigating. The store is a
        module-level singleton that outlives the route change, so without this
        the next person to sign in on this device would briefly see the
        previous user's list before the fetch replaced it.
      */
      watchlistStore.reset();
      router.replace("/signin");
      router.refresh();
    } catch {
      setSigningOut(false);
      toast({
        title: "Could not sign out",
        description: "The server did not respond. Check your connection and try again.",
      });
    }
  }

  return (
    <div className="mt-10 grid gap-6 xl:grid-cols-2">
      <Panel>
        <PanelHeader title="Appearance" description="How the terminal renders" />

        <div className="space-y-6 px-5 py-5 md:px-6">
          <fieldset>
            <legend className="eyebrow mb-3">Theme</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {THEMES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setTheme(option.value)}
                  aria-pressed={theme === option.value}
                  className={cn(
                    "rounded-sm border p-4 text-left transition-colors duration-200",
                    theme === option.value
                      ? "border-ink"
                      : "border-line hover:border-line-strong",
                  )}
                >
                  <span className="block text-[0.875rem] font-medium">{option.label}</span>
                  <span className="mt-1 block text-[0.6875rem] text-ink-tertiary">
                    {option.hint}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex items-start justify-between gap-6 border-t border-line-subtle pt-5">
            <div className="min-w-0">
              <p className="text-[0.875rem] font-medium">Reduced motion</p>
              <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-secondary">
                {reducedMotion
                  ? "Your system asks for reduced motion, so animation and smooth scrolling are switched off."
                  : "Animation follows your system preference. Turn on reduced motion in your OS settings to disable it."}
              </p>
            </div>
            {/* Mirrors the OS setting; the OS remains the source of truth. */}
            <Switch
              checked={reducedMotion}
              onCheckedChange={() =>
                toast({
                  title: "Controlled by your system",
                  description:
                    "Reduced motion follows your operating system's accessibility preference.",
                })
              }
              label="Reduced motion (system controlled)"
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Account" description="Your virtual trading account" />

        <dl className="px-5 py-5 md:px-6">
          <Row label="Signed in as" value={email ?? "Not signed in"} />
          {name ? <Row label="Display name" value={name} /> : null}
          <Row label="Account type" value="Paper trading — virtual money" />
          <Row
            label="Cash balance"
            value={account.cashBalance === null ? "—" : formatCurrency(account.cashBalance, { whole: true })}
          />
          <Row
            label="Total deposited"
            value={
              account.startingCapital === null
                ? "—"
                : formatCurrency(account.startingCapital, { whole: true })
            }
          />
          <Row
            label="Market data"
            value={publicEnv.marketDataMode === "live" ? "Live provider" : "Local simulator"}
          />
          <Row label="Real orders" value="Never placed" />
        </dl>

        {email && remainingCapacity !== null ? (
          <div className="border-t border-line-subtle px-5 py-5 md:px-6">
            <p className="text-[0.875rem] font-medium">Add funds</p>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-secondary">
              {remainingCapacity <= ZERO_PAISE
                ? "You have reached the ₹10,00,000 lifetime deposit limit."
                : `You can add up to ${formatCurrency(remainingCapacity, { whole: true })} more, in total, across as many deposits as you like.`}
            </p>

            {remainingCapacity > ZERO_PAISE ? (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <Input
                  label="Amount"
                  type="number"
                  numeric
                  leading="₹"
                  min={MIN_INITIAL_DEPOSIT_RUPEES}
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                  placeholder={String(MIN_INITIAL_DEPOSIT_RUPEES)}
                  className="max-w-[10rem]"
                />
                <Button onClick={() => void addFunds()} disabled={depositing} size="sm">
                  {depositing ? "Adding…" : "Add funds"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {email ? (
          <div className="flex items-center justify-between gap-6 border-t border-line-subtle px-5 py-5 md:px-6">
            <p className="text-[0.8125rem] text-ink-secondary">
              Ends this session on this device.
            </p>
            <Button variant="secondary" size="sm" onClick={() => void signOut()} disabled={signingOut}>
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        ) : null}

        <div className="border-t border-line-subtle px-5 py-5 md:px-6">
          <p className="text-xs leading-relaxed text-ink-tertiary">
            This account cannot hold, receive or transfer real money, and no order it produces
            reaches an exchange or a broker.
          </p>
        </div>
      </Panel>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-line-subtle py-3 last:border-b-0">
      <dt className="text-[0.8125rem] text-ink-secondary">{label}</dt>
      <dd className="text-right text-[0.875rem]">{value}</dd>
    </div>
  );
}
