/**
 * The instrument universe.
 *
 * This is *reference* data (symbol, name, sector, size) — not price data. A
 * live adapter replaces this with the provider's instrument master; the shapes
 * are identical so nothing downstream changes.
 */

import type { Instrument } from "@/domain/market";

interface SeedRow {
  symbol: string;
  name: string;
  sector: Instrument["sector"];
  /**
   * Listing venue.
   *
   * Declared, not inferred. It used to be derived with `symbol === "SENSEX"
   * ? "BSE" : "NSE"`, repeated in three places — a rule that happened to be
   * right for exactly one row and silently mislabels the next BSE instrument
   * anyone adds. Equity rows omit it and default to NSE; index rows state it.
   */
  exchange?: Instrument["exchange"];
  marketCapCr: number;
  /** Reference price in rupees, used only to seed the simulation. */
  referencePrice: number;
  /** Annualised volatility used by the simulator, as a fraction. */
  volatility: number;
  /** BSE scrip code, where confirmed. Searchable alongside symbol and name. */
  bseCode?: string;
}

export const EQUITY_SEED: readonly SeedRow[] = [
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "Energy", marketCapCr: 1_920_000, referencePrice: 1418.6, volatility: 0.22 },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "Financials", marketCapCr: 1_480_000, referencePrice: 1962.35, volatility: 0.19 },
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "Technology", marketCapCr: 1_140_000, referencePrice: 3142.8, volatility: 0.21 },
  { symbol: "ICICIBANK", name: "ICICI Bank", sector: "Financials", marketCapCr: 1_010_000, referencePrice: 1421.05, volatility: 0.2 },
  { symbol: "INFY", name: "Infosys", sector: "Technology", marketCapCr: 640_000, referencePrice: 1548.4, volatility: 0.24 },
  { symbol: "BHARTIARTL", name: "Bharti Airtel", sector: "Telecom", marketCapCr: 1_090_000, referencePrice: 1902.7, volatility: 0.23 },
  { symbol: "SBIN", name: "State Bank of India", sector: "Financials", marketCapCr: 780_000, referencePrice: 874.15, volatility: 0.26 },
  { symbol: "ITC", name: "ITC", sector: "Consumer", marketCapCr: 510_000, referencePrice: 408.9, volatility: 0.17 },
  { symbol: "LT", name: "Larsen & Toubro", sector: "Industrials", marketCapCr: 500_000, referencePrice: 3648.5, volatility: 0.25 },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", sector: "Consumer", marketCapCr: 570_000, referencePrice: 2426.3, volatility: 0.16 },
  { symbol: "SUNPHARMA", name: "Sun Pharmaceutical", sector: "Healthcare", marketCapCr: 400_000, referencePrice: 1668.25, volatility: 0.22 },
  { symbol: "MARUTI", name: "Maruti Suzuki", sector: "Auto", marketCapCr: 490_000, referencePrice: 15_580.0, volatility: 0.24 },
  { symbol: "TATAMOTORS", name: "Tata Motors", sector: "Auto", marketCapCr: 260_000, referencePrice: 712.4, volatility: 0.33 },
  { symbol: "AXISBANK", name: "Axis Bank", sector: "Financials", marketCapCr: 380_000, referencePrice: 1216.6, volatility: 0.24 },
  { symbol: "KOTAKBANK", name: "Kotak Mahindra Bank", sector: "Financials", marketCapCr: 420_000, referencePrice: 2118.9, volatility: 0.21 },
  { symbol: "TATASTEEL", name: "Tata Steel", sector: "Materials", marketCapCr: 220_000, referencePrice: 176.85, volatility: 0.35 },
  { symbol: "WIPRO", name: "Wipro", sector: "Technology", marketCapCr: 260_000, referencePrice: 248.7, volatility: 0.28 },
  { symbol: "ADANIENT", name: "Adani Enterprises", sector: "Industrials", marketCapCr: 290_000, referencePrice: 2506.3, volatility: 0.42 },
  { symbol: "NTPC", name: "NTPC", sector: "Utilities", marketCapCr: 330_000, referencePrice: 341.2, volatility: 0.2 },
  { symbol: "POWERGRID", name: "Power Grid Corporation", sector: "Utilities", marketCapCr: 270_000, referencePrice: 289.55, volatility: 0.19 },
  { symbol: "ASIANPAINT", name: "Asian Paints", sector: "Materials", marketCapCr: 240_000, referencePrice: 2498.15, volatility: 0.23 },
  { symbol: "TITAN", name: "Titan Company", sector: "Consumer", marketCapCr: 320_000, referencePrice: 3604.75, volatility: 0.26 },
  { symbol: "BAJFINANCE", name: "Bajaj Finance", sector: "Financials", marketCapCr: 560_000, referencePrice: 903.4, volatility: 0.29 },
  { symbol: "CIPLA", name: "Cipla", sector: "Healthcare", marketCapCr: 125_000, referencePrice: 1546.9, volatility: 0.21 },
  { symbol: "DRREDDY", name: "Dr. Reddy's Laboratories", sector: "Healthcare", marketCapCr: 105_000, referencePrice: 1258.6, volatility: 0.23 },
  { symbol: "JSWSTEEL", name: "JSW Steel", sector: "Materials", marketCapCr: 260_000, referencePrice: 1071.3, volatility: 0.3 },
  { symbol: "ULTRACEMCO", name: "UltraTech Cement", sector: "Materials", marketCapCr: 350_000, referencePrice: 12_048.5, volatility: 0.22 },
  { symbol: "HCLTECH", name: "HCL Technologies", sector: "Technology", marketCapCr: 430_000, referencePrice: 1586.2, volatility: 0.23 },
  { symbol: "ONGC", name: "Oil & Natural Gas Corporation", sector: "Energy", marketCapCr: 300_000, referencePrice: 238.45, volatility: 0.27 },
  { symbol: "COALINDIA", name: "Coal India", sector: "Energy", marketCapCr: 240_000, referencePrice: 389.1, volatility: 0.25 },
  { symbol: "M&M", name: "Mahindra & Mahindra", sector: "Auto", marketCapCr: 420_000, referencePrice: 3392.6, volatility: 0.25 },
  { symbol: "EICHERMOT", name: "Eicher Motors", sector: "Auto", marketCapCr: 190_000, referencePrice: 6884.0, volatility: 0.26 },
  { symbol: "NESTLEIND", name: "Nestle India", sector: "Consumer", marketCapCr: 220_000, referencePrice: 2276.4, volatility: 0.16 },
  { symbol: "TECHM", name: "Tech Mahindra", sector: "Technology", marketCapCr: 150_000, referencePrice: 1532.8, volatility: 0.27 },
  { symbol: "GRASIM", name: "Grasim Industries", sector: "Materials", marketCapCr: 190_000, referencePrice: 2814.2, volatility: 0.22 },
  { symbol: "INDUSINDBK", name: "IndusInd Bank", sector: "Financials", marketCapCr: 60_000, referencePrice: 776.35, volatility: 0.34 },
  { symbol: "APOLLOHOSP", name: "Apollo Hospitals", sector: "Healthcare", marketCapCr: 110_000, referencePrice: 7502.5, volatility: 0.24 },
  { symbol: "HINDALCO", name: "Hindalco Industries", sector: "Materials", marketCapCr: 155_000, referencePrice: 692.75, volatility: 0.31 },
  { symbol: "BPCL", name: "Bharat Petroleum", sector: "Energy", marketCapCr: 150_000, referencePrice: 344.9, volatility: 0.28 },
  { symbol: "SHRIRAMFIN", name: "Shriram Finance", sector: "Financials", marketCapCr: 120_000, referencePrice: 638.15, volatility: 0.3 },

  /*
    Beyond the large caps.

    The universe held forty equities because forty rows had been written — not
    because anything capped it. There is no slice, limit or page size anywhere
    in the codebase; every surface reads `INSTRUMENTS` and counts what it
    finds. So extending this array is the entire change: the stocks page,
    search, the strategy instrument picker, the watchlist, the trade ticket and
    the simulator all pick these up without a component being touched.
  */

  // Chemicals
  { symbol: "SUDARSCHEM", name: "Sudarshan Chemical Industries", sector: "Chemicals", marketCapCr: 8_400, referencePrice: 1105.4, volatility: 0.34, bseCode: "506655" },
  { symbol: "PIDILITIND", name: "Pidilite Industries", sector: "Chemicals", marketCapCr: 155_000, referencePrice: 3042.6, volatility: 0.24 },
  { symbol: "SRF", name: "SRF", sector: "Chemicals", marketCapCr: 82_000, referencePrice: 2778.35, volatility: 0.29 },
  { symbol: "AARTIIND", name: "Aarti Industries", sector: "Chemicals", marketCapCr: 16_500, referencePrice: 452.8, volatility: 0.36 },
  { symbol: "DEEPAKNTR", name: "Deepak Nitrite", sector: "Chemicals", marketCapCr: 27_000, referencePrice: 1982.15, volatility: 0.33 },
  { symbol: "TATACHEM", name: "Tata Chemicals", sector: "Chemicals", marketCapCr: 24_000, referencePrice: 942.7, volatility: 0.31 },

  // Financials
  { symbol: "BANKBARODA", name: "Bank of Baroda", sector: "Financials", marketCapCr: 128_000, referencePrice: 246.85, volatility: 0.31 },
  { symbol: "PNB", name: "Punjab National Bank", sector: "Financials", marketCapCr: 118_000, referencePrice: 102.4, volatility: 0.35 },
  { symbol: "CANBK", name: "Canara Bank", sector: "Financials", marketCapCr: 96_000, referencePrice: 106.15, volatility: 0.33 },
  { symbol: "IDFCFIRSTB", name: "IDFC First Bank", sector: "Financials", marketCapCr: 52_000, referencePrice: 70.9, volatility: 0.36 },
  { symbol: "CHOLAFIN", name: "Cholamandalam Investment and Finance", sector: "Financials", marketCapCr: 128_000, referencePrice: 1524.3, volatility: 0.29 },
  { symbol: "MUTHOOTFIN", name: "Muthoot Finance", sector: "Financials", marketCapCr: 92_000, referencePrice: 2286.5, volatility: 0.28 },
  { symbol: "LICHSGFIN", name: "LIC Housing Finance", sector: "Financials", marketCapCr: 32_000, referencePrice: 582.4, volatility: 0.3 },

  // Technology
  { symbol: "LTIM", name: "LTIMindtree", sector: "Technology", marketCapCr: 164_000, referencePrice: 5546.2, volatility: 0.27 },
  { symbol: "PERSISTENT", name: "Persistent Systems", sector: "Technology", marketCapCr: 84_000, referencePrice: 5462.8, volatility: 0.32 },
  { symbol: "COFORGE", name: "Coforge", sector: "Technology", marketCapCr: 58_000, referencePrice: 8724.5, volatility: 0.31 },
  { symbol: "MPHASIS", name: "Mphasis", sector: "Technology", marketCapCr: 52_000, referencePrice: 2758.9, volatility: 0.29 },
  { symbol: "OFSS", name: "Oracle Financial Services Software", sector: "Technology", marketCapCr: 76_000, referencePrice: 8842.35, volatility: 0.33 },

  // Healthcare
  { symbol: "DIVISLAB", name: "Divis Laboratories", sector: "Healthcare", marketCapCr: 158_000, referencePrice: 5946.7, volatility: 0.26 },
  { symbol: "LUPIN", name: "Lupin", sector: "Healthcare", marketCapCr: 88_000, referencePrice: 1932.45, volatility: 0.28 },
  { symbol: "AUROPHARMA", name: "Aurobindo Pharma", sector: "Healthcare", marketCapCr: 66_000, referencePrice: 1128.6, volatility: 0.3 },
  { symbol: "TORNTPHARM", name: "Torrent Pharmaceuticals", sector: "Healthcare", marketCapCr: 112_000, referencePrice: 3312.8, volatility: 0.24 },
  { symbol: "ZYDUSLIFE", name: "Zydus Lifesciences", sector: "Healthcare", marketCapCr: 98_000, referencePrice: 972.15, volatility: 0.27 },

  // Consumer
  { symbol: "DABUR", name: "Dabur India", sector: "Consumer", marketCapCr: 92_000, referencePrice: 518.35, volatility: 0.21 },
  { symbol: "MARICO", name: "Marico", sector: "Consumer", marketCapCr: 88_000, referencePrice: 682.9, volatility: 0.22 },
  { symbol: "GODREJCP", name: "Godrej Consumer Products", sector: "Consumer", marketCapCr: 124_000, referencePrice: 1206.55, volatility: 0.23 },
  { symbol: "COLPAL", name: "Colgate-Palmolive India", sector: "Consumer", marketCapCr: 68_000, referencePrice: 2489.7, volatility: 0.22 },
  { symbol: "UBL", name: "United Breweries", sector: "Consumer", marketCapCr: 52_000, referencePrice: 1968.4, volatility: 0.26 },
  { symbol: "VBL", name: "Varun Beverages", sector: "Consumer", marketCapCr: 172_000, referencePrice: 512.25, volatility: 0.29 },

  // Auto
  { symbol: "TVSMOTOR", name: "TVS Motor Company", sector: "Auto", marketCapCr: 138_000, referencePrice: 2896.4, volatility: 0.29 },
  { symbol: "ASHOKLEY", name: "Ashok Leyland", sector: "Auto", marketCapCr: 68_000, referencePrice: 232.15, volatility: 0.32 },
  { symbol: "MOTHERSON", name: "Samvardhana Motherson International", sector: "Auto", marketCapCr: 98_000, referencePrice: 142.8, volatility: 0.34 },
  { symbol: "BOSCHLTD", name: "Bosch", sector: "Auto", marketCapCr: 92_000, referencePrice: 31_240.5, volatility: 0.26 },

  // Industrials
  { symbol: "SIEMENS", name: "Siemens", sector: "Industrials", marketCapCr: 118_000, referencePrice: 3312.9, volatility: 0.28 },
  { symbol: "ABB", name: "ABB India", sector: "Industrials", marketCapCr: 112_000, referencePrice: 5286.4, volatility: 0.29 },
  { symbol: "HAVELLS", name: "Havells India", sector: "Industrials", marketCapCr: 96_000, referencePrice: 1542.35, volatility: 0.27 },
  { symbol: "CUMMINSIND", name: "Cummins India", sector: "Industrials", marketCapCr: 88_000, referencePrice: 3182.7, volatility: 0.3 },
  { symbol: "BEL", name: "Bharat Electronics", sector: "Industrials", marketCapCr: 288_000, referencePrice: 394.6, volatility: 0.33 },
  { symbol: "HAL", name: "Hindustan Aeronautics", sector: "Industrials", marketCapCr: 296_000, referencePrice: 4426.85, volatility: 0.34 },

  // Materials
  { symbol: "AMBUJACEM", name: "Ambuja Cements", sector: "Materials", marketCapCr: 142_000, referencePrice: 578.3, volatility: 0.28 },
  { symbol: "SHREECEM", name: "Shree Cement", sector: "Materials", marketCapCr: 108_000, referencePrice: 29_842.5, volatility: 0.25 },
  { symbol: "VEDL", name: "Vedanta", sector: "Materials", marketCapCr: 178_000, referencePrice: 458.9, volatility: 0.38 },
  { symbol: "NATIONALUM", name: "National Aluminium Company", sector: "Materials", marketCapCr: 38_000, referencePrice: 206.45, volatility: 0.36 },

  // Energy and utilities
  { symbol: "IOC", name: "Indian Oil Corporation", sector: "Energy", marketCapCr: 198_000, referencePrice: 140.25, volatility: 0.27 },
  { symbol: "GAIL", name: "GAIL India", sector: "Energy", marketCapCr: 124_000, referencePrice: 188.7, volatility: 0.29 },
  { symbol: "ADANIGREEN", name: "Adani Green Energy", sector: "Utilities", marketCapCr: 158_000, referencePrice: 998.4, volatility: 0.45 },
  { symbol: "TATAPOWER", name: "Tata Power", sector: "Utilities", marketCapCr: 126_000, referencePrice: 394.15, volatility: 0.31 },
  { symbol: "NHPC", name: "NHPC", sector: "Utilities", marketCapCr: 84_000, referencePrice: 83.65, volatility: 0.3 },

  // Telecom
  { symbol: "IDEA", name: "Vodafone Idea", sector: "Telecom", marketCapCr: 52_000, referencePrice: 7.42, volatility: 0.55 },
  { symbol: "INDUSTOWER", name: "Indus Towers", sector: "Telecom", marketCapCr: 96_000, referencePrice: 356.8, volatility: 0.32 },
];

/**
 * Market indices.
 *
 * An index is *not* an equity: it has no shares, no order book and nothing to
 * buy or sell. It lives in this registry only so the dashboard's market strip
 * can show a level, and every tradable surface filters it out — see
 * `EQUITY_INSTRUMENTS` and `isTradable` below, which are what the stock list,
 * the watchlist and the order route are built on.
 *
 * NIFTY 50 and NIFTY BANK are NSE indices; SENSEX is a BSE index. Mixing them
 * into an NSE equity segment is what produced a SENSEX row that offered a BUY
 * button and, in live mode, no price to press it against.
 */
export const INDEX_SEED: readonly SeedRow[] = [
  { symbol: "NIFTY50", name: "NIFTY 50", sector: null, exchange: "NSE", marketCapCr: 0, referencePrice: 24_968.4, volatility: 0.13 },
  { symbol: "BANKNIFTY", name: "NIFTY BANK", sector: null, exchange: "NSE", marketCapCr: 0, referencePrice: 55_842.1, volatility: 0.16 },
  { symbol: "SENSEX", name: "BSE SENSEX", sector: null, exchange: "BSE", marketCapCr: 0, referencePrice: 81_724.6, volatility: 0.12 },
];

export function instrumentId(exchange: string, symbol: string): string {
  return `${exchange}:${symbol}`;
}

function toInstrument(row: SeedRow, kind: Instrument["kind"]): Instrument {
  const exchange = row.exchange ?? "NSE";
  return {
    id: instrumentId(exchange, row.symbol),
    symbol: row.symbol,
    name: row.name,
    exchange,
    kind,
    sector: row.sector,
    marketCapCr: row.marketCapCr,
    ...(row.bseCode ? { bseCode: row.bseCode } : {}),
  };
}

/** Indices only — the market strip, never a trade ticket. */
export const INDEX_INSTRUMENTS: readonly Instrument[] = INDEX_SEED.map((row) =>
  toInstrument(row, "index"),
);

/** Equities only — everything that can actually be bought or sold. */
export const EQUITY_INSTRUMENTS: readonly Instrument[] = EQUITY_SEED.map((row) =>
  toInstrument(row, "equity"),
);

export const INSTRUMENTS: readonly Instrument[] = [...INDEX_INSTRUMENTS, ...EQUITY_INSTRUMENTS];

export const INSTRUMENT_BY_ID: ReadonlyMap<string, Instrument> = new Map(
  INSTRUMENTS.map((instrument) => [instrument.id, instrument]),
);

/** Simulation parameters, keyed by instrument id. Mock adapter only. */
export const SEED_BY_ID: ReadonlyMap<string, SeedRow> = new Map(
  [...INDEX_SEED, ...EQUITY_SEED].map(
    (row) => [instrumentId(row.exchange ?? "NSE", row.symbol), row] as const,
  ),
);

export const INDEX_IDS: readonly string[] = INDEX_INSTRUMENTS.map((instrument) => instrument.id);

const INDEX_ID_SET: ReadonlySet<string> = new Set(INDEX_IDS);

/** True for a market index — SENSEX, NIFTY 50, NIFTY BANK. */
export function isIndexId(instrumentId: string): boolean {
  return INDEX_ID_SET.has(instrumentId);
}

/**
 * Whether an instrument may be traded.
 *
 * The single predicate every trading surface asks. It is deliberately
 * expressed as "is an equity" rather than "is not an index": a future
 * instrument kind that is also untradable (a currency pair, a commodity spot)
 * is then excluded by default rather than by having been remembered here.
 */
export function isTradable(instrumentId: string): boolean {
  return INSTRUMENT_BY_ID.get(instrumentId)?.kind === "equity";
}
