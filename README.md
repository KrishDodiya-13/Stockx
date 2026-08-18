# Parallel

A paper-trading and market-simulation terminal for the Indian equity market.

**Paper trading only.** Every rupee, order, holding and P&L figure in this
application is virtual. Nothing here reaches an exchange or a broker, no order
moves real money, and no account can hold, receive or transfer real funds. The
product is a simulator for learning and testing ideas — not a brokerage, and not
financial advice.

Every user starts with ₹10,00,000 in virtual capital.

---

## Contents

- [Architecture](#architecture)
- [Database schema](#database-schema)
- [API routes](#api-routes)
- [Environment variables](#environment-variables)
- [Running locally](#running-locally)
- [Building](#building)
- [Deploying](#deploying)
- [Testing](#testing)
- [Known limitations](#known-limitations)
- [Future improvements](#future-improvements)

---

## Architecture

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 ·
Prisma + PostgreSQL · GSAP + Lenis + Framer Motion · Vitest.

204 TypeScript files, ~32,700 lines, 406 tests across 20 suites.

### The shape of it

```
src/
├── app/
│   ├── (app)/              Authenticated terminal. Server-gated in layout.tsx.
│   ├── (auth)/             Sign-in / sign-up. No navigation, no market data.
│   ├── api/                Route handlers (see API routes below)
│   │   └── _lib/           requireAccount, rate limiting, shared responses
│   ├── page.tsx            Public landing page
│   └── globals.css         Design tokens, theme palettes, motion resets
├── components/             UI, grouped by feature (chart, trade, strategy, …)
├── config/                 env access, navigation, command registry
├── domain/                 Types + constants shared by client and server
├── hooks/                  React glue (portfolio, parallax, reduced motion)
├── lib/                    money, format, cn, shortcuts, session-expiry
└── services/               The engines. No React, no Prisma unless stated.
    ├── analysis/           Trade review (provider abstraction)
    ├── auth/               password, session, redirect validation
    ├── backtest/           Bar-by-bar historical replay
    ├── dna/                Trading-style analysis
    ├── gamification/       Scoring, challenges, achievements
    ├── indicators/         RSI, MACD, MA, Bollinger
    ├── market-data/        Provider abstraction + mock/live adapters
    ├── replay/             Round-trip reconstruction
    ├── risk/               Position sizing and risk maths
    ├── strategy/           Rule engine + execution runner
    └── trading/            Order validation, fills, portfolio valuation
```

### Principles the code actually follows

**Money is never a float.** All amounts are integer **paise** (1/100 rupee),
all per-share prices integer **PriceE4** (1/10,000 rupee), carried as branded
TypeScript types so a price cannot be passed where an amount belongs. Floating
point appears only at the display boundary. Rounding is half-away-from-zero,
in one place ([src/lib/money.ts](src/lib/money.ts)).

**The server owns every number that matters.** Execution prices come from the
market-data service on the server, never from the request body. A client that
sends `price`, `executionPrice` or `accountId` is ignored.

**Authorization is structural, not remembered.** Every account-scoped route
resolves its caller through `requireAccount`
([src/app/api/_lib/guard.ts](src/app/api/_lib/guard.ts)), which derives the
account from a signed session cookie. No route accepts an account id as a
parameter, so cross-account access is not a filter someone might forget — it is
unrepresentable.

**Engines are pure; persistence is a boundary.** `trading-engine`,
`strategy-engine`, `backtest-engine`, `replay-engine`, `dna-engine`,
`risk-calculator` and `scoring` contain no I/O and are tested exhaustively.
`order-service` and `strategy-runner` are the transactional layer around them.

**Providers are swappable.** `MarketDataProvider` and `TradeAnalysisProvider`
are interfaces with mock and live implementations chosen at a composition root.
Secrets stay server-side; `serverEnv` throws if touched from a browser bundle.

**Simulated data is labelled as simulated.** The mock provider is marked
`source: "simulated"` at the data layer and surfaced as a badge in the UI. If a
live provider is configured but unreachable, the app reports it as offline
rather than silently serving simulated prices as real ones.

### Transactional integrity

A fill is atomic: order, trade, position, holding, cash and ledger entry commit
together or not at all, inside a `Serializable` transaction. Concurrent orders
cannot both pass the same cash check — the account row is re-read *inside* the
transaction. Serialization conflicts are retried with backoff rather than
surfaced as errors.

Strategy rules are claimed with an atomic conditional update
(`WHERE firedAt IS NULL`), so overlapping runner invocations cannot
double-execute a rule. Verified with 24 concurrent cycles producing exactly one
order.

---

## Database schema

PostgreSQL via Prisma. Full definition in
[prisma/schema.prisma](prisma/schema.prisma); migrations in
[prisma/migrations/](prisma/migrations/).

| Model | Purpose |
| --- | --- |
| `User` | Person. Email + scrypt `passwordHash`. |
| `Session` | Logged-in session. Stores only the SHA-256 of the token. |
| `Account` | Virtual trading account: `cashBalance`, `startingCapital`, `realisedPnl`. |
| `Holding` | Current ownership: quantity, average price, invested value. Unique per (account, instrument). |
| `Position` | A round trip — opened from flat, closed when the last share is sold. |
| `Order` | Intent. Includes rejected and resting orders with a reason. |
| `Trade` | An execution. One fill, one price. |
| `Transaction` | Cash ledger. Every movement, with the balance after it. |
| `Strategy` | Name, instrument, status, high-water price. |
| `StrategyRule` | An IF/THEN pair. `firedAt` is the duplicate-execution guard. |
| `StrategyCondition` | One condition. Units depend on type (see note below). |
| `StrategyAction` | BUY / SELL / SELL_PERCENT / SELL_ALL. |
| `StrategyExecution` | Every attempt — executed, rejected, skipped, or informational. |
| `RiskSimulation` | Stores inputs only; every derived figure is recomputed on read. |
| `Backtest` | Stores results, because re-deriving them later could differ. |

All monetary columns are `BigInt`. Money is paise; per-share prices are PriceE4.

**Condition value units.** `StrategyCondition.value` is a bare number whose unit
depends on the condition type: prices are PriceE4, percentages are plain
percent, volume is a share count. The API validates the range per unit and
rejects a price that looks like unconverted rupees.

### Integrity constraints

`20260816000100_money_integrity_constraints` adds 30+ CHECK constraints that the
application also enforces — because application code protects the paths you
thought of, and the database protects the ones you did not. Among them:

- cash balance and ledger balance can never be negative
- a holding is never negative; shorting is not supported
- a position can never have sold more than it bought, and `quantity` must equal `totalBought - totalSold`
- a BUY can never book realised P&L
- a transaction's sign must match its type (opening credits, buys debit, sells credit)
- an order can never fill more than it asked for
- a backtest's wins + losses cannot exceed its trade count

Every one has been verified to reject its invalid write against a live database.

---

## API routes

All account routes require a session and return **401** otherwise. Money in
responses is integer paise; prices are PriceE4.

### Auth
| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/auth` | Current user, or `{user: null}`. |
| `POST` | `/api/auth` | `action`: `signin` \| `signup` \| `signout`. Rate limited. |

### Trading
| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/api/orders` | Place an order. Price is server-side. 422 on rejection. Rate limited 60/min. |
| `GET` | `/api/orders` | Order history, newest first. |
| `GET` | `/api/trades` | Fill history. |
| `GET` | `/api/portfolio` | Cash, holdings, invested, realised/unrealised P&L. |
| `GET` | `/api/portfolio/history` | Realised equity curve. |

### Strategies
| Method | Route | Notes |
| --- | --- | --- |
| `GET` `POST` | `/api/strategies` | List / create. Always created as DRAFT. |
| `GET` `PATCH` `DELETE` | `/api/strategies/[id]` | Read / edit or transition / delete. 404 across accounts. |
| `POST` | `/api/strategies/run` | Run one evaluation cycle. Idempotent under concurrency. |
| `GET` | `/api/strategies/run` | Execution log. |

### Analysis
| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/api/backtests/run` | Run. Refuses future or inverted windows. |
| `GET` `POST` | `/api/backtests` | List / save. |
| `GET` `POST` | `/api/simulations` | Risk simulations. |
| `DELETE` | `/api/simulations/[id]` | |
| `GET` | `/api/replay` | Round trips. |
| `GET` | `/api/replay/[id]` | One trip with candles and markers. |
| `GET` | `/api/analysis/[id]` | Trade review. 422 `not_closed` for an open trip. |
| `GET` | `/api/dna` | Trading-style profile. |
| `GET` | `/api/gamification?period=` | `weekly` \| `monthly` \| `all-time`. No account ids or emails leave the server. |

### Market data (no session required)
| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/timemachine/candles` | Requires `instrumentId`, `start` (epoch ms), `interval`, `cursor` (bars). Returns only bars up to the cursor. |
| `GET` | `/api/market-data/quotes` | Live-provider proxy. 503 when unconfigured. |
| `GET` | `/api/market-data/stream-url` | Mints a feed URL; the key never appears in the response. Rate limited. |

---

## Environment variables

Copy [.env.example](.env.example) to `.env`. Nothing prefixed `NEXT_PUBLIC_` may
ever hold a secret.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | For trading | PostgreSQL connection string. Prisma reads `.env`, not `.env.local`. |
| `MARKET_DATA_ADAPTER` | No | `mock` (default) or `live`. |
| `NEXT_PUBLIC_MARKET_DATA_MODE` | No | `simulated` (default) or `live`. Drives the data-source badge. Mode flag only. |
| `MARKET_DATA_API_KEY` | Live only | **Server only.** |
| `MARKET_DATA_API_SECRET` | Live only | **Server only.** |
| `MARKET_DATA_WS_URL` | Live only | **Server only.** |
| `ANALYSIS_API_KEY` | No | Optional model provider for trade reviews. Without it a deterministic local reviewer is used — the full experience, not a degraded one. **Server only.** |

**Authentication needs no secret.** Sessions are random 256-bit tokens stored
hashed; there is no signing key to leak or rotate.

Without `DATABASE_URL` the app still runs — market data, charts, the risk
simulator and the landing page all work — but trading routes return 503 and the
portfolio shows setup instructions instead of balances.

---

## Running locally

```bash
# 1. Install
npm install

# 2. Create a database
createdb parallel

# 3. Configure
cp .env.example .env
#    then set DATABASE_URL, e.g.
#    DATABASE_URL="postgresql://postgres:PASSWORD@localhost:5432/parallel?schema=public"

# 4. Create the schema (includes the integrity constraints)
npx prisma migrate deploy      # or `migrate dev` while developing

# 5. Run
npm run dev
```

Open <http://localhost:3000>, create an account, and you are funded with
₹10,00,000 in virtual capital.

There is no seed script and no demo account, by design: the leaderboard shows
real accounts only, so an empty install has an empty board rather than a padded
one.

## Building

```bash
npm run typecheck    # tsc --noEmit
npm run lint
npm run test         # 406 tests
npm run build
npm start            # serves the production build on :3000
```

All four gates should pass before a deploy. `npm run build` requires
`DATABASE_URL` to be set only if you want Prisma's generated client to match a
live schema; the build itself does not connect.

## Deploying

Any Node host that can run `next start`, plus a PostgreSQL database.

```bash
npx prisma migrate deploy    # run once per release, before the new build serves
npm run build
npm start
```

Checklist:

1. **Serve over HTTPS.** The session cookie sets `Secure` when
   `NODE_ENV=production`, and browsers will not send a `Secure` cookie over
   plain HTTP — sign-in silently fails on an http origin.
2. **Set `DATABASE_URL`** to a Postgres instance the app can reach, and run
   migrations before the new build takes traffic.
3. **Do not set market-data secrets client-side.** Only
   `NEXT_PUBLIC_MARKET_DATA_MODE` is a public variable.
4. **Rate limiting is per-process and in-memory.** Behind more than one
   instance each replica enforces its own limit, and a restart clears every
   counter. See limitations.
5. **Sessions are database-backed**, so they survive restarts and are shared
   across instances. `pruneExpiredSessions()` exists for a periodic job;
   expired sessions are also deleted on sight.

On Vercel, the app deploys as-is; the in-memory rate limiter is the one piece
that needs replacing before it means anything under serverless.

---

## Testing

```bash
npm run test
```

406 tests across 20 suites, covering the pure engines exhaustively: money
arithmetic and rounding, order validation and fills, the strategy rule engine,
runner decisions, backtesting, replay reconstruction, DNA, risk maths,
gamification scoring, indicators, chart maths, keyboard shortcuts, password
hashing and session tokens, rate limiting, and request validation.

React glue is not unit-tested. It has been exercised end to end against a live
PostgreSQL database over HTTP — authentication, isolation, trading, P&L
identities, strategy execution, partial exits, Time Machine clamping and the
database constraints — but not in a browser. See limitations.

---

## Known limitations

These are real, and stated because a limitation you know about is a design
decision while one you have hidden is a bug waiting to be found by a user.

**Visual verification is partial.** Development was done without a browser —
types, lint, tests, served HTML, compiled CSS and live HTTP calls against a real
database. The landing page and sign-in page have since been rendered and checked
in headless Chrome, which immediately found a bug that every prior check had
missed: every masked headline on the site was invisible, because the CSS start
state is a percentage transform that GSAP parses into pixel `y`, while the
tweens cleared only `yPercent` — animating 0 to 0. The reduced-motion and no-JS
fallbacks both reset those elements, so the only broken path was the one almost
every visitor takes, and it was the only one not being exercised.

Still unconfirmed visually: the authenticated terminal pages, chart interaction
(crosshair, zoom, pan), touch behaviour, scroll-triggered reveals below the
fold, and light theme. The responsive and theme systems are verified
structurally — breakpoints, tokens, safe-area insets and reduced-motion resets
are present and correct in the shipped CSS — which is not the same as looking
right.

**Rate limiting is per-process and in-memory.** It stops one client hammering a
route on a single instance. It does not survive a restart and is not shared
between replicas, so N instances permit N× the limit. Behind more than one
instance this needs to move to Redis; the interface is already the shape that
swap would take.

**Market data is simulated.** The mock provider generates a plausible market
locally and is labelled as simulated everywhere it surfaces. `LiveMarketDataProvider`
is a working adapter shell — it reports `offline` and returns nothing rather
than inventing prices — but no licensed vendor is connected.

**Fills are frictionless.** Orders fill instantly at the quoted price, in full.
There is no commission, no slippage, no bid/ask spread, no liquidity limit and
no partial fill. Real results would be worse than any figure this produces, and
backtests inherit the same optimism.

**Backtests are a historical simulation, labelled as such.** They exclude the
costs above and are not a prediction.

**The strategy runner is browser-driven.** Cycles run while a strategy page is
open. Nothing evaluates strategies server-side on a schedule, so a strategy does
not act while you are away. The engine is already safe for a scheduler to drive
— rule claiming is atomic — but no scheduler exists.

**The portfolio equity curve plots realised equity only.** Unrealised movement
is excluded because historical mark-to-market would require storing a price
history per holding. This is stated on the chart itself.

**Trade analysis is deterministic and local by default.** Without
`ANALYSIS_API_KEY` every sentence is generated from the trade's own figures.
It never claims a guaranteed outcome, and it declines to review an open trip.

**Strategy DNA reports style from holding periods only.** There are deliberately
no "momentum" or "value" scores: trade records capture timing, not intent, and
inferring conviction from a fill would be invention.

**No email verification, password reset, or 2FA.** Sign-up takes an address on
trust. There is no way to recover a forgotten password.

**Single account per user.** The schema supports several; nothing exposes them.

**Statistics need a minimum sample.** Ranking requires 10 closed trades, DNA
metrics 5, and group comparisons 12 — below which figures are withheld rather
than computed from noise. `profitFactor` and `riskAdjusted` return `null`
instead of `Infinity` when there are no losses.

---

## Future improvements

Roughly in the order they would pay off.

1. **Finish the browser pass.** The landing and sign-in pages are done; the
   authenticated terminal, the chart's interactions, the light theme and the
   scroll-triggered sections below the fold are not. The first hour of looking
   found a bug that hid every headline on the site, which is a fair indication
   of what the rest is still hiding.
2. **Redis-backed rate limiting**, so the limits mean something behind more than
   one instance.
3. **A server-side strategy scheduler.** The engine is ready; a cron worker
   calling `runStrategyCycle` per active account would let strategies run while
   the user is away. Needs a per-account lock to stay idempotent across workers.
4. **A licensed market-data vendor** behind the existing adapter, plus the
   short-lived token minting `stream-url` is already scaffolded for.
5. **Execution realism**: commission, a configurable spread, slippage as a
   function of order size against volume, and partial fills. Every simulated
   result gets more honest the day this lands.
6. **Password reset and email verification.**
7. **Mark-to-market portfolio history**, via a periodic snapshot of holdings
   valued at the close, replacing the realised-only equity curve.
8. **Resting limit orders that actually fill.** They persist as PENDING today
   but nothing sweeps them when the market reaches the price.
9. **Pagination.** Trade and order history are capped at a few hundred rows;
   an active account will eventually exceed that.
10. **Accessibility audit with a real screen reader**, to confirm what the
    markup implies.
11. **Multi-account support**, which the schema already allows.
12. **`playwright` end-to-end tests**, which would also close item 1
    permanently rather than once.

---

## Licence and intent

This is a simulator built for learning. It is not investment advice, not a
brokerage, and not a prediction of anything. Do not treat a result produced here
as evidence that a strategy will work with real money — the fills are perfect,
the costs are zero, and the market is not real.
