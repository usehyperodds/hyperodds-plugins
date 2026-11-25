import type { Market } from "../src/lib/api.ts";

// Built from market summaries production answered on 2026-11-20; the variants change only what a test needs.
export const NOW = Date.UTC(2026, 10, 20, 11, 55);

export const btc: Market = {
  outcome: 41294,
  questionId: null,
  role: "standalone",
  deployer: "hl",
  deployerName: "Hyperliquid",
  kind: "price_binary",
  title: "BTC above 61,908 at Nov 21 06:00 UTC",
  label: "BTC above 61,908 at Nov 21 06:00 UTC",
  questionTitle: null,
  sideLabels: ["Yes", "No"],
  category: "crypto",
  subcategory: "BTC",
  eventTime: 1795240800000,
  deadline: 1795240800000,
  listedAt: 1795154417237,
  status: "open",
  settledSide: null,
  bid: 0.459,
  ask: 0.464,
  mid: 0.4615,
  spread: 0.005,
  depthUsd: { bid: 8397.36538, ask: 9283.72534 },
  volume24h: 89328,
  trades24h: 1174,
  lastPx: 0.464,
  change24h: -0.04349,
  fair: {
    p: 0.521156,
    lo: 0.51995,
    hi: 0.522442,
    method: "options",
    singleSource: false,
    confidence: 0.6,
    flags: ["far-from-listed-expiry"],
    ts: 1795175693012,
  },
  edge: {
    refUsd: 100,
    buy0: 5.313538,
    buy1: -6.249079,
    sell0: -6.257109,
    sell1: 5.344044,
    best: { side: 0, action: "buy", pts: 5.313538 },
  },
  settlementRisk: { settledBy: "protocol", level: "low", note: "Settled by the protocol." },
};

export const game: Market = {
  ...btc,
  outcome: 39392,
  deployer: "out",
  deployerName: "Outcome",
  kind: "contest_winner",
  title: "Carolina Panthers vs Baltimore Ravens",
  label: "CAR vs BAL",
  sideLabels: ["CAR", "BAL"],
  category: "sports",
  subcategory: "NFL",
  eventTime: 1795370400000,
  deadline: 1803319200000,
  listedAt: null,
  bid: 0.58343,
  ask: 0.58344,
  mid: 0.583435,
  spread: 0.00001,
  lastPx: 0.58343,
  change24h: 0.012595,
  fair: null,
  edge: null,
  settlementRisk: {
    settledBy: "deployer",
    level: "medium",
    note: "Settled by Outcome's key; 507,658 HYPE staked.",
  },
};

export const bucket: Market = {
  ...btc,
  outcome: 41301,
  questionId: 4130,
  role: "named",
  kind: "price_bucket",
  title: "BTC price at Nov 21 06:00 UTC: Above 63,146",
  label: "Above 63,146",
  questionTitle: "BTC price at Nov 21 06:00 UTC",
};

export const fed: Market = {
  ...btc,
  outcome: 19988,
  role: "named",
  deployer: "out",
  deployerName: "Outcome",
  kind: "policy_rate",
  title: "Federal Open Market Committee rate decision, December 2026: No change",
  label: "No change",
  category: "macro",
  subcategory: "Federal Open Market Committee",
  // The decision, and the latest it settles.
  eventTime: 1796842800000,
  deadline: 1801076400000,
  settlementRisk: game.settlementRisk,
};

export const touch: Market = {
  ...btc,
  outcome: 22090,
  kind: "price_touch",
  title: "HYPE touches 90 by Dec 1 00:00 UTC",
  subcategory: "HYPE",
  // A touch has no price time, only the deadline it settles by.
  eventTime: null,
  deadline: 1796083200000,
  // A book wider than ten points, where the mid means little.
  bid: 0.02,
  ask: 0.25,
  mid: 0.135,
  spread: 0.23,
  lastPx: 0.03774,
  edge: {
    refUsd: 100,
    buy0: -3.394914,
    buy1: 1.657487,
    sell0: null,
    sell1: -2.315429,
    best: { side: 1, action: "buy", pts: 1.657487 },
  },
};

export const ipo: Market = {
  ...btc,
  outcome: 8568,
  kind: "ipo_market_cap",
  title: "Anthropic first-day market cap above $2,000B",
  category: "ipo",
  subcategory: "Anthropic",
  eventTime: null,
  deadline: 1798761600000,
};

export const settled: Market = { ...btc, status: "settled", settledSide: 1 };

// A tRPC answer as the API sends it.
export function trpc(data: unknown) {
  return { result: { data } };
}

export function trpcError(message: string, code: string, httpStatus: number) {
  return { error: { message, code: -32000, data: { code, httpStatus } } };
}

interface Call {
  url: URL;
  init: RequestInit | undefined;
}

// A fetch that answers from a handler and records every call.
export function fakeFetch(
  handler: (url: URL) => { status?: number; body: unknown; headers?: Record<string, string> },
) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const { status = 200, body, headers } = handler(url);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "content-type": "application/json", ...headers } });
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

export function input(url: URL): unknown {
  const raw = url.searchParams.get("input");
  return raw === null ? undefined : JSON.parse(raw);
}
