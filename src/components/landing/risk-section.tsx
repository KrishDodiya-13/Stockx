"use client";

import { useMemo, useState } from "react";

import { Reveal, SplitLines } from "@/components/ui/reveal";
import { STARTING_CAPITAL } from "@/domain/constants";
import { cn } from "@/lib/cn";
import { formatCurrency, formatPercent } from "@/lib/format";
import { rupeesToPrice } from "@/lib/money";
import { calculateRisk, formatRiskReward } from "@/services/risk/risk-calculator";

const ENTRY = rupeesToPrice(100);
const TARGET = rupeesToPrice(110);
const STOP = rupeesToPrice(95);

/**
 * A working slice of the Risk Simulator, running the same `calculateRisk`
 * engine the product uses. Dragging the quantity recomputes every figure — the
 * point being that risk is a consequence of position size, not a setting.
 */
export function RiskSection() {
  const [quantity, setQuantity] = useState(1000);

  const profile = useMemo(
    () =>
      calculateRisk({
        entryPrice: ENTRY,
        quantity,
        capital: STARTING_CAPITAL,
        targetPrice: TARGET,
        stopPrice: STOP,
      }),
    [quantity],
  );

  return (
    <section id="risk" className="gutter border-t border-line-subtle py-32 md:py-44">
      <div className="grid gap-16 md:grid-cols-12">
        <div className="md:col-span-5">
          <Reveal variant="mask">
            <p className="eyebrow mb-6">Risk simulator</p>
            <SplitLines lines={["Know the loss", "before the trade."]} className="text-display-l" />
          </Reveal>

          <Reveal className="mt-10">
            <p className="max-w-sm text-base leading-relaxed text-ink-secondary" data-animate="rise">
              Set an entry, a target and a stop, then move the size. Every number below recomputes
              from the same engine that guards a live paper position, so the risk you rehearse is
              the risk you take.
            </p>
          </Reveal>
        </div>

        <div className="md:col-span-6 md:col-start-7">
          <div className="border border-line">
            <div className="grid grid-cols-3 gap-px bg-line">
              <Field label="Entry" value="₹100.00" />
              <Field label="Target" value="₹110.00" tone="up" />
              <Field label="Stop loss" value="₹95.00" tone="down" />
            </div>

            <div className="border-t border-line p-6">
              <div className="flex items-baseline justify-between">
                <label htmlFor="risk-quantity" className="eyebrow">
                  Quantity
                </label>
                <span className="tabular text-2xl font-medium">
                  {quantity.toLocaleString("en-IN")}
                </span>
              </div>

              <input
                id="risk-quantity"
                type="range"
                min={100}
                max={5000}
                step={100}
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
                className={cn(
                  "mt-5 h-1 w-full cursor-pointer appearance-none rounded-full bg-line",
                  "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none",
                  "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-ink",
                  "[&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:duration-200",
                  "hover:[&::-webkit-slider-thumb]:scale-125",
                  "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full",
                  "[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-ink",
                )}
                aria-describedby="risk-summary"
              />

              <div className="mt-3 flex justify-between text-[0.6875rem] text-ink-tertiary">
                <span className="tabular">100</span>
                <span className="tabular">5,000</span>
              </div>
            </div>

            <dl id="risk-summary" className="grid grid-cols-2 gap-px border-t border-line bg-line">
              <Metric
                label="Maximum loss"
                value={formatCurrency(profile.maxLoss, { whole: true })}
                sub={formatPercent(profile.maxLossPercent)}
                tone="down"
              />
              <Metric
                label="Potential profit"
                value={formatCurrency(profile.potentialProfit, { whole: true })}
                sub={formatPercent(profile.potentialProfitPercent)}
                tone="up"
              />
              <Metric
                label="Risk / reward"
                value={formatRiskReward(profile.riskRewardRatio)}
                sub="reward per unit risked"
              />
              <Metric
                label="Capital exposure"
                value={formatCurrency(profile.capitalExposure, { whole: true })}
                sub={`${profile.exposurePercent.toFixed(1)}% of portfolio`}
              />
            </dl>

            {profile.warnings.length > 0 ? (
              <ul className="border-t border-line p-6 text-[0.8125rem] text-ink-secondary">
                {profile.warnings.map((warning) => (
                  <li key={warning.code} className="flex gap-3 py-1">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-[0.45em] size-1 shrink-0 rounded-full",
                        warning.severity === "blocking" ? "bg-down" : "bg-accent",
                      )}
                    />
                    {warning.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <p className="mt-4 text-xs text-ink-tertiary">
            Illustrative arithmetic on the values shown. Excludes brokerage, taxes and slippage, and
            does not estimate the likelihood of any outcome.
          </p>
        </div>
      </div>
    </section>
  );
}

function Field({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="bg-base p-5">
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "tabular mt-3 text-lg",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="bg-base p-6">
      <dt className="eyebrow">{label}</dt>
      <dd>
        <p
          className={cn(
            "tabular mt-3 text-xl font-medium md:text-2xl",
            tone === "up" && "text-up",
            tone === "down" && "text-down",
          )}
        >
          {value}
        </p>
        <p className="mt-1.5 text-[0.6875rem] text-ink-tertiary">{sub}</p>
      </dd>
    </div>
  );
}
