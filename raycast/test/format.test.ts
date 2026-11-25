import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accessories,
  cents,
  DASH,
  detailGroups,
  duration,
  edgeText,
  fairText,
  menuBar,
  pairDecimals,
  pct,
  plainMarkdown,
  price,
  priceText,
  pts,
  quote,
  type Row,
  relative,
  shortName,
  timing,
  tone,
  usd,
  utc,
} from "../src/lib/format.ts";
import { btc, bucket, fed, game, ipo, NOW, settled, touch } from "./fixtures.ts";

const flat = (groups: Row[][]) => Object.fromEntries(groups.flat().map((r) => [r.title, r.text]));

describe("titles in the detail pane", () => {
  test("a title keeps its words and loses its markup", () => {
    assert.equal(
      plainMarkdown("BTC above 59,129 at Nov 26 06:00 UTC"),
      "BTC above 59,129 at Nov 26 06:00 UTC",
    );
    assert.equal(plainMarkdown("NBA 2026/2027 winner (East): Boston"), "NBA 2026/2027 winner (East): Boston");
    assert.equal(plainMarkdown("S&P 500 above $2,000B"), "S\\&P 500 above \\$2,000B");
    assert.equal(
      plainMarkdown("![x](https://e.example/p.png)"),
      "\\![x]\u200b(https:\u200b//e.example/p.png)",
    );
    assert.equal(
      plainMarkdown("<img src=x> `code` *bold* _it_"),
      "\\<img src=x\\> \\`code\\` \\*bold\\* \\_it\\_",
    );
    assert.equal(plainMarkdown("a\n# b \\(x\\) $$y$$"), "a \\# b \\\\(x\\\\) \\$\\$y\\$\\$");
  });
});

describe("numbers", () => {
  test("cents keep the tick near 0 and 1", () => {
    assert.equal(cents(0.542), "54.2¢");
    assert.equal(cents(0.4615), "46.2¢");
    assert.equal(cents(0.00259), "0.26¢");
    assert.equal(cents(0.00026), "0.026¢");
    assert.equal(cents(0.0095), "0.95¢");
    assert.equal(cents(0.9995), "99.950¢");
    assert.equal(cents(1), "100¢");
    assert.equal(cents(0), "0¢");
    assert.equal(cents(null), DASH);
    assert.equal(cents(Number.NaN), DASH);
  });

  test("a bid and an ask keep enough decimals to differ", () => {
    assert.equal(pairDecimals(0.459, 0.464), 1);
    assert.equal(pairDecimals(0.9161, 0.9165), 2);
    assert.equal(pairDecimals(0.58343, 0.58344), 3);
    assert.equal(pairDecimals(0.5, 0.5), 1);
    assert.equal(pairDecimals(null, 0.5), undefined);
    // Each side alone would take 2 and 3 decimals; together they share 3.
    assert.equal(pairDecimals(0.995, 0.9995), 3);
    assert.equal(pairDecimals(0.0095, 0.012), 2);
    assert.equal(cents(0.9161, 2), "91.61¢");
    const rows = flat(detailGroups({ ...btc, bid: 0.995, ask: 0.9995 }, NOW));
    assert.equal(rows.Yes, "99.500¢ bid · 99.950¢ ask");
    assert.equal(rows.No, "0.050¢ bid · 0.500¢ ask");
  });

  test("points carry a sign, with a true minus", () => {
    assert.equal(pts(5.313538), "+5.3 pts");
    assert.equal(pts(-6.249079), "−6.2 pts");
    assert.equal(pts(0.01), "0.0 pts");
    assert.equal(pts(null), DASH);
  });

  test("percent, dollars and tone", () => {
    assert.equal(pct(0.521156), "52.1%");
    assert.equal(pct(0.6, 0), "60%");
    assert.equal(usd(8397.36538), "$8,397");
    assert.equal(usd(440.15097), "$440.15");
    assert.equal(usd(-1200), "−$1,200");
    assert.equal(tone(5.3), "up");
    assert.equal(tone(-0.2), "down");
    assert.equal(tone(0.01), "flat");
    assert.equal(tone(null), "flat");
  });
});

describe("time", () => {
  test("durations and relative times", () => {
    assert.equal(duration(45_000), "45s");
    assert.equal(duration(65 * 60_000), "1h 5m");
    assert.equal(duration(2 * 3_600_000), "2h");
    assert.equal(duration(51 * 3_600_000), "2d 3h");
    assert.equal(duration(400 * 86_400_000), "1y");
    assert.equal(relative(NOW + 18 * 3_600_000 + 5 * 60_000, NOW), "in 18h 5m");
    assert.equal(relative(NOW - 5 * 60_000, NOW), "5m ago");
    assert.equal(relative(NOW + 300, NOW), "now");
  });

  test("UTC like the market titles, with the year only when it differs", () => {
    assert.equal(utc(btc.eventTime, NOW), "Nov 21 06:00 UTC");
    assert.equal(utc(Date.UTC(2027, 0, 5, 9, 3), NOW), "Jan 5 2027 09:03 UTC");
    assert.equal(utc(null, NOW), DASH);
  });

  test("timing follows the console: price time, start or decision, deadline", () => {
    assert.deepEqual(timing(btc), { settles: btc.eventTime, starts: null, by: null });
    assert.deepEqual(timing(bucket), { settles: btc.eventTime, starts: null, by: null });
    assert.deepEqual(timing(touch), { settles: null, starts: null, by: touch.deadline });
    assert.deepEqual(timing({ ...touch, eventTime: touch.deadline! - 86_400_000 }), {
      settles: null,
      starts: null,
      by: touch.deadline,
    });
    assert.deepEqual(timing(game), { settles: null, starts: game.eventTime, by: game.deadline });
    assert.deepEqual(timing(fed), { settles: null, starts: fed.eventTime, by: fed.deadline });
    assert.deepEqual(timing(ipo), { settles: null, starts: null, by: ipo.deadline });
    assert.deepEqual(timing({ kind: "price_binary", eventTime: 5, deadline: null }), {
      settles: 5,
      starts: null,
      by: null,
    });
    const sent = { settles: null, starts: 7, by: 9 };
    assert.deepEqual(timing({ kind: "price_binary", eventTime: 5, deadline: 5, timing: sent }), sent);
    assert.deepEqual(timing({ kind: "price_binary", eventTime: 5, deadline: 9 }), {
      settles: null,
      starts: null,
      by: 9,
    });
  });
});

describe("prices", () => {
  test("side 1 mirrors side 0's book", () => {
    assert.deepEqual(quote(btc, 0), { bid: 0.459, ask: 0.464 });
    const no = quote(btc, 1);
    assert.equal(cents(no.bid), "53.6¢");
    assert.equal(cents(no.ask), "54.1¢");
    assert.deepEqual(quote({ ...btc, bid: null }, 1), { bid: 1 - 0.464, ask: null });
  });

  test("the mid on a tight book, the last trade on a wide one, 1 or 0 once settled", () => {
    assert.equal(price(btc), 0.4615);
    assert.equal(price(touch), 0.03774);
    assert.equal(price(settled), 0);
    assert.equal(price({ ...touch, lastPx: null }), null);
    assert.equal(price({ ...btc, bid: 0.459, ask: null, mid: null, spread: null }), btc.lastPx);
    assert.equal(price({ ...btc, bid: null, ask: null, mid: null, spread: null, lastPx: null }), null);
  });

  test("a one-sided book has no mid, whatever the API sends as one", () => {
    const askOnly = { ...btc, bid: null, ask: 0.02, mid: 0.02, spread: null, lastPx: null };
    assert.equal(price(askOnly), null);
    assert.equal(priceText(askOnly), "No trades in 24h");
    assert.equal(flat(detailGroups(askOnly, NOW)).Yes, "— bid · 2.0¢ ask");
    assert.equal(price({ ...askOnly, spread: 0 }), null);
    const bidOnly = { ...btc, bid: 0.99003, ask: null, mid: 0.99003, spread: null, lastPx: 0.9871 };
    assert.equal(price(bidOnly), 0.9871);
  });

  test("price text names the side when it isn't Yes", () => {
    assert.equal(priceText(btc), "46.2¢");
    assert.equal(priceText(game), "58.3¢ CAR");
    assert.equal(priceText(settled), "Settled: No");
    assert.equal(priceText({ ...settled, settledSide: null }), "Settled");
    assert.equal(priceText({ ...btc, status: "removed" }), "Delisted");
    assert.equal(priceText({ ...btc, mid: null, spread: null, lastPx: null }), "No trades in 24h");
    assert.equal(
      priceText({ ...btc, bid: 0.01, ask: 0.99, mid: 0.5, spread: 0.98, lastPx: null }),
      "No trades in 24h",
    );
  });

  test("edge and fair line", () => {
    assert.equal(edgeText(btc), "+5.3 pts Yes");
    assert.equal(edgeText(touch), "+1.7 pts No");
    assert.equal(
      edgeText({ ...btc, edge: { ...btc.edge!, best: { side: 1, action: "buy", pts: 0.01 } } }),
      "0.0 pts",
    );
    assert.equal(edgeText(game), null);
    assert.equal(fairText(btc), "52.1% Yes");
    assert.equal(fairText(game), null);
  });
});

describe("names", () => {
  test("short enough for the menu bar", () => {
    assert.equal(shortName(btc), "BTC above 61,908");
    assert.equal(shortName(touch), "HYPE touches 90");
    assert.equal(shortName(game), "CAR");
    assert.equal(shortName(bucket), "BTC Above 63,146");
    assert.equal(shortName(fed), "No change");
    assert.equal(shortName(ipo), "Anthropic first-day mar…");
    assert.ok(shortName(ipo).length <= 24);
  });
});

describe("detail pane", () => {
  test("every row a market shows", () => {
    const rows = flat(detailGroups(btc, NOW));
    assert.deepEqual(rows, {
      Price: "46.2¢",
      Yes: "45.9¢ bid · 46.4¢ ask",
      No: "53.6¢ bid · 54.1¢ ask",
      "24h change": "−4.3 pts",
      "Fair line": "52.1% Yes · 52.0% to 52.2%",
      "Fair line from": "Options-implied · 60% confidence",
      "Edge after fees": "+5.3 pts Yes",
      "Buying Yes with $100": "+5.3 pts",
      "Buying No with $100": "−6.2 pts",
      "Settles at": "Nov 21 06:00 UTC · in 18h 5m",
      Status: "Open",
      Settlement: "Settled by the protocol.",
      Deployer: "Hyperliquid",
      Listed: "Nov 20 06:00 UTC · 5h 54m ago",
      "Volume 24h": "89,328 contracts",
      "Depth within 5 pts": "$8,397 bid · $9,284 ask",
      Market: "usehyperodds.com/m/41294",
    });
  });

  test("titles are unique, so they can key the rows", () => {
    for (const m of [btc, game, touch, bucket, fed, settled, ipo]) {
      const titles = detailGroups(m, NOW)
        .flat()
        .map((r) => r.title);
      assert.equal(new Set(titles).size, titles.length, m.title);
    }
  });

  test("colors follow the sign; the link points at the market", () => {
    const rows = detailGroups(btc, NOW).flat();
    const byTitle = (t: string) => rows.find((r) => r.title === t)!;
    assert.equal(byTitle("Edge after fees").tone, "up");
    assert.equal(byTitle("Buying No with $100").tone, "down");
    assert.equal(byTitle("24h change").tone, "down");
    assert.equal(byTitle("Market").url, "https://usehyperodds.com/m/41294");
    assert.equal(byTitle("Price").tone, undefined);
  });

  test("a game shows its start, its own side names and no fair line", () => {
    const rows = flat(detailGroups(game, NOW));
    assert.equal(rows.CAR, "58.343¢ bid · 58.344¢ ask");
    assert.equal(rows.BAL, "41.656¢ bid · 41.657¢ ask");
    assert.equal(rows.Starts, "Nov 22 18:00 UTC · in 2d 6h");
    assert.equal(rows["Settles by"], "Feb 22 2027 18:00 UTC · in 3mo");
    assert.equal(rows["Fair line"], "None for this market yet");
    assert.equal(rows["Edge after fees"], undefined);
    assert.equal(rows.Settlement, "Settled by Outcome's key; 507,658 HYPE staked.");
    assert.equal(rows.Listed, undefined);
  });

  test("a side that doesn't fill $100, a single-source line and an empty book", () => {
    const rows = flat(
      detailGroups(
        {
          ...touch,
          bid: null,
          ask: null,
          fair: { ...touch.fair!, singleSource: true, method: "consensus" },
        },
        NOW,
      ),
    );
    assert.equal(rows["Buying Yes with $100"], "−3.4 pts");
    assert.equal(rows.Yes, "No book");
    assert.equal(
      rows["Fair line from"],
      "Matched Polymarket and Kalshi markets · one source · 60% confidence",
    );
    const neither = flat(detailGroups({ ...btc, edge: { ...btc.edge!, buy0: null, best: null } }, NOW));
    assert.equal(neither["Edge after fees"], "Neither side fills $100");
    const sell = flat(detailGroups({ ...touch, edge: { ...touch.edge!, buy0: null } }, NOW));
    assert.equal(sell["Buying Yes with $100"], "Doesn't fill");
  });

  test("each kind of market labels its times as the console does", () => {
    const times = (m: typeof btc, now = NOW) =>
      Object.fromEntries(
        Object.entries(flat(detailGroups(m, now))).filter(([title]) =>
          /^(Settles|Settled at|Settlement was due|Start|Decision)/.test(title),
        ),
      );
    assert.deepEqual(times(fed), {
      Decision: "Dec 9 19:00 UTC · in 19d 7h",
      "Settles by": "Jan 27 2027 19:00 UTC · in 2mo",
    });
    assert.deepEqual(times(touch), { "Settles by": "Dec 1 00:00 UTC · in 10d 12h" });
    assert.deepEqual(times(ipo), { "Settles by": "Jan 1 2027 00:00 UTC · in 1mo" });
    assert.deepEqual(times({ ...ipo, deadline: null }), { Settles: "No settlement time" });
    const later = game.eventTime! + 3_600_000;
    assert.deepEqual(times({ ...game, status: "live" }, later), {
      Started: "Nov 22 18:00 UTC · 1h ago",
      "Settles by": "Feb 22 2027 18:00 UTC · in 3mo",
    });
    assert.deepEqual(times({ ...btc, status: "awaiting" }, btc.eventTime! + 3_600_000), {
      "Settlement was due": "Nov 21 06:00 UTC · 1h ago",
    });
    assert.equal(times(fed, fed.eventTime! + 60_000).Decision, "Dec 9 19:00 UTC · 1m ago");
  });

  test("a settled market says so", () => {
    const rows = flat(detailGroups(settled, NOW));
    assert.equal(rows.Price, "Settled: No");
    assert.equal(rows.Status, "Settled");
    assert.equal(rows["Settled at"], "Nov 21 06:00 UTC · in 18h 5m");
    assert.ok(!("Settles at" in rows));
    assert.ok(!("Settles by" in flat(detailGroups({ ...game, status: "settled", settledSide: 0 }, NOW))));
  });
});

describe("list accessories", () => {
  test("edge, price and time to settle", () => {
    assert.deepEqual(accessories(btc, NOW), [
      { text: "+5.3 pts Yes", tone: "up", tooltip: "Edge after fees, buying Yes with $100" },
      { text: "46.2¢", tooltip: "Price of Yes" },
      { text: "Settles in 18h 5m", tooltip: "Settles at Nov 21 06:00 UTC" },
    ]);
    assert.deepEqual(
      accessories(ipo, NOW).map((a) => a.text),
      ["+5.3 pts Yes", "46.2¢", "Settles by Jan 1 2027"],
    );
  });

  test("Top Edges shows the edge with its own side's ask, never side 0's price", () => {
    assert.deepEqual(accessories(touch, NOW, { edges: true }), [
      {
        text: "+1.7 pts No · 98.0¢ ask",
        tone: "up",
        tooltip: "Edge after fees, buying No with $100, at the No ask",
      },
      { text: "Settles by Dec 1", tooltip: "Settles by Dec 1 00:00 UTC" },
    ]);
    assert.equal(accessories(btc, NOW, { edges: true })[0].text, "+5.3 pts Yes · 46.4¢ ask");
  });

  test("an edge at or below zero isn't shown as one", () => {
    const none = {
      ...btc,
      edge: { ...btc.edge!, best: { side: 1 as const, action: "buy" as const, pts: -0.5 } },
    };
    assert.deepEqual(
      accessories(none, NOW).map((a) => a.text),
      ["46.2¢", "Settles in 18h 5m"],
    );
    const zero = {
      ...btc,
      edge: { ...btc.edge!, best: { side: 1 as const, action: "buy" as const, pts: 0.01 } },
    };
    assert.equal(accessories(zero, NOW).length, 2);
  });

  test("a game or a decision ahead shows its time, then the deadline it settles by", () => {
    assert.deepEqual(accessories(game, NOW), [
      { text: "58.3¢ CAR", tooltip: "Price of CAR" },
      { text: "Starts in 2d 6h", tooltip: "Starts Nov 22 18:00 UTC" },
    ]);
    assert.deepEqual(accessories(game, game.eventTime! + 3_600_000)[1], {
      text: "Settles by Feb 22 2027",
      tooltip: "Settles by Feb 22 2027 18:00 UTC",
    });
    assert.deepEqual(accessories({ ...game, status: "live" }, game.eventTime! + 3_600_000)[1], {
      text: "In play",
      tooltip: "Settles by Feb 22 2027 18:00 UTC",
    });
    assert.deepEqual(accessories(fed, NOW).at(-1), {
      text: "Decision in 19d 7h",
      tooltip: "Decision Dec 9 19:00 UTC",
    });
    assert.equal(accessories(fed, fed.eventTime! + 60_000).at(-1)?.text, "Settles by Jan 27 2027");
    assert.equal(accessories(touch, NOW).at(-1)?.text, "Settles by Dec 1");
  });

  test("a price market past its time says settlement was due; a settled one shows no time", () => {
    const later = btc.eventTime! + 3_600_000;
    assert.equal(
      accessories({ ...btc, status: "awaiting" }, later).at(-1)?.text,
      "Settlement was due 1h ago",
    );
    assert.deepEqual(
      accessories(settled, NOW).map((a) => a.text),
      ["Settled: No"],
    );
  });
});

describe("menu bar", () => {
  const pinned = [
    { outcome: 41294, market: btc },
    { outcome: 39392, market: game },
    { outcome: 5, market: null },
  ];

  test("the first pin titles the menu bar", () => {
    assert.equal(menuBar(pinned, "name").title, "BTC above 61,908 46.2¢");
    assert.equal(menuBar(pinned, "price").title, "46.2¢");
    assert.equal(menuBar(pinned, "icon").title, undefined);
    assert.equal(menuBar([{ outcome: 5, market: null }, ...pinned.slice(1, 2)], "name").title, "CAR 58.3¢");
    assert.equal(menuBar([{ outcome: 1, market: settled }], "name").title, "BTC above 61,908 Settled: No");
    const unpriced = { ...btc, mid: null, spread: null, lastPx: null };
    assert.equal(menuBar([{ outcome: 1, market: unpriced }], "name").title, "BTC above 61,908 no price");
    assert.equal(menuBar([{ outcome: 1, market: unpriced }], "price").title, "no price");
    const removed = { ...btc, status: "removed" as const };
    assert.equal(menuBar([{ outcome: 1, market: removed }], "price").title, "Delisted");
    assert.equal(menuBar([{ outcome: 1, market: removed }], "name").items[0].subtitle, "Delisted");
    assert.deepEqual(
      accessories(removed, NOW).map((a) => a.text),
      ["Delisted"],
    );
    assert.equal(menuBar([], "name").title, undefined);
  });

  test("each pin lists its price and 24-hour move; delisted pins are set apart", () => {
    const bar = menuBar(pinned, "name");
    assert.deepEqual(bar.items, [
      {
        outcome: 41294,
        title: "BTC above 61,908 at Nov 21 06:00 UTC",
        subtitle: "46.2¢ · −4.3 pts 24h",
        tone: "down",
        url: "https://usehyperodds.com/m/41294",
      },
      {
        outcome: 39392,
        title: "Carolina Panthers vs Baltimore Ravens",
        subtitle: "58.3¢ CAR · +1.3 pts 24h",
        tone: "up",
        url: "https://usehyperodds.com/m/39392",
      },
    ]);
    assert.deepEqual(bar.gone, [5]);
    assert.equal(menuBar([{ outcome: 1, market: settled }], "name").items[0].subtitle, "Settled: No");
    assert.equal(menuBar([{ outcome: 1, market: fed }], "name").items[0].title.length, 48);
  });
});
