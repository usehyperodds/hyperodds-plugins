// The public Hyperodds read API (https://api.usehyperodds.com): plain tRPC GETs, no key.
// No Raycast imports here, so tests and scripts/live.ts run this file in plain Node.

export const API = "https://api.usehyperodds.com";
export const SITE = "https://usehyperodds.com";
const TIMEOUT_MS = 10_000;
// A tRPC batch takes at most ten calls, so pins fit in one request.
export const MAX_PINS = 10;

export type Side = 0 | 1;
export type Status = "open" | "live" | "awaiting" | "settled" | "removed";

export interface Fair {
  p: number;
  lo: number;
  hi: number;
  method: string;
  singleSource: boolean;
  confidence: number;
  flags: string[];
  ts: number;
}

export interface Edge {
  refUsd: number;
  buy0: number | null;
  buy1: number | null;
  sell0: number | null;
  sell1: number | null;
  best: { side: Side; action: "buy"; pts: number } | null;
}

export interface Market {
  outcome: number;
  questionId: number | null;
  role: "standalone" | "named" | "fallback";
  deployer: string;
  deployerName: string;
  kind: string;
  title: string;
  label: string;
  questionTitle: string | null;
  sideLabels: [string, string];
  category: string;
  subcategory: string | null;
  eventTime: number | null;
  deadline: number | null;
  timing?: { settles: number | null; starts: number | null; by: number | null } | null;
  listedAt: number | null;
  status: Status;
  settledSide: Side | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spread: number | null;
  depthUsd: { bid: number; ask: number };
  volume24h: number;
  trades24h: number;
  lastPx: number | null;
  change24h: number | null;
  fair: Fair | null;
  edge: Edge | null;
  settlementRisk: { settledBy: "protocol" | "deployer"; level: "low" | "medium" | "high"; note: string };
}

export interface Pinned {
  outcome: number;
  // null once the API no longer holds the market: removed, or settled more than six hours ago.
  market: Market | null;
}

export interface SearchOptions {
  q?: string;
  category?: string;
  limit?: number;
}

type Fetch = typeof globalThis.fetch;

interface TrpcAnswer {
  result?: { data: unknown };
  error?: { message?: string; data?: { code?: string; httpStatus?: number } };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfter: number;

  constructor(
    message: string,
    {
      status = 0,
      code = null,
      retryAfter = 0,
      cause,
    }: { status?: number; code?: string | null; retryAfter?: number; cause?: unknown } = {},
  ) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

// Open views refresh this often. After failures in a row the next try waits as long as the API's
// Retry-After asks, and at least 30 seconds, doubling up to two minutes.
export const REFRESH_MS = 15_000;

export function retryDelay(failures: number, error: unknown): number {
  const backoff = Math.min(REFRESH_MS * 2 ** failures, 120_000);
  return Math.max(backoff, error instanceof ApiError ? error.retryAfter * 1000 : 0);
}

export function marketUrl(outcome: number): string {
  return `${SITE}/m/${outcome}`;
}

// A market link from the console, or an outcome id written "#41294": that market and nothing else.
export function parseOutcome(text: string): number | null {
  const t = text.trim();
  const m = /^#(\d{1,9})$/.exec(t) ?? /usehyperodds\.com\/m\/(\d{1,9})(?:[/?#]|$)/.exec(t);
  return m ? Number(m[1]) : null;
}

const UNREADABLE = "Hyperodds sent an answer the extension can't read. Try again in a minute.";

// Retry-After in seconds, sent as seconds or as an HTTP date.
export function retryAfterSeconds(header: string | null, now = Date.now()): number {
  if (!header?.trim()) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const at = Date.parse(header);
  return Number.isNaN(at) ? 0 : Math.max(0, Math.ceil((at - now) / 1000));
}

// An answer without the API's own error, from a proxy or firewall in front of it.
function bareMessage(status: number, wait: number): string {
  const when = wait > 0 ? `in ${wait} second${wait === 1 ? "" : "s"}` : "in a minute";
  if (status === 403) return "Hyperodds refused the request.";
  if (status === 429) return `Hyperodds is getting too many requests. Try again ${when}.`;
  if (status === 500) return `Something went wrong at Hyperodds. Try again ${when}.`;
  if (status >= 502 && status <= 504) return `Hyperodds is unavailable right now. Try again ${when}.`;
  return `Hyperodds answered ${status}.`;
}

// A call inside a batch carries its own status; the batch's own is 207 when the calls differ.
function failure(answer: TrpcAnswer | null, res: Response): ApiError {
  const retryAfter = retryAfterSeconds(res.headers.get("retry-after"));
  const error = answer?.error;
  if (!error)
    return new ApiError(res.ok ? UNREADABLE : bareMessage(res.status, retryAfter), {
      status: res.status,
      retryAfter,
    });
  return new ApiError(error.message ?? `Hyperodds answered ${res.status}.`, {
    status: error.data?.httpStatus ?? res.status,
    code: error.data?.code ?? null,
    retryAfter,
  });
}

function summaryOf(data: unknown): Market {
  const summary = (data as { summary?: Market } | null)?.summary;
  if (typeof summary?.outcome !== "number") throw new ApiError(UNREADABLE);
  return summary;
}

export interface ClientOptions {
  base?: string;
  fetch?: Fetch;
  timeoutMs?: number;
}

export function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createClient({
  base = API,
  fetch = globalThis.fetch,
  timeoutMs = TIMEOUT_MS,
}: ClientOptions = {}) {
  // The timeout covers the whole answer, body included. The timer is our own: the one behind
  // AbortSignal.timeout is unref'd on Node 22, so a pending request alone would not hold the process.
  async function get(url: string, signal?: AbortSignal): Promise<{ res: Response; body: unknown }> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new DOMException("timed out", "TimeoutError")), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { accept: "application/json", "user-agent": "hyperodds-raycast" },
        signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
      });
      return { res, body: readJson(await res.text()) };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timeout.signal.aborted)
        throw new ApiError("Hyperodds took too long to answer. Try again.", { cause: error });
      throw new ApiError("Can't reach Hyperodds. Check your connection.", { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  async function query(path: string, input?: unknown, signal?: AbortSignal): Promise<unknown> {
    const qs = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    const { res, body } = await get(`${base}/trpc/${path}${qs}`, signal);
    const answer = body as TrpcAnswer | null;
    if (res.ok && answer?.result) return answer.result.data;
    throw failure(answer, res);
  }

  async function rows(path: string, input: unknown, signal?: AbortSignal): Promise<Market[]> {
    const data = await query(path, input, signal);
    if (!Array.isArray(data)) throw new ApiError(UNREADABLE);
    return data;
  }

  // A question's fallback outcome ("Other") has no book on Hyperliquid, so lists leave it out.
  async function tradable(path: string, input: unknown, signal?: AbortSignal): Promise<Market[]> {
    return (await rows(path, input, signal)).filter((m) => m.role !== "fallback");
  }

  async function market(outcome: number, signal?: AbortSignal): Promise<Market | null> {
    try {
      return summaryOf(await query("markets.get", { outcome }, signal));
    } catch (error) {
      if (error instanceof ApiError && error.code === "NOT_FOUND") return null;
      throw error;
    }
  }

  return {
    // Busiest first. A market link or "#id" looks that market up instead. Bare digits are both: the
    // market with that id first, then the markets whose text matches ("2026", "500").
    async search(
      { q = "", category, limit = 50 }: SearchOptions = {},
      signal?: AbortSignal,
    ): Promise<Market[]> {
      const text = q.trim();
      const outcome = parseOutcome(text);
      if (outcome !== null) {
        const found = await market(outcome, signal);
        return found ? [found] : [];
      }
      const input: SearchOptions = { limit };
      if (text) input.q = text.slice(0, 100);
      if (category) input.category = category;
      const list = tradable("markets.list", input, signal);
      if (!/^\d{1,9}$/.test(text)) return list;
      const [found, matches] = await Promise.all([market(Number(text), signal), list]);
      return found ? [found, ...matches.filter((m) => m.outcome !== found.outcome)] : matches;
    },

    // The categories the console's scanner offers: those with markets right now, largest first.
    async categories(signal?: AbortSignal): Promise<string[]> {
      const data = (await query("markets.facets", undefined, signal)) as { categories?: unknown } | null;
      if (!Array.isArray(data?.categories)) throw new ApiError(UNREADABLE);
      return data.categories.flatMap((c: { key?: unknown } | null) =>
        typeof c?.key === "string" ? [c.key] : [],
      );
    },

    edges(limit = 50, signal?: AbortSignal): Promise<Market[]> {
      return rows("markets.edges", { limit }, signal);
    },

    newest(limit = 50, signal?: AbortSignal): Promise<Market[]> {
      return tradable("markets.newest", { limit }, signal);
    },

    // Every pinned market in one batched request, in pin order.
    async pinned(outcomes: number[], signal?: AbortSignal): Promise<Pinned[]> {
      const ids = outcomes.slice(0, MAX_PINS);
      if (!ids.length) return [];
      const paths = ids.map(() => "markets.get").join(",");
      const input = Object.fromEntries(ids.map((outcome, i) => [i, { outcome }]));
      const qs = `batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
      const { res, body } = await get(`${base}/trpc/${paths}?${qs}`, signal);
      if (!Array.isArray(body)) throw failure(body as TrpcAnswer | null, res);
      const answers = body as TrpcAnswer[];
      return ids.map((outcome, i) => {
        const answer = answers[i];
        if (answer?.result) return { outcome, market: summaryOf(answer.result.data) };
        if (answer?.error?.data?.code === "NOT_FOUND") return { outcome, market: null };
        throw failure(answer ?? null, res);
      });
    },
  };
}

export const api = createClient();
