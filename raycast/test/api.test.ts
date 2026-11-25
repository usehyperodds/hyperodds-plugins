import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  API,
  ApiError,
  createClient,
  MAX_PINS,
  marketUrl,
  parseOutcome,
  retryAfterSeconds,
  retryDelay,
} from "../src/lib/api.ts";
import { btc, fakeFetch, game, input, trpc, trpcError } from "./fixtures.ts";

const notFound = trpcError("No such market.", "NOT_FOUND", 404);

describe("parseOutcome", () => {
  test("reads a market link or a #id", () => {
    assert.equal(parseOutcome(" #41294 "), 41294);
    assert.equal(parseOutcome("https://usehyperodds.com/m/41294"), 41294);
    assert.equal(parseOutcome("usehyperodds.com/m/41294?side=1"), 41294);
    assert.equal(parseOutcome("https://www.usehyperodds.com/m/7/"), 7);
  });

  test("leaves search text alone", () => {
    for (const text of [
      "btc",
      "",
      "41294",
      "btc 62000",
      "41294x",
      "https://usehyperodds.com/m/41294abc",
      "1234567890",
    ]) {
      assert.equal(parseOutcome(text), null, text);
    }
  });

  test("links to the market page", () => {
    assert.equal(marketUrl(41294), "https://usehyperodds.com/m/41294");
  });
});

describe("queries", () => {
  test("search sends a plain GET to markets.list with the API's input", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: trpc([btc]) }));
    const markets = await createClient({ fetch }).search({ q: "  btc  ", category: "crypto" });
    assert.deepEqual(markets, [btc]);
    const [{ url, init }] = calls;
    assert.equal(url.origin + url.pathname, `${API}/trpc/markets.list`);
    assert.deepEqual(input(url), { limit: 50, q: "btc", category: "crypto" });
    assert.equal(init?.method, undefined);
    assert.deepEqual(init?.headers, { accept: "application/json", "user-agent": "hyperodds-raycast" });
  });

  test("an empty search asks for the busiest markets and trims long text to the API's 100 characters", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: trpc([]) }));
    const client = createClient({ fetch });
    await client.search();
    await client.search({ q: "x".repeat(150), limit: 5 });
    assert.deepEqual(input(calls[0].url), { limit: 50 });
    assert.deepEqual(input(calls[1].url), { limit: 5, q: "x".repeat(100) });
  });

  test("a link or a #id looks the market up directly, ignoring the category", async () => {
    const { fetch, calls } = fakeFetch((url) =>
      input(url) && (input(url) as { outcome: number }).outcome === 41294
        ? { body: trpc({ summary: btc, book: null, trades: [] }) }
        : { status: 404, body: notFound },
    );
    const client = createClient({ fetch });
    assert.deepEqual(await client.search({ q: "https://usehyperodds.com/m/41294", category: "sports" }), [
      btc,
    ]);
    assert.deepEqual(await client.search({ q: "#999999" }), []);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url.pathname, "/trpc/markets.get");
    assert.deepEqual(input(calls[0].url), { outcome: 41294 });
  });

  test("bare digits search the text too, with the market of that id first", async () => {
    const { fetch, calls } = fakeFetch((url) => {
      if (url.pathname === "/trpc/markets.list") return { body: trpc([game, btc]) };
      const { outcome } = input(url) as { outcome: number };
      return outcome === 41294 ? { body: trpc({ summary: btc }) } : { status: 404, body: notFound };
    });
    const client = createClient({ fetch });
    assert.deepEqual(await client.search({ q: "41294", category: "crypto" }), [btc, game]);
    assert.deepEqual(input(calls.find((c) => c.url.pathname === "/trpc/markets.list")!.url), {
      limit: 50,
      q: "41294",
      category: "crypto",
    });
    assert.deepEqual(await client.search({ q: "2026" }), [game, btc]);
    assert.equal(calls.length, 4);
  });

  test("lists leave out a question's fallback outcome, which has no book", async () => {
    const other = { ...btc, outcome: 41300, role: "fallback" as const };
    const { fetch } = fakeFetch(() => ({ body: trpc([btc, other, game]) }));
    const client = createClient({ fetch });
    assert.deepEqual(await client.search({ q: "btc" }), [btc, game]);
    assert.deepEqual(await client.newest(), [btc, game]);
  });

  test("categories come from the console's facets, largest first", async () => {
    const facets = {
      total: 301,
      categories: [
        { key: "sports", n: 145 },
        { key: "crypto", n: 93 },
      ],
      deployers: [],
    };
    const { fetch, calls } = fakeFetch(() => ({ body: trpc(facets) }));
    assert.deepEqual(await createClient({ fetch }).categories(), ["sports", "crypto"]);
    assert.equal(calls[0].url.pathname, "/trpc/markets.facets");
    assert.equal(calls[0].url.search, "");
    const broken = fakeFetch(() => ({ body: trpc({ total: 3 }) }));
    await assert.rejects(createClient({ fetch: broken.fetch }).categories(), /can't read/);
  });

  test("edges and new listings", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: trpc([btc, game]) }));
    const client = createClient({ fetch, base: "http://localhost:3100" });
    assert.equal((await client.edges(20)).length, 2);
    assert.equal((await client.newest()).length, 2);
    assert.equal(
      calls[0].url.href,
      `http://localhost:3100/trpc/markets.edges?input=${encodeURIComponent('{"limit":20}')}`,
    );
    assert.equal(calls[1].url.pathname, "/trpc/markets.newest");
    assert.deepEqual(input(calls[1].url), { limit: 50 });
  });
});

describe("pinned", () => {
  test("asks for every pin in one batch and keeps pin order", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      body: [trpc({ summary: game }), notFound, trpc({ summary: btc })],
      status: 207,
    }));
    const pinned = await createClient({ fetch }).pinned([39392, 5, 41294]);
    assert.deepEqual(pinned, [
      { outcome: 39392, market: game },
      { outcome: 5, market: null },
      { outcome: 41294, market: btc },
    ]);
    assert.equal(calls.length, 1);
    const { url } = calls[0];
    assert.equal(url.pathname, "/trpc/markets.get,markets.get,markets.get");
    assert.equal(url.searchParams.get("batch"), "1");
    assert.deepEqual(input(url), { 0: { outcome: 39392 }, 1: { outcome: 5 }, 2: { outcome: 41294 } });
  });

  test("no pins, no request", async () => {
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    assert.deepEqual(await createClient({ fetch }).pinned([]), []);
    assert.equal(calls.length, 0);
  });

  test("never sends more calls than one batch holds", async () => {
    const ids = Array.from({ length: MAX_PINS + 3 }, (_, i) => i + 1);
    const { fetch, calls } = fakeFetch(() => ({ body: ids.map(() => notFound), status: 404 }));
    const pinned = await createClient({ fetch }).pinned(ids);
    assert.equal(pinned.length, MAX_PINS);
    assert.equal(calls[0].url.pathname.split(",").length, MAX_PINS);
    assert.ok(pinned.every((p) => p.market === null));
  });

  test("a refused batch fails whole, with the API's message and wait", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 429,
      headers: { "retry-after": "3" },
      body: trpcError("Too many requests. Try again in a second.", "TOO_MANY_REQUESTS", 429),
    }));
    await assert.rejects(createClient({ fetch }).pinned([1, 2]), (error: ApiError) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, "Too many requests. Try again in a second.");
      assert.equal(error.status, 429);
      assert.equal(error.retryAfter, 3);
      return true;
    });
  });

  test("any other failed call inside the batch fails it", async () => {
    const loading = trpcError(
      "Markets are still loading. Try again in a few seconds.",
      "SERVICE_UNAVAILABLE",
      503,
    );
    const { fetch } = fakeFetch(() => ({ status: 207, body: [trpc({ summary: btc }), loading] }));
    await assert.rejects(createClient({ fetch }).pinned([41294, 2]), (error: ApiError) => {
      assert.match(error.message, /still loading/);
      assert.equal(error.status, 503);
      assert.equal(error.code, "SERVICE_UNAVAILABLE");
      return true;
    });
  });
});

describe("retries", () => {
  test("wait longer after each failure in a row, up to two minutes", () => {
    const offline = new ApiError("Can't reach Hyperodds. Check your connection.");
    assert.deepEqual(
      [1, 2, 3, 4, 10].map((n) => retryDelay(n, offline)),
      [30_000, 60_000, 120_000, 120_000, 120_000],
    );
  });

  test("never sooner than Retry-After asks", () => {
    const limited = new ApiError("Too many requests. Try again in a second.", {
      status: 429,
      retryAfter: 300,
    });
    assert.equal(retryDelay(1, limited), 300_000);
    assert.equal(retryDelay(1, new ApiError("x", { retryAfter: 1 })), 30_000);
    assert.equal(retryDelay(1, new Error("x")), 30_000);
  });
});

describe("errors", () => {
  test("the API's own message comes through", async () => {
    const { fetch } = fakeFetch(() => ({
      status: 400,
      body: trpcError("Too big: expected number to be <=1000 (limit)", "BAD_REQUEST", 400),
    }));
    await assert.rejects(createClient({ fetch }).search({ limit: 5000 }), (error: ApiError) => {
      assert.equal(error.message, "Too big: expected number to be <=1000 (limit)");
      assert.equal(error.code, "BAD_REQUEST");
      assert.equal(error.status, 400);
      return true;
    });
  });

  test("a bare answer from a proxy or firewall says what to do, with the wait when it is known", async () => {
    const cases: Array<[number, Record<string, string>, string, number]> = [
      [429, { "retry-after": "7" }, "Hyperodds is getting too many requests. Try again in 7 seconds.", 7],
      [429, {}, "Hyperodds is getting too many requests. Try again in a minute.", 0],
      [500, {}, "Something went wrong at Hyperodds. Try again in a minute.", 0],
      [503, { "retry-after": "1" }, "Hyperodds is unavailable right now. Try again in 1 second.", 1],
      [502, {}, "Hyperodds is unavailable right now. Try again in a minute.", 0],
      [403, {}, "Hyperodds refused the request.", 0],
      [418, {}, "Hyperodds answered 418.", 0],
    ];
    for (const [status, headers, message, retryAfter] of cases) {
      const { fetch } = fakeFetch(() => ({ status, headers, body: "<html>blocked</html>" }));
      await assert.rejects(createClient({ fetch }).search({ q: "btc" }), (error: ApiError) => {
        assert.equal(error.name, "ApiError");
        assert.equal(error.message, message);
        assert.equal(error.status, status);
        assert.equal(error.retryAfter, retryAfter);
        return true;
      });
    }
  });

  test("Retry-After as seconds or as an HTTP date", () => {
    const now = Date.UTC(2026, 10, 22, 18, 0, 0);
    assert.equal(retryAfterSeconds("30", now), 30);
    assert.equal(retryAfterSeconds("Sun, 22 Nov 2026 18:01:30 GMT", now), 90);
    assert.equal(retryAfterSeconds("Sun, 22 Nov 2026 17:00:00 GMT", now), 0);
    assert.equal(retryAfterSeconds(null, now), 0);
    assert.equal(retryAfterSeconds("soon", now), 0);
  });

  test("an answer that can't be read, even with a 200, says so", async () => {
    const unreadable = "Hyperodds sent an answer the extension can't read. Try again in a minute.";
    const portal = fakeFetch(() => ({ body: "<html>Sign in to the Wi-Fi</html>" }));
    await assert.rejects(createClient({ fetch: portal.fetch }).edges(), { message: unreadable });
    const shape = fakeFetch(() => ({ body: trpc({ items: [] }) }));
    await assert.rejects(createClient({ fetch: shape.fetch }).newest(), { message: unreadable });
    const summary = fakeFetch(() => ({ body: [trpc({ market: btc })] }));
    await assert.rejects(createClient({ fetch: summary.fetch }).pinned([41294]), { message: unreadable });
  });

  test("no connection, with the cause kept", async () => {
    const cause = new TypeError("fetch failed");
    const fetch = (async () => {
      throw cause;
    }) as typeof globalThis.fetch;
    await assert.rejects(createClient({ fetch }).newest(), (error: ApiError) => {
      assert.equal(error.name, "ApiError");
      assert.equal(error.message, "Can't reach Hyperodds. Check your connection.");
      assert.equal(error.cause, cause);
      return true;
    });
  });

  test("a slow answer times out, body included", async () => {
    const fetch = (async (_url: string, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"result":'));
          init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
        },
      });
      return new Response(body, { status: 200 });
    }) as typeof globalThis.fetch;
    await assert.rejects(createClient({ fetch, timeoutMs: 30 }).edges(), {
      name: "ApiError",
      message: "Hyperodds took too long to answer. Try again.",
    });
  });

  test("a caller's abort stays an abort", async () => {
    const fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
      )) as typeof globalThis.fetch;
    const controller = new AbortController();
    const pending = createClient({ fetch }).search({ q: "btc" }, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
  });
});
