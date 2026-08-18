/**
 * Upstox Market Data Feed V3 — the official protobuf schema, vendored.
 *
 * Copied verbatim from `upstox-js-sdk/src/feeder/proto/MarketDataFeedV3.proto`
 * (MIT, published by Upstox). Kept as a TypeScript string rather than a `.proto`
 * file on disk for one practical reason: a bundled Next.js server has no
 * reliable path back to a file inside `node_modules`, and a schema that fails
 * to load at runtime would silently stop every price.
 *
 * Not hand-written. The field numbers here are the vendor's, which is the whole
 * point — guessing them would decode plausible-looking nonsense.
 *
 * Regenerate with:
 *   node scripts/refresh-upstox-proto.mjs
 */
export const MARKET_DATA_FEED_V3_PROTO = String.raw`
syntax = "proto3";
package com.upstox.marketdatafeederv3udapi.rpc.proto;

message LTPC {
  double ltp = 1;
  int64 ltt = 2;
  int64 ltq = 3;
  double cp = 4;
}

message MarketLevel {
  repeated Quote bidAskQuote = 1;
}

message MarketOHLC {
  repeated OHLC ohlc = 1;
}

message Quote {
  int64 bidQ = 1;
  double bidP = 2;
  int64 askQ = 3;
  double askP = 4;
}

message OptionGreeks {
  double delta = 1;
  double theta = 2;
  double gamma = 3;
  double vega = 4;
  double rho = 5;
}

message OHLC {
  string interval = 1;
  double open = 2;
  double high = 3;
  double low = 4;
  double close = 5;
  int64 vol = 6;
  int64 ts = 7;
}

enum Type{
  initial_feed = 0;
  live_feed = 1;
  market_info = 2;
}

message MarketFullFeed{
  LTPC ltpc = 1;
  MarketLevel marketLevel = 2;
  OptionGreeks optionGreeks = 3;
  MarketOHLC marketOHLC = 4;
  double atp = 5; //avg traded price
  int64 vtt = 6; //volume traded today
  double oi = 7; //open interest
  double iv = 8; //implied volatility 
  double tbq =9; //total buy quantity
  double tsq = 10; //total sell quantity
}

message IndexFullFeed{
  LTPC ltpc = 1;
  MarketOHLC marketOHLC = 2;
}


message FullFeed {
  oneof FullFeedUnion {
    MarketFullFeed marketFF = 1;
    IndexFullFeed indexFF = 2;
  }
}

message FirstLevelWithGreeks{
  LTPC ltpc = 1;
  Quote firstDepth = 2;
  OptionGreeks optionGreeks = 3;
  int64 vtt = 4; //volume traded today
  double oi = 5; //open interest
  double iv = 6; //implied volatility 
}

message Feed {
  oneof FeedUnion {
    LTPC ltpc = 1;
    FullFeed fullFeed = 2;
    FirstLevelWithGreeks firstLevelWithGreeks = 3;
  }
  RequestMode requestMode = 4;
}

enum RequestMode {
  ltpc = 0;
  full_d5 = 1;
  option_greeks = 2;
  full_d30 = 3;
}

enum MarketStatus {
  PRE_OPEN_START = 0;
  PRE_OPEN_END = 1;
  NORMAL_OPEN = 2;
  NORMAL_CLOSE = 3;
  CLOSING_START = 4;
  CLOSING_END = 5;
}


message MarketInfo {
  map<string, MarketStatus> segmentStatus = 1;
}

message FeedResponse{
  Type type = 1;
  map<string, Feed> feeds = 2;
  int64 currentTs = 3;
  MarketInfo marketInfo = 4;
}
`;
