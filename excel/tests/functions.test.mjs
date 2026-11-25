import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { ApiError } from "../src/api.js";
import { createFeed } from "../src/feed.js";
import { COLUMNS, edge, fair, market, outcomeOf, price, useFeed } from "../src/functions.js";
import { api, cell, FakeEventSource, failed, ok, settle, summary } from "./fakes.mjs";

const btc = summary(41294, { title: "BTC above 61,908 at Nov 21 06:00 UTC" });
const game = summary(39392, {
  title: "Carolina Panthers vs Baltimore Ravens",
  sideLabels: ["CAR", "BAL"],
  category: "sports",
  kind: "contest_winner",
  eventTime: Date.UTC(2026, 10, 22, 18),
  deadline: Date.UTC(2027, 1, 22, 18),
  deployer: "out",
  deployerName: "Outcome",
  bid: 0.58,
  ask: 0.59,
  mid: 0.585,
  fair: null,
  edge: null,
});

let feed;
let network;

function start(markets = [btc, game], handlers = {}) {
  // As the API does: searches leave out settled and removed markets; the snapshot asks for them.
  network = api({
    "markets.list": (input) => {
      const listed = input?.includeSettled
        ? markets
        : markets.filter((m) => m.status !== "settled" && m.status !== "removed");
      return ok(input?.q ? listed.filter((m) => m.title.toLowerCase().includes(input.q)) : listed);
    },
    ...handlers,
  });
  feed = createFeed({ base: "https://api.test", fetch: network.fetch, EventSource: FakeEventSource });
  useFeed(feed);
}

async function live() {
  await settle();
  FakeEventSource.last.connect();
  await settle();
}

beforeEach((t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.UTC(2026, 10, 22, 12) });
  FakeEventSource.reset();
});

afterEach(() => feed?.close());

describe("PRICE", () => {
  test("shows the mid and follows the stream as the book moves", async () => {
    start();
    const c = cell();
    price(41294, null, null, c);
    await live();
    assert.deepEqual(c.values, [47.5]);
    FakeEventSource.last.send([{ ...btc, bid: 0.49, ask: 0.5, mid: 0.495 }]);
    assert.deepEqual(c.values, [47.5, 49.5]);
  });

  test("sends nothing new while the price holds", async () => {
    start();
    const c = cell();
    price(41294, null, null, c);
    await live();
    FakeEventSource.last.send([{ ...btc, volume24h: 90000 }]);
    FakeEventSource.last.send([{ ...btc, lastPx: 0.48 }]);
    assert.deepEqual(c.values, [47.5]);
  });

  test("mirrors the book for side 1, named by number, Yes/No or the side's own name", async () => {
    start();
    const cells = {
      mid1: [41294, 1, null],
      no: [41294, "No", null],
      bid1: [41294, 1, "bid"],
      ask1: [41294, "no", "ASK"],
      last1: [41294, 1, "last"],
      bal: [39392, "BAL", null],
      car: [39392, "car", "bid"],
    };
    const out = {};
    for (const [name, args] of Object.entries(cells)) {
      out[name] = cell();
      price(...args, out[name]);
    }
    await live();
    assert.equal(out.mid1.value, 52.5);
    assert.equal(out.no.value, 52.5);
    assert.equal(out.bid1.value, 52);
    assert.equal(out.ask1.value, 53);
    assert.equal(out.last1.value, 52.9);
    assert.equal(out.bal.value, 41.5);
    assert.equal(out.car.value, 58);
  });

  test("takes an outcome id as text or a Hyperodds market link, with or without the scheme", () => {
    assert.equal(outcomeOf(3600), 3600);
    assert.equal(outcomeOf(" 3600 "), 3600);
    assert.equal(outcomeOf("https://usehyperodds.com/m/3600"), 3600);
    assert.equal(outcomeOf("https://usehyperodds.com/m/3600/?ref=x"), 3600);
    assert.equal(outcomeOf("usehyperodds.com/m/3600"), 3600);
    assert.equal(outcomeOf("www.usehyperodds.com/m/3600#book"), 3600);
    const refused = [
      -1,
      3.5,
      "",
      "abc",
      "https://usehyperodds.com/q/12",
      "https://example.com/m/3600",
      null,
      true,
    ];
    for (const value of refused) {
      assert.equal(outcomeOf(value), null, String(value));
    }
  });

  test("refuses a bad outcome, side or quote with #VALUE!", async () => {
    start();
    const outcome = cell();
    const side = cell();
    const quote = cell();
    price("btc", null, null, outcome);
    price(39392, 2, null, side);
    price(41294, 0, "close", quote);
    await live();
    assert.equal(outcome.value.code, "#VALUE!");
    assert.match(outcome.value.message, /outcome id/);
    assert.equal(side.value.code, "#VALUE!");
    assert.equal(side.value.message, 'Use 0 or 1, or "CAR" or "BAL", for the side.');
    assert.equal(quote.value.code, "#VALUE!");
    assert.equal(FakeEventSource.instances.length, 1);
  });

  test("shows 100 for the side that won and 0 for the other once settled", async () => {
    start();
    const yes = cell();
    const no = cell();
    price(41294, 0, null, yes);
    price(41294, 1, null, no);
    await live();
    FakeEventSource.last.send([
      { ...btc, status: "settled", settledSide: 1, bid: null, ask: null, mid: null },
    ]);
    assert.equal(yes.value, 0);
    assert.equal(no.value, 100);
  });

  test("rounds a half-tick mid as the console does, away from zero", async () => {
    // 56.1885 and 13.0345 as doubles sit just under the half tick; toFixed(3) gave 56.188 and 13.034.
    const half = summary(6000, { bid: 0.56188, ask: 0.56189, mid: 0.561885 });
    const low = summary(6001, { bid: 0.13034, ask: 0.13035, mid: 0.130345 });
    start([half, low]);
    const a = cell();
    const b = cell();
    const no = cell();
    price(6000, null, null, a);
    price(6001, null, null, b);
    price(6000, "No", null, no);
    await live();
    assert.equal(a.value, 56.189);
    assert.equal(b.value, 13.035);
    assert.equal(no.value, 43.812);
  });

  test("answers #N/A with a reason when there is no price", async () => {
    const other = summary(5000, { role: "fallback", bid: null, ask: null, mid: null });
    const thin = summary(5001, { ask: null, mid: null });
    const pending = summary(5002, { status: "settled", settledSide: null });
    const gone = summary(5003, { status: "removed" });
    const wide = summary(5004, { bid: 0.00334, ask: 0.99666, mid: 0.5 });
    start([other, thin, pending, gone, wide]);
    const cells = [5000, 5001, 5002, 5003, 999, 5004].map((id) => {
      const c = cell();
      price(id, null, null, c);
      return c;
    });
    const ask = cell();
    price(5001, 0, "ask", ask);
    const wideBid = cell();
    price(5004, 0, "bid", wideBid);
    await live();
    assert.equal(wideBid.value, 0.334);
    assert.deepEqual(
      [...cells, ask].map((c) => [c.value.code, c.value.message]),
      [
        ["#N/A", "This outcome has no order book on Hyperliquid."],
        ["#N/A", "No price: one side of the book is empty."],
        ["#N/A", "This market has settled."],
        ["#N/A", "This market was removed."],
        ["#N/A", "No market with this id. Hyperodds keeps settled markets for six hours."],
        ["#N/A", 'No mid: the bid and ask are more than 10 points apart. Ask for "bid" or "ask".'],
        ["#N/A", "No ask right now."],
      ],
    );
  });

  test("a market listed after the snapshot fills in from the stream", async () => {
    start();
    const c = cell();
    price(50000, null, null, c);
    await live();
    assert.equal(c.value.message, "No market with this id. Hyperodds keeps settled markets for six hours.");
    FakeEventSource.last.send([summary(50000, { mid: 0.3 })]);
    assert.equal(c.value, 30);
  });

  test("says when Hyperodds can't be reached, then recovers on its own", async (t) => {
    let down = true;
    start([btc], {
      "markets.list": () => (down ? Promise.reject(new TypeError("fetch failed")) : ok([btc])),
    });
    const c = cell();
    price(41294, null, null, c);
    await live();
    assert.equal(c.value.code, "#N/A");
    assert.equal(c.value.message, "Can't reach Hyperodds. Retrying.");
    down = false;
    t.mock.timers.tick(5000);
    await settle();
    assert.equal(c.value, 47.5);
  });

  test("says how long Hyperodds has been silent once the feed calls its data stale", () => {
    const c = cell();
    useFeed({
      watch: (_, fn) => {
        fn(null, new ApiError("No update from Hyperodds.", { since: Date.UTC(2026, 10, 22, 12, 5) }));
        return () => {};
      },
    });
    price(41294, null, null, c);
    assert.deepEqual(
      [c.value.code, c.value.message],
      ["#N/A", "No update from Hyperodds since 12:05 UTC. Retrying."],
    );
    feed = null;
  });

  test("names why there is no price: rate-limited, blocked by the browser, or offline", () => {
    const reasons = [
      [
        { kind: "rate-limited", status: 429, retryAfter: 30 },
        "Too many requests from this address. Retrying in 30 s.",
      ],
      [{ kind: "blocked" }, "The browser blocked Hyperodds' answer (CORS). Retrying."],
      [{ kind: "offline" }, "You're offline. Cells fill in once you're back online."],
      [{ kind: "unreachable" }, "Can't reach Hyperodds. Retrying."],
    ];
    for (const [fields, message] of reasons) {
      const c = cell();
      useFeed({
        watch: (_, fn) => {
          fn(null, new ApiError("", fields));
          return () => {};
        },
      });
      price(41294, null, null, c);
      assert.deepEqual([c.value.code, c.value.message], ["#N/A", message]);
    }
    feed = null;
  });

  test("answers with Excel's errors on a page where office.js defines CustomFunctions without them", () => {
    globalThis.CustomFunctions = { associate() {} };
    try {
      const c = cell();
      price("btc", null, null, c);
      assert.equal(c.value.code, "#VALUE!");
    } finally {
      delete globalThis.CustomFunctions;
    }
  });

  test("stops updating a cell once Excel cancels it", async () => {
    start();
    const c = cell();
    price(41294, null, null, c);
    await live();
    c.cancel();
    FakeEventSource.last.send([{ ...btc, mid: 0.6 }]);
    assert.deepEqual(c.values, [47.5]);
  });
});

describe("FAIR", () => {
  test("gives the fair line in cents for either side and follows updates", async () => {
    start();
    const yes = cell();
    const no = cell();
    fair(41294, null, yes);
    fair("https://usehyperodds.com/m/41294", "No", no);
    await live();
    assert.equal(yes.value, 50);
    assert.equal(no.value, 50);
    FakeEventSource.last.send([{ ...btc, fair: { ...btc.fair, p: 0.6123456 } }]);
    assert.equal(yes.value, 61.235);
    assert.equal(no.value, 38.765);
  });

  test("answers #N/A for a market without a fair line", async () => {
    start();
    const c = cell();
    fair(39392, null, c);
    await live();
    assert.deepEqual([c.value.code, c.value.message], ["#N/A", "No fair line for this market right now."]);
  });
});

describe("EDGE", () => {
  test("gives the better side's edge by default, or the side asked for", async () => {
    start();
    const best = cell();
    const yes = cell();
    const no = cell();
    edge(41294, null, best);
    edge(41294, "yes", yes);
    edge(41294, 1, no);
    await live();
    assert.equal(best.value, 1.23);
    assert.equal(yes.value, 1.23);
    assert.equal(no.value, -3.1);
    FakeEventSource.last.send([
      { ...btc, edge: { ...btc.edge, buy0: -1, buy1: 2.468, best: { side: 1, action: "buy", pts: 2.468 } } },
    ]);
    assert.deepEqual([best.value, yes.value, no.value], [2.47, -1, 2.47]);
  });

  test("answers #N/A when there is no edge or a $100 buy doesn't fill", async () => {
    const dry = summary(6000, {
      edge: { refUsd: 100, buy0: null, buy1: null, sell0: null, sell1: null, best: null },
    });
    start([btc, game, dry]);
    const none = cell();
    const side = cell();
    const best = cell();
    edge(39392, null, none);
    edge(6000, 0, side);
    edge(6000, null, best);
    await live();
    assert.equal(none.value.message, "No edge for this market right now.");
    assert.equal(side.value.message, "A $100 buy of this side doesn't fill right now.");
    assert.equal(best.value.message, "Neither side fills a $100 buy right now.");
  });
});

describe("MARKET", () => {
  const eth = summary(41300, {
    title: "ETH above 3,000 at Nov 21 06:00 UTC",
    subcategory: "ETH",
    volume24h: 1000,
  });
  const other = summary(41301, {
    title: "BTC above 70,000: Other",
    role: "fallback",
    bid: null,
    ask: null,
    mid: null,
  });
  const settled = summary(41302, { title: "BTC above 50,000 at Nov 19", status: "settled", settledSide: 0 });

  test("spills a header and one live row per matching market", async () => {
    start([btc, eth, other, settled, game]);
    const c = cell();
    market("btc", null, c);
    await live();
    assert.deepEqual(
      network.calls.find((call) => call.input?.q),
      { path: "markets.list", input: { q: "btc", sort: "volume", limit: 40 } },
    );
    assert.deepEqual(c.value, [
      COLUMNS,
      [
        41294,
        "BTC above 61,908 at Nov 21 06:00 UTC",
        "Open",
        "Hyperliquid",
        "Yes",
        47,
        48,
        50,
        "Yes",
        1.23,
        82897,
        "",
        "at 2026-11-21 06:00",
      ],
    ]);
    FakeEventSource.last.send([{ ...btc, bid: 0.5, ask: 0.51 }]);
    assert.deepEqual(c.value[1].slice(5, 7), [50, 51]);
  });

  test("leaves blanks where a market has no book side, fair line or edge", async () => {
    start([{ ...game, bid: null }]);
    const c = cell();
    market("", 5, c);
    await live();
    assert.deepEqual(c.value[1], [
      39392,
      "Carolina Panthers vs Baltimore Ravens",
      "Open",
      "Outcome",
      "CAR",
      "",
      59,
      "",
      "",
      "",
      82897,
      "Starts 2026-11-22 18:00",
      "by 2027-02-22 18:00",
    ]);
  });

  test("times each market as the console does: games and decisions by their start, prices at or by", async () => {
    const decision = summary(19990, {
      title: "FOMC rate decision, December 2026: No change",
      kind: "policy_rate",
      eventTime: Date.UTC(2026, 11, 9, 19),
      deadline: Date.UTC(2027, 0, 27, 19),
    });
    const touch = summary(30199, {
      title: "CL touches 95 by Dec 1 00:00 UTC",
      kind: "price_touch",
      eventTime: null,
      deadline: Date.UTC(2026, 11, 1),
    });
    const undated = summary(30200, { title: "No times", kind: "other", eventTime: null, deadline: null });
    start([btc, game, decision, touch, undated]);
    const c = cell();
    market("", 10, c);
    await live();
    const when = Object.fromEntries(c.value.slice(1).map((r) => [r[0], r.slice(11)]));
    assert.deepEqual(when, {
      41294: ["", "at 2026-11-21 06:00"],
      39392: ["Starts 2026-11-22 18:00", "by 2027-02-22 18:00"],
      19990: ["Decision 2026-12-09 19:00", "by 2027-01-27 19:00"],
      30199: ["", "by 2026-12-01 00:00"],
      30200: ["", ""],
    });
  });

  test("says what a price can't: in play, started, overdue or settled", async () => {
    const now = Date.UTC(2026, 10, 22, 12);
    const playing = summary(39393, {
      title: "Chargers vs Jets",
      kind: "contest_winner",
      status: "live",
      eventTime: now - 25 * 60_000,
      deadline: now + 90 * 86_400_000,
    });
    const event = summary(19991, { title: "FOMC decision", kind: "policy_rate", status: "live" });
    const overdue = summary(43470, {
      title: "BTC above 60,000 at Nov 22 10:00 UTC",
      status: "awaiting",
      eventTime: now - 2 * 3_600_000,
      deadline: now - 2 * 3_600_000,
    });
    const settling = summary(43471, { title: "BTC above 61,000 at Nov 22 10:00 UTC" });
    start([btc, playing, event, overdue, settling]);
    const c = cell();
    market("", 10, c);
    await live();
    const status = () => Object.fromEntries(c.value.slice(1).map((r) => [r[0], r[2]]));
    assert.deepEqual(status(), {
      41294: "Open",
      39393: "Started 25m ago",
      19991: "In play",
      43470: "Settlement was due 2h ago",
      43471: "Open",
    });
    assert.equal(c.value.find((r) => r[0] === 39393)[11], "Started 2026-11-22 11:35");
    FakeEventSource.last.send([{ ...settling, status: "settled", settledSide: 0 }]);
    assert.equal(status()[43471], "Settled");
  });

  test("keeps to the limit and picks up new listings on its next search", async (t) => {
    const markets = [btc, eth, game];
    start(markets);
    const c = cell();
    market(null, 2, c);
    await live();
    assert.deepEqual(
      c.value.slice(1).map((r) => r[0]),
      [41294, 41300],
    );
    markets.unshift(summary(41400, { volume24h: 999999 }));
    t.mock.timers.tick(60_000);
    await settle();
    assert.deepEqual(
      c.value.slice(1).map((r) => r[0]),
      [41400, 41294],
    );
  });

  test("answers #N/A when nothing matches and #VALUE! for a bad limit", async () => {
    start();
    const none = cell();
    const zero = cell();
    const big = cell();
    market("nothing like this", null, none);
    market("btc", 0, zero);
    market("btc", 101, big);
    await live();
    assert.deepEqual(
      [none.value.code, none.value.message],
      ["#N/A", 'No live market matches "nothing like this".'],
    );
    assert.equal(zero.value.code, "#VALUE!");
    assert.equal(big.value.code, "#VALUE!");
  });

  test("keeps the last table while a refresh fails", async (t) => {
    let calls = 0;
    start([btc], {
      "markets.list": (input) => {
        if (!input?.q) return ok([btc]);
        calls++;
        return calls === 1
          ? ok([btc])
          : failed(429, "Too many requests. Try again in a second.", "TOO_MANY_REQUESTS", {
              "retry-after": "2",
            });
      },
    });
    const c = cell();
    market("btc", null, c);
    await live();
    t.mock.timers.tick(60_000);
    await settle();
    assert.equal(calls, 2);
    assert.equal(c.values.length, 1);
    assert.equal(c.value[1][0], 41294);
  });

  test("says why when the first search fails", async () => {
    start([btc], {
      "markets.list": (input) =>
        input?.q ? failed(503, "Markets are still loading.", "SERVICE_UNAVAILABLE") : ok([btc]),
    });
    const c = cell();
    market("btc", null, c);
    await live();
    assert.deepEqual(
      [c.value.code, c.value.message],
      ["#N/A", "Hyperodds is unavailable right now. Retrying."],
    );
  });
});
