import { CapitalSection } from "@/components/landing/capital-section";
import { ClosingSection } from "@/components/landing/closing-section";
import { Hero } from "@/components/landing/hero";
import { MarketSection } from "@/components/landing/market-section";
import { RiskSection } from "@/components/landing/risk-section";
import { SequenceSection } from "@/components/landing/sequence-section";
import { StrategySection } from "@/components/landing/strategy-section";
import { TimeMachineSection } from "@/components/landing/time-machine-section";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      {/*
        The scroll narrative: the promise, the capital, a live market, then the
        product read sideways as one sequence, then the individual surfaces in
        depth, and finally the invitation.
      */}
      <main id="main">
        <Hero />
        <CapitalSection />
        <MarketSection />
        <SequenceSection />
        <StrategySection />
        <RiskSection />
        <TimeMachineSection />
        <ClosingSection />
      </main>
      <SiteFooter />
    </>
  );
}
