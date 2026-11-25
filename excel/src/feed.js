import { API, ApiError, query, retryDelay } from "./api.js";

const CLOSED = 2;

// The server's own words for why it ended a stream, such as the per-address cap's "Close a tab".
function messageOf(data) {
  try {
    return JSON.parse(data).message ?? null;
  } catch {
    return null;
  }
}

// One feed per workbook runtime. Every cell shares a single live.summaries stream (the API allows six
// streams per address) and one snapshot of every market; each distinct search adds one light query a minute.
export function createFeed({
  base = API,
  fetch = (url, init) => globalThis.fetch(url, init),
  EventSource = globalThis.EventSource,
  browser = typeof window !== "undefined",
  now = () => Date.now(),
  pollMs = 15_000,
  searchMs = 60_000,
  graceMs = 10_000,
  idleMs = 30_000,
  staleMs = 120_000,
} = {}) {
  const markets = new Map();
  const watchers = new Map();
  const searches = new Map();
  const statusListeners = new Set();
  const timers = {};
  let mode = "idle";
  let note = null;
  let shown = null;
  let loaded = false;
  let failure = null;
  let failureWait = 0;
  let stale = false;
  let lastDataAt = 0;
  let lastSyncAt = 0;
  let holdUntil = 0;
  let syncing = null;
  let pending = [];
  let source = null;
  let syncAttempt = 0;
  let streamAttempt = 0;
  let inactivityMs = 45_000;

  const ask = (path, input) => query(fetch, base, path, input, { browser });
  const state = () => (stale && mode !== "idle" ? "offline" : mode);
  const staleError = () => new ApiError("No update from Hyperodds.", { since: lastDataAt });

  // What the status line needs: the server's note on a refused stream, and why the last snapshot failed.
  function info() {
    const problem = failure ? { kind: failure.kind, waitS: Math.round(failureWait / 1000) } : null;
    return { note, loaded, problem };
  }

  function report() {
    const { problem } = info();
    const key = [state(), note, loaded, problem?.kind, problem?.waitS].join("|");
    if (key === shown) return;
    shown = key;
    for (const fn of statusListeners) fn(state(), info());
  }

  function setMode(next, why = null) {
    mode = next;
    note = why;
    report();
  }

  // [summary, error] for an outcome, or null while the first snapshot is still on its way.
  function stateOf(outcome) {
    if (stale) return [null, staleError()];
    const summary = markets.get(outcome) ?? null;
    if (summary || loaded) return [summary, null];
    return failure ? [null, failure] : null;
  }

  function notify(outcome) {
    const result = stateOf(outcome);
    if (!result) return;
    for (const fn of watchers.get(outcome) ?? []) fn(...result);
  }

  // Settled markets stay in a table, marked, until its next search drops them; removed ones go at once.
  function resultOf(entry) {
    if (stale) return [null, staleError()];
    if (!entry.outcomes) return [null, entry.error];
    const rows = entry.outcomes
      .map((outcome) => markets.get(outcome) ?? entry.rows.get(outcome))
      .filter((s) => s.role !== "fallback" && s.status !== "removed")
      .slice(0, entry.limit);
    return [rows, null];
  }

  function emit(entry) {
    const result = resultOf(entry);
    for (const fn of entry.fns) fn(...result);
  }

  function notifyAll() {
    for (const outcome of watchers.keys()) notify(outcome);
    for (const entry of searches.values()) if (entry.outcomes || stale) emit(entry);
  }

  // Cells switch to an error two minutes after the last data, whatever the retry schedule is doing.
  function goStale() {
    if (!loaded || mode === "idle" || stale) return;
    stale = true;
    report();
    notifyAll();
  }

  function fresh() {
    lastDataAt = now();
    clearTimeout(timers.stale);
    timers.stale = setTimeout(goStale, staleMs);
    if (!stale) return;
    stale = false;
    report();
    notifyAll();
  }

  function apply(batch) {
    for (const summary of batch) markets.set(summary.outcome, summary);
  }

  // A pending timer only asks again while polling, or to retry a snapshot that failed.
  function schedule(wait) {
    clearTimeout(timers.sync);
    timers.sync = setTimeout(() => {
      if (mode === "polling" || failure) sync();
    }, wait);
  }

  function sync() {
    syncing ??= (async () => {
      clearTimeout(timers.sync);
      let delay = 0;
      try {
        const list = await ask("markets.list", { includeSettled: true });
        markets.clear();
        apply(list);
        loaded = true;
        failure = null;
        syncAttempt = 0;
        lastSyncAt = now();
        fresh();
      } catch (error) {
        failure = error;
        delay = retryDelay(error, syncAttempt++);
        holdUntil = now() + delay;
      } finally {
        for (const batch of pending) apply(batch);
        pending = [];
        syncing = null;
      }
      // Read after the await: poll() can start while a snapshot is on its way.
      const wait = Math.max(mode === "polling" ? pollMs : 0, delay);
      failureWait = failure ? wait : 0;
      if (wait && mode !== "idle") schedule(wait);
      report();
      notifyAll();
    })();
    return syncing;
  }

  // Asks for a snapshot now unless the server asked us to wait; the retry timer covers that case.
  function syncSoon() {
    if (!syncing && now() >= holdUntil) sync();
  }

  function receive(batch) {
    if (syncing) return void pending.push(batch);
    apply(batch);
    for (const { outcome } of batch) notify(outcome);
    for (const entry of searches.values()) {
      if (batch.some((s) => entry.outcomes?.includes(s.outcome))) emit(entry);
    }
  }

  function stopGrace() {
    clearTimeout(timers.grace);
    timers.grace = null;
  }

  function startGrace() {
    if (timers.grace || mode === "polling") return;
    timers.grace = setTimeout(() => {
      timers.grace = null;
      poll();
    }, graceMs);
  }

  // Refreshes every pollMs without asking again sooner than that after a snapshot that just landed.
  function poll(why = null) {
    stopGrace();
    if (mode === "polling" && note === why) return;
    const already = mode === "polling";
    setMode("polling", why);
    if (already || syncing) return;
    const due = lastSyncAt + pollMs - now();
    if (due > 0 && !failure) schedule(due);
    else syncSoon();
  }

  function drop(es) {
    es.close();
    clearTimeout(timers.watchdog);
    if (source === es) source = null;
  }

  // The server pings after 15 s without an update; a stream silent for longer than it asks is dead.
  function arm(ms) {
    if (ms) inactivityMs = ms;
    clearTimeout(timers.watchdog);
    const es = source;
    timers.watchdog = setTimeout(() => {
      drop(es);
      if (mode === "live") setMode("reconnecting");
      connect();
    }, inactivityMs);
  }

  // A stream counts as live once it delivers: a refused one still sends "connected" before its error.
  function confirm() {
    streamAttempt = 0;
    if (mode !== "live") setMode("live");
  }

  // The stream cap waits 30 s, doubling to 5 minutes, for a tab to close; an outage backs off like a
  // snapshot does, 5 s doubling to a minute.
  function reopenLater(capped) {
    const n = streamAttempt++;
    const ms = capped ? Math.min(300_000, 30_000 * 2 ** n) : Math.min(60_000, 5000 * 2 ** n);
    clearTimeout(timers.reopen);
    timers.reopen = setTimeout(connect, ms);
  }

  function connect() {
    if (!EventSource) return poll();
    const es = new EventSource(`${base}/trpc/live.summaries`);
    source = es;
    stopGrace();
    startGrace();
    es.addEventListener("connected", (event) => {
      es.opened = true;
      es.retried = false;
      stopGrace();
      fresh();
      arm(JSON.parse(event.data || "{}").reconnectAfterInactivityMs);
      syncSoon();
    });
    es.addEventListener("ping", () => {
      fresh();
      arm();
      confirm();
    });
    es.addEventListener("message", (event) => {
      fresh();
      arm();
      confirm();
      receive(JSON.parse(event.data));
    });
    es.addEventListener("serialized-error", (event) => {
      drop(es);
      poll(messageOf(event.data));
      reopenLater(true);
    });
    es.addEventListener("error", () => {
      if (es !== source) return;
      // Every stream ends after ten minutes and EventSource reconnects by itself; one retry of a stream
      // that was open is that. Anything else is an outage: poll, and reopen on our own backoff rather than
      // EventSource's few seconds.
      if (es.readyState !== CLOSED && es.opened && !es.retried) {
        es.retried = true;
        if (mode === "live") setMode("reconnecting");
        startGrace();
        return;
      }
      drop(es);
      poll();
      reopenLater(false);
    });
  }

  function wake() {
    clearTimeout(timers.idle);
    if (mode !== "idle") return;
    setMode("connecting");
    syncSoon();
    connect();
  }

  function close() {
    for (const entry of searches.values()) {
      entry.live = false;
      clearTimeout(entry.timer);
    }
    searches.clear();
    watchers.clear();
    if (source) drop(source);
    stopGrace();
    for (const key of ["sync", "reopen", "idle", "watchdog", "stale"]) clearTimeout(timers[key]);
    loaded = false;
    failure = null;
    failureWait = 0;
    stale = false;
    lastDataAt = 0;
    lastSyncAt = 0;
    holdUntil = 0;
    syncAttempt = 0;
    streamAttempt = 0;
    setMode("idle");
  }

  function rest() {
    if (watchers.size || searches.size) return;
    clearTimeout(timers.idle);
    timers.idle = setTimeout(close, idleMs);
  }

  function watch(outcome, fn) {
    if (!watchers.has(outcome)) watchers.set(outcome, new Set());
    const fns = watchers.get(outcome);
    fns.add(fn);
    wake();
    queueMicrotask(() => {
      const result = stateOf(outcome);
      if (result && fns.has(fn)) fn(...result);
    });
    return () => {
      fns.delete(fn);
      if (!fns.size) watchers.delete(outcome);
      rest();
    };
  }

  // Which markets match is the server's search (the console's), refreshed every minute for new listings;
  // their numbers come from the shared stream in between. Cells with the same search share one query.
  // Fallback outcomes trade no book, so they sort last by volume; twice the rows leaves room to drop them.
  function refresh(entry) {
    const input = { sort: "volume", limit: Math.min(1000, entry.limit * 2) };
    if (entry.q) input.q = entry.q;
    ask("markets.list", input).then(
      (rows) => {
        if (!entry.live) return;
        entry.rows = new Map(rows.map((s) => [s.outcome, s]));
        entry.outcomes = rows.map((s) => s.outcome);
        entry.error = null;
        entry.attempt = 0;
        emit(entry);
        entry.timer = setTimeout(() => refresh(entry), searchMs);
      },
      (error) => {
        if (!entry.live) return;
        entry.error = error;
        if (!entry.outcomes) emit(entry);
        entry.timer = setTimeout(() => refresh(entry), retryDelay(error, entry.attempt++));
      },
    );
  }

  function search({ q, limit }, fn) {
    const key = `${limit}|${q}`;
    let entry = searches.get(key);
    const created = !entry;
    if (created) {
      entry = {
        q,
        limit,
        fns: new Set(),
        outcomes: null,
        rows: new Map(),
        error: null,
        timer: null,
        live: true,
        attempt: 0,
      };
      searches.set(key, entry);
    }
    entry.fns.add(fn);
    wake();
    if (created) refresh(entry);
    else if (entry.outcomes || entry.error || stale) {
      queueMicrotask(() => {
        if (entry.fns.has(fn)) fn(...resultOf(entry));
      });
    }
    return () => {
      entry.fns.delete(fn);
      if (entry.fns.size) return;
      entry.live = false;
      clearTimeout(entry.timer);
      searches.delete(key);
      rest();
    };
  }

  function onStatus(fn) {
    statusListeners.add(fn);
    fn(state(), info());
    return () => statusListeners.delete(fn);
  }

  return {
    watch,
    search,
    onStatus,
    close,
    get status() {
      return state();
    },
  };
}
