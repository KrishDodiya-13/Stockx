"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  ExposureMeter,
  PortfolioRiskMeter,
  PriceLadder,
  RiskRewardBar,
} from "@/components/risk/risk-meters";
import { CellGrid, Panel, PanelHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/dropdown";
import { Money, StatTile } from "@/components/ui/financial";
import { Field, Input, Slider } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { STARTING_CAPITAL } from "@/domain/constants";
import { cn } from "@/lib/cn";
import { EQUITY_OPTIONS, INSTRUMENT_SEARCH_PLACEHOLDER } from "@/lib/instrument-options";
import { formatCurrency, formatPercent } from "@/lib/format";
import { rupeesToPaise, rupeesToPrice, type Paise, type PriceE4 } from "@/lib/money";
import { handleSessionExpiry } from "@/lib/session-expiry";
import { INSTRUMENTS } from "@/services/market-data";
import {
  calculateRisk,
  formatRiskReward,
  maxQuantityForRisk,
} from "@/services/risk/risk-calculator";
import {
  canConvertToStrategy,
  simulationToStrategy,
} from "@/services/risk/simulation-to-strategy";

const SYMBOL_OPTIONS = EQUITY_OPTIONS;

/** Risk budgets a trader might hold themselves to, as a % of capital. */
const RISK_BUDGETS = [0.5, 1, 2] as const;

interface Inputs {
  capital: string;
  entry: string;
  target: string;
  stop: string;
  quantity: number;
  instrumentId: string;
  name: string;
}

/**
 * The Risk Simulator.
 *
 * Every figure on this screen comes from `calculateRisk` — the same engine the
 * order ticket and (later) the strategy pre-flight use. This component performs
 * no arithmetic of its own beyond parsing what was typed.
 *
 * Inputs are held as strings so a half-typed value ("1.") is not coerced into
 * something surprising mid-keystroke, and parsed once at the edge.
 */
export function RiskSimulator() {
  const router = useRouter();
  const { toast } = useToast();

  const [inputs, setInputs] = useState<Inputs>({
    capital: "1000000",
    entry: "100",
    target: "110",
    stop: "95",
    quantity: 1000,
    instrumentId: SYMBOL_OPTIONS[0]?.value ?? "",
    name: "",
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Inputs>(key: K, value: Inputs[K]): void =>
    setInputs((current) => ({ ...current, [key]: value }));

  const parsed = useMemo(
    () => ({
      capital: parseMoney(inputs.capital),
      entry: parsePrice(inputs.entry),
      target: parsePrice(inputs.target),
      stop: parsePrice(inputs.stop),
    }),
    [inputs.capital, inputs.entry, inputs.target, inputs.stop],
  );

  const capital = parsed.capital ?? STARTING_CAPITAL;

  const profile = useMemo(
    () =>
      calculateRisk({
        entryPrice: parsed.entry ?? rupeesToPrice(0),
        quantity: inputs.quantity,
        capital,
        targetPrice: parsed.target,
        stopPrice: parsed.stop,
      }),
    [parsed, inputs.quantity, capital],
  );

  /** Slider ceiling: what the capital can actually buy at the entry price. */
  const maxQuantity = useMemo(() => {
    const { entry } = parsed;
    if (entry === null || entry <= 0) return 5000;
    const affordable = Math.floor(capital / (entry / 100));
    return Math.max(100, Math.min(affordable, 200_000));
  }, [parsed, capital]);

  const suggestions = useMemo(() => {
    const { entry, stop } = parsed;
    if (entry === null || stop === null) return [];

    return RISK_BUDGETS.map((budget) => ({
      budget,
      quantity: maxQuantityForRisk(entry, stop, capital, budget),
    })).filter((suggestion) => suggestion.quantity > 0);
  }, [parsed, capital]);

  const symbol =
    INSTRUMENTS.find((instrument) => instrument.id === inputs.instrumentId)?.symbol ?? "";

  const convertible = canConvertToStrategy({
    entryPrice: parsed.entry,
    quantity: inputs.quantity,
  });

  async function save(): Promise<void> {
    if (parsed.entry === null) return;
    setSaving(true);

    try {
      const response = await fetch("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: inputs.name.trim() || `${symbol} plan`,
          instrumentId: inputs.instrumentId,
          capital,
          entryPrice: parsed.entry,
          targetPrice: parsed.target,
          stopPrice: parsed.stop,
          quantity: inputs.quantity,
        }),
      });

      if (handleSessionExpiry(response)) return;

      const payload = (await response.json()) as { message?: string };

      toast(
        response.ok
          ? { title: "Simulation saved", tone: "success" }
          : {
              title: "Could not save",
              description: payload.message ?? "The simulation was rejected.",
              tone: "error",
            },
      );
    } catch {
      toast({ title: "Could not reach the server", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function convert(): Promise<void> {
    if (parsed.entry === null) return;

    const draft = simulationToStrategy({
      name: inputs.name.trim() || `${symbol} plan`,
      instrumentId: inputs.instrumentId,
      symbol,
      entryPrice: parsed.entry,
      quantity: inputs.quantity,
      targetPrice: parsed.target,
      stopPrice: parsed.stop,
    });

    try {
      const response = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });

      if (handleSessionExpiry(response)) return;

      const payload = (await response.json()) as { message?: string };

      if (!response.ok) {
        toast({
          title: "Could not create the strategy",
          description: payload.message ?? "The conversion was rejected.",
          tone: "error",
        });
        return;
      }

      toast({
        title: "Strategy created as a draft",
        description: "Review the rules, then activate it when you're ready.",
        tone: "success",
      });
      router.push("/strategies");
    } catch {
      toast({ title: "Could not reach the server", tone: "error" });
    }
  }

  return (
    <div className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]">
      {/* --- inputs -------------------------------------------------------- */}
      <Panel>
        <PanelHeader title="Trade setup" description="Values are hypothetical" />

        <div className="space-y-5 px-5 py-5 md:px-6">
          <Select
            label="Instrument"
            options={SYMBOL_OPTIONS}
            value={inputs.instrumentId}
            onValueChange={(instrumentId) => set("instrumentId", instrumentId)}
            searchable
            searchPlaceholder={INSTRUMENT_SEARCH_PLACEHOLDER}
            emptyMessage="No instruments found"
          />

          <Input
            label="Capital"
            numeric
            inputMode="decimal"
            leading="₹"
            value={inputs.capital}
            onChange={(event) => set("capital", event.target.value)}
            error={parsed.capital === null ? "Enter an amount above zero" : undefined}
            hint="What this position is measured against"
          />

          <Input
            label="Entry price"
            numeric
            inputMode="decimal"
            leading="₹"
            value={inputs.entry}
            onChange={(event) => set("entry", event.target.value)}
            error={parsed.entry === null ? "Enter a price above zero" : undefined}
          />

          <Input
            label="Target price"
            numeric
            inputMode="decimal"
            leading="₹"
            value={inputs.target}
            onChange={(event) => set("target", event.target.value)}
            hint="Optional — leave blank for no target"
          />

          <Input
            label="Stop loss"
            numeric
            inputMode="decimal"
            leading="₹"
            value={inputs.stop}
            onChange={(event) => set("stop", event.target.value)}
            hint="Optional — but the downside is unbounded without one"
          />

          <Field label="Quantity" htmlFor="risk-quantity">
            <div className="flex items-baseline justify-between">
              <span className="tabular text-numeric-l">
                {inputs.quantity.toLocaleString("en-IN")}
              </span>
              <span className="text-[0.6875rem] text-ink-tertiary">shares</span>
            </div>

            <Slider
              id="risk-quantity"
              min={0}
              max={maxQuantity}
              step={Math.max(1, Math.round(maxQuantity / 500))}
              value={Math.min(inputs.quantity, maxQuantity)}
              onValueChange={(quantity) => set("quantity", quantity)}
              label="Quantity"
              describedBy="risk-outputs"
              className="mt-4"
            />

            <div className="mt-2.5 flex justify-between text-[0.6875rem] text-ink-tertiary">
              <span className="tabular">0</span>
              <span className="tabular">{maxQuantity.toLocaleString("en-IN")}</span>
            </div>
          </Field>

          {suggestions.length > 0 ? (
            <div>
              <p className="eyebrow mb-2.5">Size to a risk budget</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.budget}
                    type="button"
                    onClick={() => set("quantity", suggestion.quantity)}
                    className="rounded-full border border-line px-3 py-1.5 text-[0.75rem] text-ink-secondary transition-colors duration-200 hover:border-ink hover:text-ink"
                  >
                    {suggestion.budget}% ·{" "}
                    <span className="tabular">
                      {suggestion.quantity.toLocaleString("en-IN")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      {/* --- outputs ------------------------------------------------------- */}
      <div id="risk-outputs" className="space-y-6">
        <CellGrid columns={2}>
          <StatTile
            label="Maximum loss"
            value={
              <Money value={profile.maxLoss} size="xl" className="text-down text-numeric-l" whole />
            }
            sub={
              profile.stopDistancePercent === 0
                ? "No stop loss set"
                : `${formatPercent(profile.stopDistancePercent)} to stop`
            }
          />
          <StatTile
            label="Potential profit"
            value={
              <Money
                value={profile.potentialProfit}
                size="xl"
                className="text-up text-numeric-l"
                whole
              />
            }
            sub={
              profile.targetDistancePercent === 0
                ? "No target set"
                : `${formatPercent(profile.targetDistancePercent, { signed: true })} to target`
            }
          />
        </CellGrid>

        <Panel>
          <div className="space-y-8 px-5 py-6 md:px-6">
            <RiskRewardBar profile={profile} />
            <PortfolioRiskMeter profile={profile} />
            <ExposureMeter profile={profile} capital={capital} />
            {parsed.entry !== null ? (
              <PriceLadder entry={parsed.entry} target={parsed.target} stop={parsed.stop} />
            ) : null}
          </div>
        </Panel>

        <CellGrid columns={3}>
          <StatTile
            label="Risk / reward"
            value={
              <span className="tabular text-numeric-m font-medium">
                {formatRiskReward(profile.riskRewardRatio)}
              </span>
            }
            sub="Reward per unit risked"
          />
          <StatTile
            label="Position size"
            value={
              <span className="tabular text-numeric-m font-medium">
                {inputs.quantity.toLocaleString("en-IN")}
              </span>
            }
            sub={formatCurrency(profile.capitalExposure, { whole: true })}
          />
          <StatTile
            label="Break-even"
            value={
              <span className="tabular text-numeric-m font-medium">
                ₹{(profile.breakEvenPrice / 10_000).toFixed(2)}
              </span>
            }
            sub="Excludes costs"
          />
        </CellGrid>

        {profile.warnings.length > 0 ? (
          <Panel>
            <PanelHeader
              title="Checks"
              description={
                profile.isViable
                  ? "This position can be opened as specified"
                  : "This position cannot be opened as specified"
              }
            />
            <ul className="px-5 py-4 md:px-6">
              {profile.warnings.map((warning) => (
                <li key={warning.code} className="flex gap-3 py-2 text-[0.875rem]">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-[0.5em] size-1 shrink-0 rounded-full",
                      warning.severity === "blocking" ? "bg-down" : "bg-accent",
                    )}
                  />
                  <span className="text-ink-secondary">{warning.message}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {/* --- save / convert --------------------------------------------- */}
        <Panel>
          <PanelHeader title="Keep this plan" />
          <div className="space-y-4 px-5 py-5 md:px-6">
            <Input
              label="Name"
              value={inputs.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder={`${symbol} plan`}
            />

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || parsed.entry === null}
                className="inline-flex h-11 items-center rounded-full border border-line-strong px-5 text-[0.875rem] transition-all duration-300 hover:-translate-y-px hover:bg-ink hover:text-ink-inverse disabled:pointer-events-none disabled:opacity-40"
              >
                {saving ? "Saving…" : "Save simulation"}
              </button>

              <button
                type="button"
                onClick={() => void convert()}
                disabled={!convertible}
                className="inline-flex h-11 items-center rounded-full bg-ink px-5 text-[0.875rem] font-medium text-ink-inverse transition-all duration-300 hover:-translate-y-px disabled:pointer-events-none disabled:opacity-40"
              >
                Convert to strategy
              </button>
            </div>

            <p className="text-[0.6875rem] leading-relaxed text-ink-tertiary">
              Converting creates a draft strategy with an entry, your target and your stop. It is
              not activated — you review the rules first.
            </p>
          </div>
        </Panel>

        <p className="text-xs leading-relaxed text-ink-tertiary">
          These figures are arithmetic on the values you entered. They exclude brokerage, taxes,
          slippage and liquidity, assume the stop and target fill exactly at their levels, and
          assign no probability to any outcome. Nothing here is a prediction, a recommendation, or
          financial advice.
        </p>
      </div>
    </div>
  );
}

/** Parses a rupee price. Returns null for blank or invalid input. */
function parsePrice(raw: string): PriceE4 | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;

  return rupeesToPrice(value);
}

/** Parses a rupee amount into paise. */
function parseMoney(raw: string): Paise | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;

  return rupeesToPaise(value);
}
