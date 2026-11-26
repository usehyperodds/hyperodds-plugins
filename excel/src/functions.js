import { createFeed } from "./feed.js";

const QUOTES = ["mid", "bid", "ask", "last"];
/** As in the console: a book wider than 10 points has no mid, because its halfway point is nobody's price. */
const MAX_MID_SPREAD = 0.1;
const WIDE = 'No mid: the bid and ask are more than 10 points apart. Ask for "bid" or "ask".';
const EMPTY = {
  mid: "No price: one side of the book is empty.",
  bid: "No bid right now.",
  ask: "No ask right now.",
  last: "No trade yet.",
};

export const COLUMNS = [
  "Outcome",
  "Market",
  "Status",
  "Deployer",
  "Side",
  "Bid (¢)",
  "Ask (¢)",
  "Fair (¢)",
  "Edge side",
  "Edge (pts)",
  "Volume 24h (contracts)",
  "Starts (UTC)",
  "Settles (UTC)",
];

// Excel's error type, for running the functions outside Excel: the public page, Node and the tests.
// office.js defines CustomFunctions in any browser but adds Error only inside Excel, so it is read per call.
const standIn = {
  ErrorCode: { invalidValue: "#VALUE!", notAvailable: "#N/A" },
  Error: class {
    constructor(code, message) {
      this.code = code;
      this.message = message;
    }
  },
};

let feed = null;

// Excel gets one feed per workbook; the tests and the Node example hand in their own.
export function useFeed(next) {
  feed = next;
}

export function currentFeed() {
  feed ??= createFeed();
  return feed;
}

function fail(code, message) {
  const runtime = globalThis.CustomFunctions?.Error ? globalThis.CustomFunctions : standIn;
  return new runtime.Error(runtime.ErrorCode[code], message);
}

// As the console rounds (round() in its core format module): half away from zero, read as the decimal the
// number prints as. toFixed rounds a half tick as the double holds it, so 56.1885 gave 56.188; this gives
// 56.189, as the console and the Google Sheets functions do.
function round(x, decimals) {
  const [m, e = "0"] = Math.abs(x).toPrecision(15).split("e");
  const r = Math.round(Number(`${m}e${Number(e) + decimals}`)) / 10 ** decimals;
  return x < 0 ? -r : r;
}

// Prices are 0 to 1 on the API and cents here, to the console's 0.001¢ tick.
const cents = (p) => (p === null || p === undefined ? null : round(p * 100, 3));
const flip = (p) => (p === null ? null : 1 - p);
const points = (x) => Math.round(x * 100) / 100;
const blank = (value) => value === null || value === undefined || value === "";
// Text, not Excel dates: a custom function can't set its cell's number format, so a date would show as
// a serial number such as 46348.75.
const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

// duration from the console (apps/web/lib/format.ts): "45s", "3h 12m", "4d 3h".
function duration(ms) {
  const s = Math.max(0, Math.round(Math.abs(ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo` : `${Math.floor(d / 365)}y`;
}

export function outcomeOf(value) {
  if (Number.isInteger(value) && value >= 0) return value;
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(/^(?:(?:https?:\/\/)?(?:www\.)?usehyperodds\.com\/m\/)?(\d{1,9})\/?(?:[?#].*)?$/i);
  return match ? Number(match[1]) : null;
}

// settleTiming from the console (packages/core/src/types.ts), copied so the table times a market as its page does.
const PRICE_KINDS = new Set(["price_binary", "price_bucket", "price_touch"]);

function settleTiming(kind, { eventTime, deadline }) {
  if (!PRICE_KINDS.has(kind)) return { settles: null, starts: eventTime, by: deadline };
  if (eventTime !== null && (deadline === null || deadline === eventTime)) {
    return { settles: eventTime, starts: null, by: null };
  }
  return { settles: null, starts: null, by: deadline ?? eventTime };
}

function sideOf(value, summary) {
  if (blank(value)) return 0;
  if (value === 0 || value === 1) return value;
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  const named = summary.sideLabels.findIndex((label) => label.toLowerCase() === text);
  if (named >= 0) return named;
  return { 0: 0, 1: 1, yes: 0, no: 1 }[text] ?? null;
}

const badSide = (s) => fail("invalidValue", `Use 0 or 1, or "${s.sideLabels.join('" or "')}", for the side.`);

const REASONS = {
  offline: "You're offline. Cells fill in once you're back online.",
  blocked: "The browser blocked Hyperodds' answer (CORS). Retrying.",
  unreachable: "Can't reach Hyperodds. Retrying.",
  unavailable: "Hyperodds is unavailable right now. Retrying.",
};

function unavailable(error) {
  if (!error)
    return fail("notAvailable", "No market with this id. Hyperodds keeps settled markets for six hours.");
  if (error.since) {
    return fail(
      "notAvailable",
      `No update from Hyperodds since ${utc(error.since).slice(11)} UTC. Retrying.`,
    );
  }
  if (error.kind === "rate-limited") {
    const wait = error.retryAfter ? `Retrying in ${error.retryAfter} s.` : "Retrying.";
    return fail("notAvailable", `Too many requests from this address. ${wait}`);
  }
  return fail("notAvailable", REASONS[error.kind] ?? REASONS.unavailable);
}

function closed(s) {
  if (s.status === "removed") return fail("notAvailable", "This market was removed.");
  if (s.status === "settled") return fail("notAvailable", "This market has settled.");
  return null;
}

function priceOf(s, side, quote) {
  if (s.status === "settled" && s.settledSide !== null) return s.settledSide === side ? 100 : 0;
  const gone = closed(s);
  if (gone) return gone;
  if (s.role === "fallback") return fail("notAvailable", "This outcome has no order book on Hyperliquid.");
  const book =
    side === 0
      ? { mid: s.mid, bid: s.bid, ask: s.ask, last: s.lastPx }
      : { mid: flip(s.mid), bid: flip(s.ask), ask: flip(s.bid), last: flip(s.lastPx) };
  const px = book[quote];
  if (px === null) return fail("notAvailable", EMPTY[quote]);
  if (quote === "mid" && s.bid !== null && s.ask !== null && s.ask - s.bid > MAX_MID_SPREAD + 1e-9)
    return fail("notAvailable", WIDE);
  return cents(px);
}

function fairOf(s, side) {
  const gone = closed(s);
  if (gone) return gone;
  if (!s.fair) return fail("notAvailable", "No fair line for this market right now.");
  return cents(side === 0 ? s.fair.p : 1 - s.fair.p);
}

function edgeOf(s, side) {
  const gone = closed(s);
  if (gone) return gone;
  if (!s.edge) return fail("notAvailable", "No edge for this market right now.");
  const pts = side === null ? s.edge.best?.pts : s.edge[`buy${side}`];
  if (pts === null || pts === undefined) {
    return fail(
      "notAvailable",
      side === null
        ? "Neither side fills a $100 buy right now."
        : "A $100 buy of this side doesn't fill right now.",
    );
  }
  return points(pts);
}

// Labelled as the market page labels them: Decision, Starts while ahead, then Started.
function times(s, t, now) {
  const label = s.kind === "policy_rate" ? "Decision" : t.starts > now ? "Starts" : "Started";
  const starts = t.starts === null ? "" : `${label} ${utc(t.starts)}`;
  if (t.settles !== null) return [starts, `at ${utc(t.settles)}`];
  return [starts, t.by === null ? "" : `by ${utc(t.by)}`];
}

// The status a PRICE cell can't show: a number can't say the market is in play or overdue.
function statusOf(s, t, now) {
  if (s.status === "settled") return "Settled";
  if (s.status === "awaiting") {
    const due = t.settles ?? t.by;
    return due === null ? "Settlement was due" : `Settlement was due ${duration(now - due)} ago`;
  }
  if (s.status === "live") {
    const game = s.kind !== "policy_rate" && t.starts !== null && t.starts <= now;
    return game ? `Started ${duration(now - t.starts)} ago` : "In play";
  }
  return "Open";
}

function row(s) {
  const best = s.edge?.best;
  const t = settleTiming(s.kind, s);
  const now = Date.now();
  return [
    s.outcome,
    s.title,
    statusOf(s, t, now),
    s.deployerName,
    s.sideLabels[0],
    cents(s.bid) ?? "",
    cents(s.ask) ?? "",
    cents(s.fair?.p) ?? "",
    best ? s.sideLabels[best.side] : "",
    best ? points(best.pts) : "",
    s.volume24h,
    ...times(s, t, now),
  ];
}

const keyOf = (value) =>
  typeof value === "object" && !Array.isArray(value)
    ? `${value.code}|${value.message}`
    : JSON.stringify(value);

// Sends a value to the cell only when it changed, so a quiet market doesn't make Excel recalculate.
function sender(invocation) {
  let last;
  return (value) => {
    const key = keyOf(value);
    if (key === last) return;
    last = key;
    invocation.setResult(value);
  };
}

function stream(invocation, outcome, read) {
  const id = outcomeOf(outcome);
  if (id === null) {
    return invocation.setResult(
      fail(
        "invalidValue",
        "Use an outcome id (the number at the end of a market's link) or the link itself.",
      ),
    );
  }
  const send = sender(invocation);
  invocation.onCanceled = currentFeed().watch(id, (summary, error) =>
    send(summary ? read(summary) : unavailable(error)),
  );
}

/**
 * Live price of one side of a HIP-4 market, in cents from 0 to 100. Updates as the book moves; a settled market shows 100 for the side that won and 0 for the other.
 * @customfunction PRICE
 * @helpurl https://excel.usehyperodds.com/index.html#price
 * @param {any} outcome Outcome id (the number at the end of a market's link) or the link itself.
 * @param {any} [side] 0 or "Yes" (the default), 1 or "No", or the side's name.
 * @param {string} [quote] "mid" (the default), "bid", "ask" or "last".
 * @param {CustomFunctions.StreamingInvocation<number>} invocation
 */
export function price(outcome, side, quote, invocation) {
  const kind = blank(quote) ? "mid" : String(quote).trim().toLowerCase();
  if (!QUOTES.includes(kind)) {
    return invocation.setResult(fail("invalidValue", 'Use "mid", "bid", "ask" or "last" for the quote.'));
  }
  stream(invocation, outcome, (s) => {
    const n = sideOf(side, s);
    return n === null ? badSide(s) : priceOf(s, n, kind);
  });
}

/**
 * Hyperodds fair line for one side of a HIP-4 market, in cents: its estimate of the chance that side wins.
 * @customfunction FAIR
 * @helpurl https://excel.usehyperodds.com/index.html#fair
 * @param {any} outcome Outcome id (the number at the end of a market's link) or the link itself.
 * @param {any} [side] 0 or "Yes" (the default), 1 or "No", or the side's name.
 * @param {CustomFunctions.StreamingInvocation<number>} invocation
 */
export function fair(outcome, side, invocation) {
  stream(invocation, outcome, (s) => {
    const n = sideOf(side, s);
    return n === null ? badSide(s) : fairOf(s, n);
  });
}

/**
 * Edge in points for a $100 buy of one side: the fair line minus the price you'd pay at the ask, fees included. Leave the side out for the better of the two.
 * @customfunction EDGE
 * @helpurl https://excel.usehyperodds.com/index.html#edge
 * @param {any} outcome Outcome id (the number at the end of a market's link) or the link itself.
 * @param {any} [side] 0 or "Yes", 1 or "No", or the side's name. Leave it out for the better side.
 * @param {CustomFunctions.StreamingInvocation<number>} invocation
 */
export function edge(outcome, side, invocation) {
  stream(invocation, outcome, (s) => {
    if (blank(side)) return edgeOf(s, null);
    const n = sideOf(side, s);
    return n === null ? badSide(s) : edgeOf(s, n);
  });
}

/**
 * Live table of HIP-4 markets matching a search, busiest first. Its first column holds the outcome ids that PRICE, FAIR and EDGE take.
 * @customfunction MARKET
 * @helpurl https://excel.usehyperodds.com/index.html#market
 * @param {string} [search] Words to look for, such as "btc", "fed" or "arsenal". Leave it empty for every market.
 * @param {number} [limit] Most rows to show, from 1 to 100. The default is 20.
 * @param {CustomFunctions.StreamingInvocation<any[][]>} invocation
 */
export function market(search, limit, invocation) {
  const q = blank(search) ? "" : String(search).trim();
  const rows = blank(limit) ? 20 : limit;
  if (!Number.isInteger(rows) || rows < 1 || rows > 100) {
    return invocation.setResult(fail("invalidValue", "Use a whole number from 1 to 100 for the limit."));
  }
  if (q.length > 100)
    return invocation.setResult(fail("invalidValue", "Keep the search to 100 characters or fewer."));
  const send = sender(invocation);
  invocation.onCanceled = currentFeed().search({ q, limit: rows }, (list, error) => {
    if (!list) return send(unavailable(error));
    if (!list.length) {
      return send(fail("notAvailable", q ? `No live market matches "${q}".` : "No live markets right now."));
    }
    send([COLUMNS, ...list.map(row)]);
  });
}
