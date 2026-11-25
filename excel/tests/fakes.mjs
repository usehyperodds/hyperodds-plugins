// Stand-ins for the browser's EventSource and the Hyperodds API.

export function summary(outcome, overrides = {}) {
  return {
    outcome,
    questionId: null,
    role: "standalone",
    deployer: "hl",
    deployerName: "Hyperliquid",
    kind: "price_binary",
    title: `Market ${outcome}`,
    label: `Market ${outcome}`,
    questionTitle: null,
    sideLabels: ["Yes", "No"],
    category: "crypto",
    subcategory: "BTC",
    eventTime: Date.UTC(2026, 10, 21, 6),
    deadline: Date.UTC(2026, 10, 21, 6),
    status: "open",
    settledSide: null,
    bid: 0.47,
    ask: 0.48,
    mid: 0.475,
    lastPx: 0.471,
    volume24h: 82897,
    fair: { p: 0.5, lo: 0.48, hi: 0.52, method: "options", singleSource: false, confidence: 0.8, flags: [] },
    edge: {
      refUsd: 100,
      buy0: 1.234,
      buy1: -3.1,
      sell0: -0.5,
      sell1: 0.2,
      best: { side: 0, action: "buy", pts: 1.234 },
    },
    ...overrides,
  };
}

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const ok = (data) => json(200, { result: { data } });
export const failed = (status, message, code, headers) =>
  json(status, { error: { message, code: -32000, data: { code, httpStatus: status } } }, headers);

// Answers /trpc calls from a handler keyed by procedure, and records every call it gets.
export function api(handlers) {
  const calls = [];
  const fetch = async (url) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace("/trpc/", "");
    const input = searchParams.has("input") ? JSON.parse(searchParams.get("input")) : undefined;
    calls.push({ path, input });
    const handler = handlers[path];
    if (!handler) throw new TypeError("fetch failed");
    return handler(input, calls);
  };
  return { fetch, calls };
}

export class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = {};
    FakeEventSource.instances.push(this);
  }

  static get last() {
    return FakeEventSource.instances.at(-1);
  }

  static reset() {
    FakeEventSource.instances = [];
  }

  addEventListener(type, fn) {
    this.listeners[type] = [...(this.listeners[type] ?? []), fn];
  }

  close() {
    this.readyState = 2;
  }

  dispatch(type, data = "") {
    for (const fn of this.listeners[type] ?? []) fn({ data });
  }

  // A working stream: the server's hello, then the first event that shows it delivers.
  connect() {
    this.readyState = 1;
    this.dispatch("connected", JSON.stringify({ reconnectAfterInactivityMs: 45000 }));
    this.dispatch("ping");
  }

  // What the six-stream cap looks like: the hello, then the refusal, and the stream ends.
  refuse(message = "Too many live streams are open from here. Close a tab and try again.") {
    this.readyState = 1;
    this.dispatch("connected", JSON.stringify({ reconnectAfterInactivityMs: 45000 }));
    this.dispatch("serialized-error", JSON.stringify({ message, data: { code: "TOO_MANY_REQUESTS" } }));
  }

  send(batch) {
    this.dispatch("message", JSON.stringify(batch));
  }

  drop(readyState = 0) {
    this.readyState = readyState;
    this.dispatch("error");
  }
}

// A cell: records what a streaming function sends it.
export function cell() {
  const values = [];
  return {
    values,
    setResult: (value) => values.push(value),
    get value() {
      return values.at(-1);
    },
    cancel() {
      this.onCanceled?.();
    },
  };
}

// Lets fetch promises and the microtasks after them settle.
export const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};
