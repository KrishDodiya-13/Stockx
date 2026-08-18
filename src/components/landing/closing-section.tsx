"use client";

import { ButtonLink } from "@/components/ui/button";
import { VirtualMoneyBadge } from "@/components/ui/data-source-badge";
import { Magnetic } from "@/components/ui/magnetic";
import { Reveal, SplitLines } from "@/components/ui/reveal";

const CAPABILITIES = [
  { title: "Strategy DNA", body: "A profile of how you actually trade, drawn from your own history." },
  { title: "Trade replay", body: "Watch any completed trade play back against the price that surrounded it." },
  { title: "Backtesting", body: "Run a strategy across a historical range and read the equity curve." },
  { title: "Challenges", body: "Objectives on return, win rate and drawdown — not profit alone." },
  { title: "Leaderboards", body: "Ranked on risk-adjusted performance and consistency." },
  { title: "Command centre", body: "Ctrl / ⌘ + K reaches every surface without leaving the keyboard." },
];

export function ClosingSection() {
  return (
    <section className="gutter border-t border-line-subtle py-32 md:py-44">
      <div className="grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((item) => (
          <div key={item.title} className="bg-base p-7">
            <h3 className="text-base font-medium">{item.title}</h3>
            <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-secondary">{item.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-32 md:mt-48">
        <Reveal variant="mask">
          <SplitLines
            lines={["Start paper", "trading."]}
            className="text-display-xl"
          />
        </Reveal>

        <Reveal className="mt-12 flex flex-wrap items-center gap-4">
          <div data-animate="rise" className="flex flex-wrap items-center gap-4">
            <Magnetic strength={8}>
              <ButtonLink href="/dashboard" size="lg">
                Open a virtual account
              </ButtonLink>
            </Magnetic>
            <VirtualMoneyBadge />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
