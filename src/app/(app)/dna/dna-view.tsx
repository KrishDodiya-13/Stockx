"use client";

import { useEffect, useState } from "react";

import { Panel, PanelHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTiles } from "@/components/ui/skeleton";
import { useAnimate } from "@/hooks/use-animation";
import { cn } from "@/lib/cn";
import { formatCurrency } from "@/lib/format";
import type { Paise } from "@/lib/money";
import { handleSessionExpiry } from "@/lib/session-expiry";
import {
  MIN_TRADES_FOR_METRICS,
  formatDuration,
  type DnaProfile,
  type GroupPerformance,
  type Insight,
} from "@/services/dna/dna-engine";

type Status = "loading" | "ready" | "error" | "unconfigured";

export function DnaView() {
  const [profile, setProfile] = useState<DnaProfile | null>(null);
  const [insights, setInsights] = useState<readonly Insight[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [message, setMessage] = useState<string | null>(null);

  const ref = useAnimate<HTMLDivElement>({ selector: "[data-dna-block]", stagger: 0.07 });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/dna", { cache: "no-store" });
        const payload = (await response.json()) as {
          profile?: DnaProfile;
          insights?: Insight[];
          error?: string;
          message?: string;
        };
        if (cancelled) return;

        if (handleSessionExpiry(response)) return;

        if (response.status === 503 && payload.error === "database_not_configured") {
          setStatus("unconfigured");
          setMessage(payload.message ?? null);
          return;
        }
        if (!response.ok || !payload.profile) {
          setStatus("error");
          setMessage(payload.message ?? "Could not build your profile.");
          return;
        }

        setProfile(payload.profile);
        setInsights(payload.insights ?? []);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "unconfigured") {
    return (
      <Panel className="mt-10">
        <EmptyState
          title="Your DNA needs a database"
          description={message ?? "Trades are stored per account, so the database must be configured."}
        />
      </Panel>
    );
  }

  if (status === "loading") return <SkeletonTiles count={4} />;

  if (status === "error" || !profile) {
    return (
      <Panel className="mt-10">
        <EmptyState title="Could not build your profile" description={message ?? "Try again."} />
      </Panel>
    );
  }

  // --- not enough history --------------------------------------------------
  if (!profile.sufficient) {
    return (
      <Panel className="mt-10">
        <div className="px-6 py-12 md:px-10">
          <span className="eyebrow">Not enough history</span>
          <h2 className="mt-5 text-display-m">
            {profile.closedCount} of {MIN_TRADES_FOR_METRICS} trades
          </h2>
          <p className="mt-5 max-w-xl text-[0.9375rem] leading-relaxed text-ink-secondary">
            A profile built from a handful of trades describes luck, not behaviour. Nothing is shown
            until there are at least {MIN_TRADES_FOR_METRICS} closed round trips — and comparative
            findings, like your strongest sector, wait until there are twelve.
          </p>

          <div className="mt-8 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-accent transition-[width] duration-700"
              style={{ width: `${Math.min(100, (profile.closedCount / MIN_TRADES_FOR_METRICS) * 100)}%` }}
            />
          </div>
        </div>
      </Panel>
    );
  }

  const thin = profile.closedCount < 12;

  return (
    <div ref={ref} className="mt-10 space-y-6">
      {thin ? (
        <p
          data-dna-block
          className="border border-accent/40 bg-accent/8 px-4 py-3 text-[0.8125rem] text-accent"
          role="status"
        >
          Based on {profile.closedCount} trades — enough for a first read, not enough to be
          confident. Comparative findings are withheld until twelve.
        </p>
      ) : null}

      {/* --- headline ---------------------------------------------------- */}
      <section data-dna-block className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Win rate"
          value={profile.winRate === null ? "—" : `${profile.winRate.toFixed(0)}%`}
          sub={`${profile.closedCount} closed trades`}
        />
        <Metric
          label="Average win"
          value={profile.averageWin === null ? "—" : formatCurrency(profile.averageWin, { whole: true })}
          tone="up"
          sub="Per winning trade"
        />
        <Metric
          label="Average loss"
          value={profile.averageLoss === null ? "—" : formatCurrency(profile.averageLoss, { whole: true })}
          tone="down"
          sub="Per losing trade"
        />
        <Metric
          label="Risk / reward"
          value={profile.riskReward === null ? "—" : `1 : ${profile.riskReward.toFixed(2)}`}
          sub="Average win ÷ average loss"
        />
      </section>

      <section data-dna-block className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Average hold" value={formatDuration(profile.averageHoldMs)} sub="All trades" />
        <Metric
          label="Winners held"
          value={formatDuration(profile.averageWinHoldMs)}
          sub="Average"
          tone="up"
        />
        <Metric
          label="Losers held"
          value={formatDuration(profile.averageLossHoldMs)}
          sub="Average"
          tone="down"
        />
        <Metric
          label="Trading frequency"
          value={profile.tradesPerDay === null ? "—" : profile.tradesPerDay.toFixed(1)}
          sub={`Trades per active day · ${profile.activeDays} days`}
        />
      </section>

      <section data-dna-block className="grid gap-px border border-line bg-line sm:grid-cols-2">
        <Metric
          label="Maximum drawdown"
          value={
            profile.maxDrawdown === 0
              ? "None"
              : formatCurrency(profile.maxDrawdown, { whole: true })
          }
          tone={profile.maxDrawdown > 0 ? "down" : undefined}
          sub={
            profile.maxDrawdownPercent === null
              ? "Peak-to-trough on booked P&L"
              : `${profile.maxDrawdownPercent.toFixed(1)}% from peak`
          }
        />
        <Metric
          label="Total booked"
          value={formatCurrency(
            profile.bySymbol.reduce((total, group) => total + group.totalPnl, 0) as Paise,
            { whole: true, signed: true },
          )}
          sub={
            profile.bySymbol.length === 0
              ? "Shown once there are twelve trades"
              : "Across all instruments"
          }
        />
      </section>

      {/* --- style mix ---------------------------------------------------- */}
      {profile.styleMix ? (
        <Panel data-dna-block>
          <PanelHeader
            title="Holding-period mix"
            description="How long you keep a position — the one style measure the trade record actually contains"
          />
          <div className="space-y-4 px-5 py-6 md:px-6">
            <StyleBar label="Under an hour" value={profile.styleMix.scalping} />
            <StyleBar label="Within the day" value={profile.styleMix.intraday} />
            <StyleBar label="Days" value={profile.styleMix.swing} />
            <StyleBar label="Over a week" value={profile.styleMix.position} />

            <p className="pt-2 text-[0.6875rem] leading-relaxed text-ink-tertiary">
              Labels like &ldquo;momentum&rdquo; or &ldquo;value&rdquo; are deliberately absent:
              they describe intent, and a trade record captures timing, not intent.
            </p>
          </div>
        </Panel>
      ) : null}

      {/* --- behavioural scores -------------------------------------------- */}
      <section data-dna-block className="grid gap-6 md:grid-cols-3">
        <ScoreDial
          label="Risk discipline"
          value={profile.riskDiscipline}
          caption="Above 50 means losses were closed sooner than winners were held"
        />
        <ScoreDial
          label="Sizing consistency"
          value={profile.sizingConsistency}
          caption="How similar your position sizes were — repeatability, not correctness"
        />
        <ScoreDial
          label="Outcome evenness"
          value={profile.outcomeConsistency}
          caption="Low means a few trades dominated your results"
        />
      </section>

      {/* --- insights ------------------------------------------------------ */}
      <Panel data-dna-block>
        <PanelHeader
          title="What your trades show"
          description="Observations about trades you have already made"
        />
        {insights.length === 0 ? (
          <EmptyState
            title="Nothing stands out yet"
            description="As your history grows, patterns worth pointing out will appear here."
            className="py-10"
          />
        ) : (
          <ul>
            {insights.map((insight) => (
              <li
                key={insight.id}
                className="flex gap-4 border-b border-line-subtle px-5 py-4 last:border-b-0 md:px-6"
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-[0.45em] size-1.5 shrink-0 rounded-full",
                    insight.tone === "caution" && "bg-accent",
                    insight.tone === "strength" && "bg-up",
                    insight.tone === "observation" && "bg-ink-tertiary",
                  )}
                />
                <span>
                  <span className="block text-[0.9375rem] leading-relaxed text-ink-secondary">
                    {insight.text}
                  </span>
                  <span className="mt-1.5 block text-[0.625rem] uppercase tracking-[0.12em] text-ink-tertiary">
                    {insight.sampleSize} trades · {insight.confidence} confidence
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* --- groupings ----------------------------------------------------- */}
      {profile.bySymbol.length > 0 ? (
        <div data-dna-block className="grid gap-6 lg:grid-cols-3">
          <GroupPanel title="By instrument" groups={profile.bySymbol} />
          <GroupPanel title="By sector" groups={profile.bySector} />
          <GroupPanel title="By entry hour" groups={profile.byHour} suffix=":00" />
        </div>
      ) : null}

      <p data-dna-block className="max-w-3xl text-xs leading-relaxed text-ink-tertiary">
        This profile describes trades you have already made in a paper account with simulated
        prices. It is not advice, not a forecast, and not a judgement of skill. Small samples are
        dominated by chance, and a pattern in past trades does not mean it will continue.
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
    <div className="bg-base p-5 md:p-6">
      <p className="eyebrow">{label}</p>
      <p
        className={cn(
          "tabular mt-3.5 text-numeric-m font-medium",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
        )}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[0.6875rem] text-ink-tertiary">{sub}</p>
    </div>
  );
}

function StyleBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-32 shrink-0 text-[0.8125rem] text-ink-secondary">{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-line">
        <span
          className="block h-full bg-ink transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ width: `${value}%` }}
        />
      </span>
      <span className="tabular w-12 text-right text-[0.8125rem]">{value.toFixed(0)}%</span>
    </div>
  );
}

/**
 * A score on a 0–100 arc.
 *
 * Drawn as an arc rather than a filled bar because these are positions on a
 * scale, not quantities — and the caption states what the scale means, so the
 * number is never left to imply something it does not measure.
 */
function ScoreDial({
  label,
  value,
  caption,
}: {
  label: string;
  value: number | null;
  caption: string;
}) {
  const pct = value ?? 0;
  const circumference = 2 * Math.PI * 42;
  const dash = (pct / 100) * circumference;

  return (
    <div className="border border-line p-6">
      <p className="eyebrow">{label}</p>

      <div className="mt-5 flex items-center gap-5">
        <svg viewBox="0 0 100 100" className="size-24 shrink-0 -rotate-90" role="img" aria-label={`${label}: ${value === null ? "not available" : Math.round(pct)} out of 100`}>
          <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6" className="stroke-line" />
          {value !== null ? (
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference}`}
              className="stroke-ink transition-[stroke-dasharray] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
            />
          ) : null}
        </svg>

        <div>
          <p className="tabular text-numeric-m font-medium">
            {value === null ? "—" : Math.round(pct)}
          </p>
          <p className="mt-1 text-[0.6875rem] text-ink-tertiary">out of 100</p>
        </div>
      </div>

      <p className="mt-5 text-[0.6875rem] leading-relaxed text-ink-tertiary">{caption}</p>
    </div>
  );
}

function GroupPanel({
  title,
  groups,
  suffix = "",
}: {
  title: string;
  groups: readonly GroupPerformance[];
  suffix?: string;
}) {
  return (
    <Panel>
      <PanelHeader title={title} />
      <ul className="px-5 py-3 md:px-6">
        {groups.slice(0, 6).map((group) => (
          <li
            key={group.key}
            className="flex items-baseline justify-between gap-3 border-b border-line-subtle py-2.5 last:border-b-0"
          >
            <span className="flex items-baseline gap-2 text-[0.8125rem]">
              {group.key}
              {suffix}
              {!group.sufficient ? (
                <span className="text-[0.625rem] text-ink-tertiary" title="Too few trades to characterise">
                  thin
                </span>
              ) : null}
            </span>
            <span className="flex items-baseline gap-3">
              <span className="tabular text-[0.6875rem] text-ink-tertiary">{group.trades}</span>
              <span
                className={cn(
                  "tabular text-[0.8125rem]",
                  group.totalPnl >= 0 ? "text-up" : "text-down",
                )}
              >
                {formatCurrency(group.totalPnl as Paise, { whole: true, signed: true })}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

