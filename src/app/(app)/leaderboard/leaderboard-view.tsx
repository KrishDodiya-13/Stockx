"use client";

import { useState } from "react";

import { useGamification } from "@/components/gamification/gamification-data";
import { Panel, PanelHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { RecordCard, ResponsiveRecords } from "@/components/ui/record-list";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";
import {
  MIN_TRADES_TO_RANK,
  PERIOD_LABEL,
  type LeaderboardPeriod,
} from "@/services/gamification/scoring";

const PERIODS: readonly TabItem<LeaderboardPeriod>[] = [
  { value: "weekly", label: PERIOD_LABEL.weekly },
  { value: "monthly", label: PERIOD_LABEL.monthly },
  { value: "all-time", label: PERIOD_LABEL["all-time"] },
];

export function LeaderboardView() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("all-time");
  const { data, status, message } = useGamification(period);

  if (status === "unconfigured") {
    return (
      <Panel className="mt-10">
        <EmptyState
          title="Rankings need a database"
          description={message ?? "Accounts and trades are stored in the database."}
        />
      </Panel>
    );
  }

  return (
    <div className="mt-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs items={PERIODS} value={period} onValueChange={setPeriod} variant="segment" />
        {data ? (
          <span className="text-[0.75rem] text-ink-tertiary">
            Benchmark {formatPercent(data.benchmarkPercent, { signed: true })} over this period
          </span>
        ) : null}
      </div>

      <Panel>
        <PanelHeader
          title="Rankings"
          description="Scored on return, risk-adjusted performance, consistency, win rate and drawdown — never on profit alone"
        />

        {status === "loading" ? (
          <SkeletonRows rows={5} className="px-5 md:px-6" />
        ) : status === "error" || !data ? (
          <EmptyState title="Could not load rankings" description={message ?? "Try again."} />
        ) : data.leaderboard.length === 0 ? (
          <EmptyState
            title="No accounts have traded yet"
            description="Rankings appear once accounts have a trading record behind them."
          />
        ) : (
          <ResponsiveRecords
            cards={
              <ul>
                {data.leaderboard.map((entry, index) => (
                  <li
                    key={entry.displayName + String(entry.rank ?? index)}
                    className={cn(
                      entry.isYou && "bg-ink/5",
                      !entry.ranked && "opacity-60",
                    )}
                  >
                    {/*
                      Eight columns do not survive a 375px screen. The card
                      leads with rank and return — what a leaderboard is for —
                      and keeps the rest as labelled pairs.
                    */}
                    <RecordCard
                      title={
                        <span className="flex items-center gap-2">
                          <span className="tabular text-ink-tertiary">{entry.rank ?? "—"}</span>
                          {entry.displayName}
                          {entry.isYou ? (
                            <span className="rounded-full border border-line px-1.5 py-0.5 text-[0.5625rem] uppercase tracking-[0.1em] text-ink-tertiary">
                              you
                            </span>
                          ) : null}
                        </span>
                      }
                      subtitle={
                        entry.ranked
                          ? `${entry.closedTrades} closed trades`
                          : `${entry.closedTrades} of ${MIN_TRADES_TO_RANK} trades needed to rank`
                      }
                      value={formatPercent(entry.returnPercent, { signed: true })}
                      valueTone={entry.returnPercent >= 0 ? "up" : "down"}
                      meta={[
                        { label: "vs bench", value: formatPercent(entry.outperformance, { signed: true }) },
                        { label: "Win rate", value: `${entry.winRate.toFixed(0)}%` },
                        {
                          label: "Risk-adj",
                          value: entry.riskAdjusted === null ? "—" : entry.riskAdjusted.toFixed(2),
                        },
                        { label: "Drawdown", value: formatPercent(-entry.maxDrawdownPercent) },
                      ]}
                    />
                  </li>
                ))}
              </ul>
            }
            table={
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-line-subtle">
                  <Th className="pl-5 md:pl-6">#</Th>
                  <Th>Trader</Th>
                  <Th align="right">Return</Th>
                  <Th align="right">vs bench</Th>
                  <Th align="right">Win rate</Th>
                  <Th align="right">Risk-adj</Th>
                  <Th align="right">Drawdown</Th>
                  <Th align="right" className="pr-5 md:pr-6">Score</Th>
                </tr>
              </thead>
              <tbody>
                {data.leaderboard.map((entry, index) => (
                  <tr
                    key={entry.displayName + String(entry.rank ?? index)}
                    className={cn(
                      "border-b border-line-subtle last:border-b-0",
                      entry.isYou && "bg-ink/5",
                      !entry.ranked && "opacity-60",
                    )}
                  >
                    <td className="tabular py-3.5 pl-5 text-[0.8125rem] md:pl-6">
                      {entry.rank ?? "—"}
                    </td>
                    <td className="py-3.5">
                      <span className="flex items-center gap-2 text-[0.875rem]">
                        {entry.displayName}
                        {entry.isYou ? (
                          <span className="rounded-full border border-line px-1.5 py-0.5 text-[0.5625rem] uppercase tracking-[0.1em] text-ink-tertiary">
                            you
                          </span>
                        ) : null}
                      </span>
                      {!entry.ranked ? (
                        <span className="mt-0.5 block text-[0.625rem] text-ink-tertiary">
                          {entry.closedTrades} of {MIN_TRADES_TO_RANK} trades needed to rank
                        </span>
                      ) : null}
                    </td>
                    <td
                      className={cn(
                        "tabular py-3.5 text-right text-[0.8125rem]",
                        entry.returnPercent >= 0 ? "text-up" : "text-down",
                      )}
                    >
                      {formatPercent(entry.returnPercent, { signed: true })}
                    </td>
                    <td
                      className={cn(
                        "tabular py-3.5 text-right text-[0.8125rem]",
                        entry.outperformance >= 0 ? "text-up" : "text-down",
                      )}
                    >
                      {formatPercent(entry.outperformance, { signed: true })}
                    </td>
                    <td className="tabular py-3.5 text-right text-[0.8125rem]">
                      {entry.winRate.toFixed(0)}%
                    </td>
                    <td className="tabular py-3.5 text-right text-[0.8125rem]">
                      {entry.riskAdjusted === null ? "—" : entry.riskAdjusted.toFixed(2)}
                    </td>
                    <td className="tabular py-3.5 text-right text-[0.8125rem] text-down">
                      {formatPercent(-entry.maxDrawdownPercent)}
                    </td>
                    <td className="tabular py-3.5 pr-5 text-right text-[0.875rem] font-medium md:pr-6">
                      {entry.score === null ? "—" : entry.score.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            }
          />
        )}
      </Panel>

      {/*
        Said plainly rather than disguised with seeded competitors: this
        deployment has the accounts it has.
      */}
      {data && data.participantCount <= 1 ? (
        <p className="max-w-2xl text-xs leading-relaxed text-ink-tertiary">
          This deployment has {data.participantCount === 1 ? "one account" : "no accounts"}, so the
          board is not yet a competition. No placeholder traders have been added — every row here is
          a real account with a real record.
        </p>
      ) : null}

      <p className="max-w-2xl text-xs leading-relaxed text-ink-tertiary">
        Ranking uses a weighted composite so that a large return bought with a large drawdown does
        not outrank a smaller one earned steadily. Accounts with fewer than {MIN_TRADES_TO_RANK}{" "}
        closed trades are listed but not placed — a short record is mostly chance.
      </p>
    </div>
  );
}

function Th({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn("eyebrow py-3 font-medium", align === "right" && "text-right", className)}
    >
      {children}
    </th>
  );
}
