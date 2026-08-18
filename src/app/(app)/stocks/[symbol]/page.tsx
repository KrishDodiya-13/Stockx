import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { StockDetail } from "@/app/(app)/stocks/[symbol]/stock-detail";
import { PageContainer } from "@/components/layout/page-header";
import { EQUITY_INSTRUMENTS } from "@/services/market-data";

interface PageProps {
  params: Promise<{ symbol: string }>;
}

/**
 * Equities only.
 *
 * This page carries a trade ticket, so it exists only for instruments that can
 * actually be traded. `/stocks/SENSEX` is a 404 rather than a page offering to
 * buy an index — the index has a home in the dashboard's market strip, where
 * it is presented as a level and nothing more.
 */
function findInstrument(symbol: string) {
  const needle = decodeURIComponent(symbol).toUpperCase();
  return (
    EQUITY_INSTRUMENTS.find((instrument) => instrument.symbol.toUpperCase() === needle) ?? null
  );
}

/** Pre-render every symbol; the universe is small and fully known at build. */
export function generateStaticParams(): { symbol: string }[] {
  return EQUITY_INSTRUMENTS.map((instrument) => ({ symbol: instrument.symbol }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { symbol } = await params;
  const instrument = findInstrument(symbol);

  if (!instrument) return { title: "Instrument not found" };

  return {
    title: `${instrument.symbol} — ${instrument.name}`,
    description: `Chart, statistics and a paper trading ticket for ${instrument.name} (${instrument.exchange}). Simulated market data, virtual money only.`,
  };
}

export default async function StockPage({ params }: PageProps) {
  const { symbol } = await params;
  const instrument = findInstrument(symbol);

  if (!instrument) notFound();

  return (
    <PageContainer>
      <StockDetail instrument={instrument} />
    </PageContainer>
  );
}
