import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { ApiError, query, retryDelay } from "../src/api.js";
import { createFeed } from "../src/feed.js";
import { api, FakeEventSource, failed, ok, settle, summary } from "./fakes.mjs";

const a = summary(1);
const b = summary(2);
const START = Date.UTC(2026, 10, 22, 12);
let feed;

function open(handlers = {}, options = {}) {
  const network = api({ "markets.list": () => ok([a, b]), ...handlers });
  feed = createFeed({
    base: "https://api.test",
    fetch: network.fetch,
    EventSource: FakeEventSource,
    ...options,
  });
  const statuses = [];
  const infos = [];
  feed.onStatus((s, info) => {
    if (statuses.at(-1) !== s) statuses.push(s);
    infos.push(info);
  });
  const snapshots = () => network.calls.filter((c) => c.input?.includeSettled).length;
  return { network, statuses, infos, snapshots };
}

// What a cell would show: Excel only gets a value when it changes.
const seen = (outcome) => {
  const values = [];
  feed.watch(outcome, (s, error) => {
    const value = s ? s.mid : error?.since ? "stale" : error ? "error" : "missing";
    if (values.at(-1) !== value) values.push(value);
  });
  return values;
};

// Ticks one second at a time so promises settle between timers, and records when snapshots were asked for.
async function run(t, seconds, each = () => {}) {
  for (let s = 0; s < seconds; s++) {
    await each(s);
    t.mock.timers.tick(1000);
    await settle();
  }
}

beforeEach((t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: START });
  FakeEventSource.reset();
});

afterEach(() => feed?.close());

test("every cell shares one stream and one snapshot, taken at once and again when the stream connects", async () => {
  const { snapshots } = open();
  const one = seen(1);
  const two = seen(2);
  const again = seen(1);
  await settle();
  assert.equal(snapshots(), 1);
  assert.deepEqual([one, two, again], [[0.475], [0.475], [0.475]]);
  assert.equal(FakeEventSource.instances.length, 1);
  assert.equal(FakeEventSource.last.url, "https://api.test/trpc/live.summaries");
  FakeEventSource.last.connect();
  await settle();
  assert.equal(snapshots(), 2);
});

test("the first snapshot loads at once, and updates that land while it loads are kept", async () => {
  let release;
  const { network } = open({
    "markets.list": () => new Promise((resolve) => (release = () => resolve(ok([a, b])))),
  });
  const values = seen(1);
  await settle();
  assert.equal(network.calls.length, 1);
  FakeEventSource.last.connect();
  await settle();
  assert.equal(network.calls.length, 1);
  FakeEventSource.last.send([{ ...a, mid: 0.6 }]);
  release();
  await settle();
  assert.deepEqual(values, [0.6]);
});

test("each reconnect takes a fresh snapshot, so nothing missed in between goes stale", async () => {
  let mid = 0.475;
  const { snapshots, statuses } = open({ "markets.list": () => ok([{ ...a, mid }, b]) });
  const values = seen(1);
  await settle();
  const es = FakeEventSource.last;
  es.connect();
  await settle();
  es.drop(0);
  mid = 0.5;
  es.connect();
  await settle();
  assert.equal(snapshots(), 3);
  assert.deepEqual(values, [0.475, 0.5]);
  assert.deepEqual(statuses, ["idle", "connecting", "live", "reconnecting", "live"]);
});

test("falls back to polling when the stream refuses, says why, and returns to it later", async (t) => {
  const { snapshots, statuses, infos } = open();
  seen(1);
  await settle();
  const first = FakeEventSource.last;
  first.refuse();
  await settle();
  assert.equal(first.readyState, 2);
  assert.equal(feed.status, "polling");
  assert.equal(infos.at(-1).note, "Too many live streams are open from here. Close a tab and try again.");
  const before = snapshots();
  t.mock.timers.tick(15_000);
  await settle();
  assert.equal(snapshots(), before + 1);
  t.mock.timers.tick(15_000);
  await settle();
  assert.equal(FakeEventSource.instances.length, 2);
  FakeEventSource.last.connect();
  await settle();
  const polled = snapshots();
  await run(t, 60, (s) => s % 15 === 14 && FakeEventSource.last.dispatch("ping"));
  assert.equal(snapshots(), polled);
  assert.deepEqual(statuses, ["idle", "connecting", "polling", "live"]);
});

test("the stream cap backs off from 30 s to 5 minutes and never flicks to live", async (t) => {
  const { statuses, snapshots } = open();
  seen(1);
  await settle();
  const opened = [];
  await run(t, 600, (s) => {
    const es = FakeEventSource.last;
    if (es.refused) return;
    es.refused = true;
    opened.push(s);
    es.refuse();
  });
  assert.deepEqual(opened, [0, 30, 90, 210, 450]);
  assert.deepEqual(statuses, ["idle", "connecting", "polling"]);
  assert.ok(snapshots() <= 600 / 15 + opened.length, `${snapshots()} snapshots in 10 minutes`);
});

test("a stream that can't connect, retried every 3 s by EventSource, polls and backs off", async (t) => {
  const { snapshots } = open();
  const values = seen(1);
  await settle();
  const opened = [];
  await run(t, 80, (s) => {
    const es = FakeEventSource.last;
    if (es.failed) return;
    es.failed = true;
    opened.push(s);
    es.drop(0);
  });
  assert.equal(feed.status, "polling");
  assert.deepEqual(values, [0.475]);
  assert.deepEqual(opened, [0, 5, 15, 35, 75]);
  assert.ok(snapshots() >= 5);
});

test("offline from the start: cells say so within a second instead of waiting", async (t) => {
  open({ "markets.list": () => Promise.reject(new TypeError("fetch failed")) });
  const values = seen(1);
  await settle();
  FakeEventSource.last.drop(0);
  await settle();
  assert.deepEqual(values, ["error"]);
  await run(t, 30, (s) => s % 3 === 0 && FakeEventSource.last.drop(0));
  assert.equal(feed.status, "polling");
});

test("polls when the stream closes for good, backing off before it tries the stream again", async (t) => {
  open();
  seen(1);
  await settle();
  FakeEventSource.last.drop(2);
  await settle();
  assert.equal(feed.status, "polling");
  t.mock.timers.tick(5000);
  assert.equal(FakeEventSource.instances.length, 2);
  FakeEventSource.last.drop(2);
  t.mock.timers.tick(5000);
  assert.equal(FakeEventSource.instances.length, 2);
  t.mock.timers.tick(5000);
  assert.equal(FakeEventSource.instances.length, 3);
});

test("a live stream that drops is let reconnect once, then backed off like a snapshot", async (t) => {
  open();
  seen(1);
  await settle();
  const es = FakeEventSource.last;
  es.connect();
  await settle();
  es.drop(0);
  assert.equal(feed.status, "reconnecting");
  assert.equal(es.readyState, 0);
  es.drop(0);
  assert.equal(es.readyState, 2);
  assert.equal(feed.status, "polling");
  const opened = [];
  await run(t, 40, (s) => {
    const next = FakeEventSource.last;
    if (next === es || next.failed) return;
    next.failed = true;
    opened.push(s);
    next.drop(0);
  });
  assert.deepEqual(opened, [5, 15, 35]);
});

test("polls at once when the stream can't get through, and goes live when it does", async (t) => {
  const { snapshots } = open();
  const values = seen(1);
  await settle();
  FakeEventSource.last.drop(0);
  await settle();
  assert.equal(feed.status, "polling");
  assert.deepEqual(values, [0.475]);
  assert.equal(snapshots(), 1);
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(FakeEventSource.instances.length, 2);
  FakeEventSource.last.connect();
  await settle();
  assert.equal(feed.status, "live");
  assert.equal(snapshots(), 2);
});

test("polls when the runtime has no EventSource", async (t) => {
  const network = api({ "markets.list": () => ok([a]) });
  feed = createFeed({
    base: "https://api.test",
    fetch: network.fetch,
    EventSource: undefined,
    pollMs: 15_000,
  });
  const values = seen(1);
  await settle();
  assert.equal(feed.status, "polling");
  assert.deepEqual(values, [0.475]);
  t.mock.timers.tick(15_000);
  await settle();
  assert.equal(network.calls.length, 2);
});

test("opens a new stream when the server goes quiet past its own inactivity limit", async (t) => {
  open();
  seen(1);
  await settle();
  const first = FakeEventSource.last;
  first.connect();
  await settle();
  t.mock.timers.tick(30_000);
  first.dispatch("ping");
  t.mock.timers.tick(30_000);
  assert.equal(FakeEventSource.instances.length, 1);
  t.mock.timers.tick(15_000);
  assert.equal(first.readyState, 2);
  assert.equal(FakeEventSource.instances.length, 2);
});

test("a snapshot that never answers times out, and updates that arrived meanwhile still reach cells", async (t) => {
  let hang = true;
  open({ "markets.list": () => (hang ? new Promise(() => {}) : ok([a, b])) });
  const values = seen(1);
  await settle();
  FakeEventSource.last.connect();
  await settle();
  FakeEventSource.last.send([{ ...a, mid: 0.6 }]);
  assert.deepEqual(values, []);
  hang = false;
  t.mock.timers.tick(15_000);
  await settle();
  assert.deepEqual(values, [0.6]);
  t.mock.timers.tick(5000);
  await settle();
  FakeEventSource.last.send([{ ...a, mid: 0.7 }]);
  assert.deepEqual(values.slice(-2), [0.475, 0.7]);
});

test("retries a failed snapshot after the server's Retry-After", async (t) => {
  let busy = true;
  const { snapshots } = open({
    "markets.list": () =>
      busy ? failed(429, "Too many requests.", "TOO_MANY_REQUESTS", { "retry-after": "7" }) : ok([a]),
  });
  const values = seen(1);
  await settle();
  FakeEventSource.last.connect();
  await settle();
  assert.deepEqual(values, ["error"]);
  busy = false;
  t.mock.timers.tick(6_999);
  await settle();
  assert.equal(snapshots(), 1);
  t.mock.timers.tick(1);
  await settle();
  assert.deepEqual(values, ["error", 0.475]);
});

test("polling waits as long as a 429's Retry-After asks, not its own 15 s", async (t) => {
  let busy = false;
  const asked = [];
  open({
    "markets.list": () => {
      asked.push((Date.now() - START) / 1000);
      return busy ? failed(429, "Too many requests.", "TOO_MANY_REQUESTS", { "retry-after": "40" }) : ok([a]);
    },
  });
  seen(1);
  await settle();
  FakeEventSource.last.drop(2);
  await settle();
  busy = true;
  await run(t, 70);
  assert.deepEqual(asked, [0, 15, 55]);
});

test("a run of 503s backs off instead of asking every 3 s", async (t) => {
  const asked = [];
  open({
    "markets.list": () => {
      asked.push((Date.now() - START) / 1000);
      return failed(503, "The database is not reachable right now.", "SERVICE_UNAVAILABLE");
    },
  });
  seen(1);
  await settle();
  FakeEventSource.last.connect();
  await settle();
  await run(t, 160);
  assert.deepEqual(asked, [0, 3, 9, 21, 45, 93, 153]);
});

test("cells switch at two minutes without data, whatever the retry schedule, and recover", async (t) => {
  let down = false;
  const { statuses } = open({
    "markets.list": () => (down ? Promise.reject(new TypeError("fetch failed")) : ok([a])),
  });
  const values = seen(1);
  await settle();
  FakeEventSource.last.drop(2);
  await settle();
  down = true;
  await run(t, 119);
  assert.deepEqual(values, [0.475]);
  await run(t, 2);
  assert.deepEqual(values, [0.475, "stale"]);
  assert.equal(feed.status, "offline");
  down = false;
  await run(t, 50);
  assert.deepEqual(values, [0.475, "stale", 0.475]);
  assert.equal(feed.status, "polling");
  assert.deepEqual(statuses.slice(-2), ["offline", "polling"]);
});

test("the status carries why the last snapshot failed and how long until the next try", async (t) => {
  let answer = () => failed(429, "Too many requests.", "TOO_MANY_REQUESTS", { "retry-after": "30" });
  const { infos } = open({ "markets.list": () => answer() });
  seen(1);
  await settle();
  assert.deepEqual(infos.at(-1).problem, { kind: "rate-limited", waitS: 30 });
  assert.equal(infos.at(-1).loaded, false);
  answer = () => ok([a]);
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(infos.at(-1).problem, null);
  assert.equal(infos.at(-1).loaded, true);
});

test("cells with the same search share one query, which asks for twice the rows", async () => {
  const { network } = open();
  const one = [];
  const two = [];
  feed.search({ q: "btc", limit: 5 }, (rows) => one.push(rows));
  feed.search({ q: "btc", limit: 5 }, (rows) => two.push(rows));
  await settle();
  const searches = network.calls.filter((c) => c.input?.sort);
  assert.deepEqual(
    searches.map((c) => c.input),
    [{ sort: "volume", limit: 10, q: "btc" }],
  );
  assert.equal(one.length, 1);
  assert.equal(two.length, 1);
  const late = [];
  feed.search({ q: "btc", limit: 5 }, (rows) => late.push(rows));
  await settle();
  assert.equal(late.length, 1);
  assert.equal(network.calls.filter((c) => c.input?.sort).length, 1);
});

test("closes the stream once no cell has needed it for half a minute", async (t) => {
  open();
  const stop = feed.watch(1, () => {});
  const stopOther = feed.search({ q: "", limit: 5 }, () => {});
  await settle();
  const es = FakeEventSource.last;
  es.connect();
  await settle();
  stop();
  t.mock.timers.tick(40_000);
  es.dispatch("ping");
  assert.equal(es.readyState, 1);
  stopOther();
  t.mock.timers.tick(20_000);
  es.dispatch("ping");
  feed.watch(2, () => {})();
  t.mock.timers.tick(29_999);
  assert.equal(es.readyState, 1);
  t.mock.timers.tick(1);
  assert.equal(es.readyState, 2);
  assert.equal(feed.status, "idle");
});

test("query sends a simple GET and turns tRPC errors into ApiError", async () => {
  const network = api({
    "markets.get": (input) =>
      input.outcome === 1
        ? ok({ summary: a })
        : failed(404, "No such market.", "NOT_FOUND", { "retry-after": "3" }),
  });
  assert.deepEqual(await query(network.fetch, "https://api.test", "markets.get", { outcome: 1 }), {
    summary: a,
  });
  const error = await query(network.fetch, "https://api.test", "markets.get", { outcome: 2 }).catch((e) => e);
  assert.ok(error instanceof ApiError);
  assert.deepEqual([error.message, error.status, error.retryAfter], ["No such market.", 404, 3]);
  const offline = await query(network.fetch, "https://api.test", "nope").catch((e) => e);
  assert.deepEqual([offline.message, offline.status], ["Can't reach Hyperodds.", 0]);
  assert.ok(offline.cause instanceof TypeError);
});

test("query gives up on an answer that never comes", async (t) => {
  const network = api({ "markets.list": () => new Promise(() => {}) });
  const pending = query(network.fetch, "https://api.test", "markets.list").catch((e) => e);
  t.mock.timers.tick(15_000);
  const error = await pending;
  assert.deepEqual([error.message, error.kind], ["Hyperodds took too long to answer.", "unreachable"]);
});

test("query tells a browser's CORS block from a dead server, and both from being offline", async () => {
  const failing = (healthy) => async (_url, init) => {
    if (init?.mode === "no-cors" && healthy) return new Response(null, { status: 200 });
    throw new TypeError("Failed to fetch");
  };
  const kind = (fetch, browser) =>
    query(fetch, "https://api.test", "markets.list", undefined, { browser }).catch((e) => e.kind);
  assert.equal(await kind(failing(true), true), "blocked");
  assert.equal(await kind(failing(false), true), "unreachable");
  assert.equal(await kind(failing(true), false), "unreachable");
  Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
  try {
    assert.equal(await kind(failing(true), true), "offline");
  } finally {
    delete globalThis.navigator.onLine;
  }
  const limited = api({
    "markets.list": () => failed(429, "Too many requests.", "TOO_MANY_REQUESTS", { "retry-after": "9" }),
  });
  const error = await query(limited.fetch, "https://api.test", "markets.list").catch((e) => e);
  assert.deepEqual([error.kind, error.retryAfter], ["rate-limited", 9]);
});

test("retry delays follow Retry-After, a short then growing wait on 503, and a capped backoff", () => {
  assert.equal(retryDelay(new ApiError("", { status: 429, retryAfter: 4 }), 0), 4000);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((n) => retryDelay(new ApiError("", { status: 503 }), n)),
    [3000, 6000, 12000, 24000, 48000, 60000],
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((n) => retryDelay(new ApiError(""), n)),
    [5000, 10000, 20000, 40000, 60000],
  );
});
