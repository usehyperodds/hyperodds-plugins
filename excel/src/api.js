// A local build points this at another API (scripts/build.mjs, API_ORIGIN).
export const API = typeof HYPERODDS_API === "string" ? HYPERODDS_API : "https://api.usehyperodds.com";

// kind: "offline", "blocked" (the browser withheld the answer: CORS), "unreachable", "rate-limited" or
// "unavailable" (any other refusal).
export class ApiError extends Error {
  constructor(message, { status = 0, kind = "unavailable", retryAfter = 0, since = 0, cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
    this.retryAfter = retryAfter;
    this.since = since;
  }
}

function deadline(ms, message) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(message, { kind: "unreachable" })), ms);
  });
  return { promise, clear: () => clearTimeout(timer) };
}

// A browser reports a CORS refusal and a dead server the same way. A no-cors request reaches a live server
// and returns an opaque answer, so if it gets through, the browser blocked the real one.
async function networkError(fetch, base, cause, browser) {
  if (globalThis.navigator?.onLine === false)
    return new ApiError("You're offline.", { kind: "offline", cause });
  if (browser) {
    const wait = deadline(5000, "");
    const reached = await Promise.race([fetch(`${base}/healthz`, { mode: "no-cors" }), wait.promise]).then(
      () => true,
      () => false,
    );
    wait.clear();
    if (reached) return new ApiError("The browser blocked Hyperodds' answer.", { kind: "blocked", cause });
  }
  return new ApiError("Can't reach Hyperodds.", { kind: "unreachable", cause });
}

// A plain GET with no custom headers, so browsers send it as a simple CORS request with no preflight.
// The timeout also covers a fetch that ignores its abort signal, so a stalled answer can't hold up the feed.
export async function query(fetch, base, path, input, { timeoutMs = 15_000, browser = false } = {}) {
  const qs = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const controller = new AbortController();
  const wait = deadline(timeoutMs, "Hyperodds took too long to answer.");
  wait.promise.catch(() => controller.abort());
  try {
    let res;
    try {
      res = await Promise.race([
        fetch(`${base}/trpc/${path}${qs}`, { signal: controller.signal }),
        wait.promise,
      ]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw await networkError(fetch, base, error, browser);
    }
    const body = await Promise.race([res.json().catch(() => null), wait.promise]);
    if (res.ok && body?.result) return body.result.data;
    throw new ApiError(body?.error?.message ?? `Hyperodds answered ${res.status}.`, {
      status: res.status,
      kind: res.status === 429 ? "rate-limited" : "unavailable",
      retryAfter: Number(res.headers.get("retry-after")) || 0,
    });
  } finally {
    wait.clear();
  }
}

// How long to wait before asking again after a failed call. A 503 right after a restart clears in seconds;
// one that persists backs off like any other failure.
export function retryDelay(error, attempt) {
  if (error.retryAfter) return error.retryAfter * 1000;
  if (error.status === 503) return Math.min(60_000, 3000 * 2 ** attempt);
  return Math.min(60_000, 5000 * 2 ** attempt);
}
