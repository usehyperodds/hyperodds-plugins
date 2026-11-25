// Display rules, matching the Hyperodds console: prices in cents ("54.2¢"), edges and changes in
// percentage points ("+3.1 pts"), times in UTC like the market titles. Locale-fixed (en-US).

import type { Market, Side, Status } from "./api.ts";
import { marketUrl } from "./api.ts";

export const DASH = "—";
const MINUS = "−";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

// A wider book than this shows the last trade instead of a mid that nobody trades at.
const WIDE_SPREAD = 0.1;
const NAME_LENGTH = 24;

const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  live: "Live",
  awaiting: "Awaiting settlement",
  settled: "Settled",
  removed: "Delisted",
};

export const CATEGORY_LABEL: Record<string, string> = {
  sports: "Sports",
  crypto: "Crypto",
  equities: "Equities",
  commodities: "Commodities",
  indices: "Indices",
  macro: "Macro",
  ipo: "IPO",
  awards: "Awards",
  other: "Other",
};

const METHOD_LABEL: Record<string, string> = {
  options: "Options-implied",
  "realized-vol": "Realized volatility",
  blend: "Options and realized volatility",
  consensus: "Matched Polymarket and Kalshi markets",
};

function finite(x: number | null | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

function signed(x: number, digits: number): string {
  const s = Math.abs(x).toFixed(digits);
  if (Number(s) === 0) return s;
  return `${x > 0 ? "+" : MINUS}${s}`;
}

// Enough decimals that a price near 0 or 1 doesn't round to the edge (HIP-4 ticks are 0.001¢).
function centDecimals(c: number): number {
  if (c === 0 || c === 100) return 0;
  if (c < 0.1 || c > 99.9) return 3;
  if (c < 1 || c > 99) return 2;
  return 1;
}

// 0.542 → "54.2¢"
export function cents(p: number | null | undefined, decimals?: number): string {
  if (!finite(p)) return DASH;
  const c = p * 100;
  return `${c.toFixed(decimals ?? centDecimals(Math.abs(c))).replace(/^-/, MINUS)}¢`;
}

// One number of decimals for a bid and an ask shown together, as the console's book does: what the
// more precise of the two needs alone, and more, up to the 0.001¢ tick, until different prices differ.
export function pairDecimals(a: number | null | undefined, b: number | null | undefined): number | undefined {
  if (!finite(a) || !finite(b)) return undefined;
  let d = Math.max(centDecimals(Math.abs(a * 100)), centDecimals(Math.abs(b * 100)));
  while (d < 3 && a !== b && (a * 100).toFixed(d) === (b * 100).toFixed(d)) d++;
  return d;
}

// 0.542 → "54.2%"
export function pct(p: number | null | undefined, digits = 1): string {
  if (!finite(p)) return DASH;
  return `${(p * 100).toFixed(digits)}%`;
}

// 3.14 → "+3.1 pts". Edges arrive in points already; 24-hour changes arrive as prices (× 100).
export function pts(x: number | null | undefined, digits = 1): string {
  if (!finite(x)) return DASH;
  return `${signed(x, digits)} pts`;
}

export function tone(x: number | null | undefined): Tone {
  if (!finite(x) || Math.abs(x) < 0.05) return "flat";
  return x > 0 ? "up" : "down";
}

// $1,234 from $1,000 up, $12.34 below.
export function usd(n: number | null | undefined): string {
  if (!finite(n)) return DASH;
  const digits = Math.abs(n) >= 1000 ? 0 : 2;
  const body = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${n < 0 ? MINUS : ""}$${body}`;
}

// "3h 12m", "4d 3h", "45s"
export function duration(ms: number): string {
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

// "in 3h 12m", "3h 12m ago"
export function relative(ms: number, now: number): string {
  const diff = ms - now;
  if (Math.abs(diff) < 1000) return "now";
  return diff > 0 ? `in ${duration(diff)}` : `${duration(diff)} ago`;
}

// "Nov 21", with the year when it isn't the current one.
function day(ms: number, now: number): string {
  const d = new Date(ms);
  const year = d.getUTCFullYear() !== new Date(now).getUTCFullYear() ? ` ${d.getUTCFullYear()}` : "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}${year}`;
}

// "Nov 21 06:00 UTC", with the year when it isn't the current one.
export function utc(ms: number | null | undefined, now = Date.now()): string {
  if (!finite(ms)) return DASH;
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day(ms, now)} ${hh}:${mm} UTC`;
}

const PRICE_KINDS = new Set(["price_binary", "price_bucket", "price_touch"]);

export interface Timing {
  settles: number | null;
  starts: number | null;
  by: number | null;
}

// The console's rule (settleTiming in @hyperodds/core): a price market settles at its price time, or
// by its deadline when that differs (a touch); any other market starts, or for a rate decision
// decides, at its event time and settles by its deadline.
export function timing(m: Pick<Market, "kind" | "eventTime" | "deadline">): Timing {
  if (!PRICE_KINDS.has(m.kind)) return { settles: null, starts: m.eventTime, by: m.deadline };
  if (m.eventTime !== null && (m.deadline === null || m.deadline === m.eventTime))
    return { settles: m.eventTime, starts: null, by: null };
  return { settles: null, starts: null, by: m.deadline ?? m.eventTime };
}

function startLabel(m: Pick<Market, "kind">, at: number, now: number): string {
  if (m.kind === "policy_rate") return "Decision";
  return at > now ? "Starts" : "Started";
}

export function quote(m: Market, side: Side): { bid: number | null; ask: number | null } {
  if (side === 0) return { bid: m.bid, ask: m.ask };
  return { bid: m.ask === null ? null : 1 - m.ask, ask: m.bid === null ? null : 1 - m.bid };
}

// Side 0's price: 1 or 0 once settled; the mid while both sides are quoted within 10 points; else the
// last trade, which the API holds for 24 hours. A one-sided book has no mid, as in the console (the API
// sends the one side's price as its mid), so it shows the last trade or nothing.
export function price(m: Market): number | null {
  if (m.status === "settled" && m.settledSide !== null) return m.settledSide === 0 ? 1 : 0;
  const twoSided = finite(m.bid) && finite(m.ask);
  if (twoSided && finite(m.mid) && finite(m.spread) && m.spread <= WIDE_SPREAD) return m.mid;
  return m.lastPx;
}

function yesNo(m: Market): boolean {
  return m.sideLabels[0] === "Yes" && m.sideLabels[1] === "No";
}

function clip(text: string, max = NAME_LENGTH): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

// A name short enough for the menu bar: the side's own name ("CAR"), a question's outcome
// ("Liverpool"), or the title without its closing time ("BTC above 61,908").
export function shortName(m: Market): string {
  if (!yesNo(m)) return clip(m.sideLabels[0]);
  if (m.role !== "standalone") {
    const ticker = m.subcategory && /^[A-Z0-9]{2,6}$/.test(m.subcategory) ? `${m.subcategory} ` : "";
    return clip(`${ticker}${m.label}`);
  }
  return clip(m.title.replace(/ (?:at|by) [A-Z][a-z]{2} \d{1,2}(?: \d{4})? \d{2}:\d{2} UTC$/, ""));
}

// The side a price is quoted for, when it isn't plain Yes.
function sideSuffix(m: Market): string {
  return yesNo(m) ? "" : ` ${m.sideLabels[0]}`;
}

// Settled and delisted markets show what happened rather than a price.
function closed(m: Market): boolean {
  return m.status === "settled" || m.status === "removed";
}

export function priceText(m: Market): string {
  if (m.status === "removed") return "Delisted";
  if (m.status === "settled")
    return m.settledSide === null ? "Settled" : `Settled: ${m.sideLabels[m.settledSide]}`;
  const p = price(m);
  if (p === null) return "No trades in 24h";
  return `${cents(p)}${sideSuffix(m)}`;
}

// "+5.3 pts Yes", as the console writes it: the edge, then the side it is on. A zero edge has no side.
export function edgeText(m: Market): string | null {
  const best = m.edge?.best;
  if (!best) return null;
  const text = pts(best.pts);
  return text === pts(0) ? text : `${text} ${m.sideLabels[best.side]}`;
}

export function fairText(m: Market): string | null {
  if (!m.fair) return null;
  return `${pct(m.fair.p)} ${m.sideLabels[0]}`;
}

export type Tone = "up" | "down" | "flat";

export interface Row {
  title: string;
  text: string;
  tone?: Tone;
  url?: string;
}

function row(title: string, text: string, toneOf?: number | null): Row {
  return toneOf === undefined ? { title, text } : { title, text, tone: tone(toneOf) };
}

// Once settled, the deadline no longer says anything and a price market's time is when it settled.
function timeRows(m: Market, now: number): Row[] {
  const t = timing(m);
  const settled = m.status === "settled";
  const when = (at: number) => `${utc(at, now)} · ${relative(at, now)}`;
  const rows: Row[] = [];
  if (t.starts !== null) rows.push(row(startLabel(m, t.starts, now), when(t.starts)));
  if (t.settles !== null) {
    const label = settled ? "Settled at" : t.settles > now ? "Settles at" : "Settlement was due";
    rows.push(row(label, when(t.settles)));
  }
  if (t.by !== null && !settled) rows.push(row("Settles by", when(t.by)));
  if (!rows.length && !settled) rows.push(row("Settles", "No settlement time"));
  return rows;
}

// What the detail pane shows for one market, in groups split by a rule. Titles are unique within a market.
export function detailGroups(m: Market, now = Date.now()): Row[][] {
  const prices = [row("Price", priceText(m))];
  for (const side of [0, 1] as const) {
    const q = quote(m, side);
    const d = pairDecimals(q.bid, q.ask);
    const text =
      q.bid === null && q.ask === null ? "No book" : `${cents(q.bid, d)} bid · ${cents(q.ask, d)} ask`;
    prices.push(row(m.sideLabels[side], text));
  }
  if (finite(m.change24h)) prices.push(row("24h change", pts(m.change24h * 100), m.change24h * 100));

  const value: Row[] = [];
  if (m.fair) {
    value.push(row("Fair line", `${fairText(m)} · ${pct(m.fair.lo)} to ${pct(m.fair.hi)}`));
    const method = METHOD_LABEL[m.fair.method] ?? m.fair.method;
    const sources = m.fair.singleSource ? " · one source" : "";
    value.push(row("Fair line from", `${method}${sources} · ${pct(m.fair.confidence, 0)} confidence`));
  } else {
    value.push(row("Fair line", "None for this market yet"));
  }
  const edge = m.edge;
  if (edge?.best) {
    value.push(row("Edge after fees", edgeText(m)!, edge.best.pts));
    for (const side of [0, 1] as const) {
      const buy = side === 0 ? edge.buy0 : edge.buy1;
      value.push(
        row(
          `Buying ${m.sideLabels[side]} with $${edge.refUsd}`,
          buy === null ? "Doesn't fill" : pts(buy),
          buy,
        ),
      );
    }
  } else if (m.fair) {
    value.push(row("Edge after fees", `Neither side fills $${m.edge?.refUsd ?? 100}`));
  }

  const market = timeRows(m, now);
  market.push(row("Status", STATUS_LABEL[m.status]));
  market.push(row("Settlement", m.settlementRisk.note));
  market.push(row("Deployer", m.deployerName));
  if (m.listedAt !== null)
    market.push(row("Listed", `${utc(m.listedAt, now)} · ${relative(m.listedAt, now)}`));
  market.push(row("Volume 24h", `${int.format(m.volume24h)} contracts`));
  market.push(row("Depth within 5 pts", `${usd(m.depthUsd.bid)} bid · ${usd(m.depthUsd.ask)} ask`));
  market.push({ title: "Market", text: `usehyperodds.com/m/${m.outcome}`, url: marketUrl(m.outcome) });
  return [prices, value, market];
}

export interface Accessory {
  text: string;
  tone?: Tone;
  tooltip: string;
}

// The time a list row shows: a game's start or a decision's time while it is ahead, "In play" while the
// event runs (the console's IN PLAY), then when the market settles.
function nextTime(m: Market, now: number): Accessory | null {
  const t = timing(m);
  if (m.status === "live") {
    const tooltip =
      t.by === null ? "The event has started; the market still trades" : `Settles by ${utc(t.by, now)}`;
    return { text: "In play", tooltip };
  }
  if (t.starts !== null && t.starts > now) {
    const label = startLabel(m, t.starts, now);
    return { text: `${label} ${relative(t.starts, now)}`, tooltip: `${label} ${utc(t.starts, now)}` };
  }
  if (t.settles !== null && t.settles > now)
    return { text: `Settles ${relative(t.settles, now)}`, tooltip: `Settles at ${utc(t.settles, now)}` };
  if (t.settles !== null) {
    const due = "Settlement was due";
    return { text: `${due} ${relative(t.settles, now)}`, tooltip: `${due} ${utc(t.settles, now)}` };
  }
  if (t.by !== null) return { text: `Settles by ${day(t.by, now)}`, tooltip: `Settles by ${utc(t.by, now)}` };
  return null;
}

// The list row's right-hand side when the detail pane is hidden: a positive edge, the price, and the
// next time that matters. Top Edges pairs the edge with the ask of the side it is on, as the console's
// Edges table does ("+2.9 pts No · 70.3¢ ask"), in place of side 0's price.
export function accessories(m: Market, now: number, { edges = false } = {}): Accessory[] {
  const out: Accessory[] = [];
  const best = m.edge?.best;
  if (best && !closed(m) && (edges || tone(best.pts) === "up")) {
    const side = m.sideLabels[best.side];
    const tooltip = `Edge after fees, buying ${side} with $${m.edge!.refUsd}`;
    const ask = cents(quote(m, best.side).ask);
    out.push(
      edges
        ? {
            text: `${edgeText(m)} · ${ask} ask`,
            tone: tone(best.pts),
            tooltip: `${tooltip}, at the ${side} ask`,
          }
        : { text: edgeText(m)!, tone: "up", tooltip },
    );
  }
  if (!edges) out.push({ text: priceText(m), tooltip: `Price of ${m.sideLabels[0]}` });
  const next = closed(m) ? null : nextTime(m, now);
  if (next) out.push(next);
  return out;
}

export type TitleMode = "name" | "price" | "icon";

export interface MenuBar {
  title: string | undefined;
  items: Array<{ outcome: number; title: string; subtitle: string; tone: Tone; url: string }>;
  gone: number[];
}

// What the menu bar shows for the pinned markets, in pin order.
export function menuBar(pinned: Array<{ outcome: number; market: Market | null }>, mode: TitleMode): MenuBar {
  const items: MenuBar["items"] = [];
  const gone: number[] = [];
  for (const { outcome, market } of pinned) {
    if (!market) {
      gone.push(outcome);
      continue;
    }
    const change = finite(market.change24h) ? ` · ${pts(market.change24h * 100)} 24h` : "";
    items.push({
      outcome,
      title: clip(market.title, 48),
      subtitle: `${priceText(market)}${closed(market) ? "" : change}`,
      tone: tone(finite(market.change24h) ? market.change24h * 100 : null),
      url: marketUrl(outcome),
    });
  }
  const first = pinned.find((p) => p.market)?.market;
  let title: string | undefined;
  if (first && mode !== "icon") {
    const p = price(first);
    const value = closed(first) ? priceText(first) : p === null ? "no price" : cents(p);
    title = mode === "price" ? value : `${shortName(first)} ${value}`;
  }
  return { title, items, gone };
}
