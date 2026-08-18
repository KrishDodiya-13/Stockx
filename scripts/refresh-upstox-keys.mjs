/**
 * Regenerate the Upstox instrument-key map from Upstox's published master.
 *
 *   node scripts/refresh-upstox-keys.mjs
 *
 * Upstox identifies instruments by an ISIN-based key (`NSE_EQ|INE002A01018`),
 * not by trading symbol, and those keys change when a company is renamed,
 * demerged or relisted. Deriving them mechanically from the symbol is
 * therefore impossible — the mapping has to come from the vendor's own master,
 * which is what this script downloads.
 *
 * It needs no access token: the master is a public asset. Run it whenever the
 * instrument universe changes, or when a symbol stops receiving ticks.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const MASTER_URLS = {
  NSE: "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz",
  /*
    The BSE master is a separate download.

    SENSEX is a BSE index and appears nowhere in the NSE file, which is why it
    went unmapped while the NIFTY indices resolved. An index is not an equity
    and a BSE instrument is not an NSE one — conflating either is how a
    dashboard ends up subscribing to a key that will never tick.
  */
  BSE: "https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz",
};
const UNIVERSE = path.join(ROOT, "src/services/market-data/universe.ts");
const OUTPUT = path.join(
  ROOT,
  "src/services/market-data/providers/upstox/instrument-keys.generated.ts",
);

async function downloadMaster(exchange) {
  console.log(`Downloading Upstox ${exchange} master…`);
  const response = await fetch(MASTER_URLS[exchange]);
  if (!response.ok) throw new Error(`${exchange} master download failed: ${response.status}`);

  const rows = JSON.parse(
    zlib.gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8"),
  );
  console.log(`  ${rows.length.toLocaleString()} instruments`);
  return rows;
}

const [nseMaster, bseMaster] = await Promise.all([
  downloadMaster("NSE"),
  downloadMaster("BSE"),
]);

/** First match wins; the master lists some symbols more than once. */
const equities = new Map();
const indices = new Map();
for (const row of nseMaster) {
  if (row.segment === "NSE_EQ" && row.instrument_type === "EQ") {
    if (!equities.has(row.trading_symbol)) equities.set(row.trading_symbol, row);
  } else if (row.segment === "NSE_INDEX") {
    if (!indices.has(`NSE_INDEX|${row.name}`)) indices.set(`NSE_INDEX|${row.name}`, row);
  }
}
for (const row of bseMaster) {
  if (row.segment !== "BSE_INDEX") continue;
  if (!indices.has(`BSE_INDEX|${row.name}`)) indices.set(`BSE_INDEX|${row.name}`, row);
}

const source = fs.readFileSync(UNIVERSE, "utf8");
const equitySection = source.split("export const INDEX_SEED")[0];
const symbols = [...equitySection.matchAll(/symbol: "([^"]+)"/g)].map((m) => m[1]);

const resolved = [];
const unresolved = [];
for (const symbol of symbols) {
  const row = equities.get(symbol);
  if (row) resolved.push([symbol, row.instrument_key, row.name]);
  else unresolved.push(symbol);
}

/*
  Indices are named, not symbol-keyed, in the master — and the segment is part
  of the identity, since each exchange publishes its own index list. Both are
  stated here so an index can never be resolved out of the wrong segment.
*/
const INDEX_SOURCES = {
  NIFTY50: { segment: "NSE_INDEX", name: "Nifty 50" },
  BANKNIFTY: { segment: "NSE_INDEX", name: "Nifty Bank" },
  SENSEX: { segment: "BSE_INDEX", name: "BSE SENSEX" },
};
const resolvedIndices = [];
for (const [symbol, { segment, name }] of Object.entries(INDEX_SOURCES)) {
  const row = indices.get(`${segment}|${name}`);
  if (row) resolvedIndices.push([symbol, row.instrument_key, row.name]);
  else unresolved.push(symbol);
}

const lines = [
  "/**",
  " * Upstox instrument keys — GENERATED, do not edit by hand.",
  " *",
  " * Produced by `node scripts/refresh-upstox-keys.mjs` from Upstox's published",
  " * NSE and BSE masters. Each key is the vendor's own ISIN-based identifier; none of it",
  " * is inferred from the trading symbol, because the two are not related by any",
  " * rule.",
  " *",
  ` * Generated: ${new Date().toISOString().slice(0, 10)}`,
  ` * Resolved: ${resolved.length + resolvedIndices.length} of ${symbols.length + Object.keys(INDEX_SOURCES).length}`,
  " */",
  "",
  "/** Trading symbol -> Upstox V3 instrument_key. */",
  "export const UPSTOX_KEY_BY_SYMBOL: Readonly<Record<string, string>> = {",
  ...resolved.map(([symbol, key, name]) => `  ${symbol.includes("&") ? JSON.stringify(symbol) : symbol}: ${JSON.stringify(key)}, // ${name}`),
  "",
  "  // Indices",
  ...resolvedIndices.map(([symbol, key, name]) => `  ${symbol}: ${JSON.stringify(key)}, // ${name}`),
  "};",
  "",
  "/**",
  " * Symbols the master did not contain.",
  " *",
  " * Left unmapped on purpose. An instrument with no vendor key simply has no",
  " * live feed — inventing a key would produce silence at best and another",
  " * company's prices at worst.",
  " */",
  `export const UNMAPPED_SYMBOLS: readonly string[] = ${JSON.stringify(unresolved)};`,
  "",
];

fs.writeFileSync(OUTPUT, lines.join("\n"), "utf8");

console.log(`\nResolved  : ${resolved.length + resolvedIndices.length}`);
console.log(`Unresolved: ${unresolved.length}${unresolved.length ? " — " + unresolved.join(", ") : ""}`);
for (const symbol of ["RELIANCE", "HDFCBANK", "TCS", "INFY", "SUDARSCHEM"]) {
  const hit = resolved.find(([s]) => s === symbol);
  console.log(`  ${symbol.padEnd(12)} ${hit ? hit[1] : "NOT FOUND"}`);
}
console.log(`\nWrote ${path.relative(ROOT, OUTPUT)}`);
