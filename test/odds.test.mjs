import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { after, before, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../openclaw/hyperodds/scripts/odds.mjs", import.meta.url));

let server;
let url;
let requests;
let reply;

before(async () => {
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, headers: req.headers, body: JSON.parse(body) });
    const answer = reply(JSON.parse(body), requests.length);
    if (answer.broken) {
      res.writeHead(200, { "content-type": "application/json", "content-length": "1000" });
      res.write('{"jsonrpc":"2.0",');
      setTimeout(() => res.socket.destroy(), 50);
      return;
    }
    const { status = 200, type = "application/json", headers = {}, text } = answer;
    res.writeHead(status, type ? { "content-type": type, ...headers } : headers);
    res.end(text);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/mcp`;
});

after(() => server.close());

beforeEach(() => {
  requests = [];
  reply = (message) => ok(message.id, { structuredContent: { echo: message.params.arguments } });
});

function ok(id, result) {
  return { text: JSON.stringify({ jsonrpc: "2.0", id, result: { content: [], ...result } }) };
}

function rpcError(id, error, status = 200, headers = {}) {
  return { status, headers, text: JSON.stringify({ jsonrpc: "2.0", id, error }) };
}

function run(args, env = { HYPERODDS_MCP_URL: url }, nodeArgs = []) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [...nodeArgs, script, ...args],
      { env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        resolve({ code: error ? error.code : 0, stdout, stderr });
      },
    );
  });
}

function sh(command, env = { HYPERODDS_MCP_URL: url }) {
  return new Promise((resolve) => {
    execFile("/bin/sh", ["-c", command], { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

test("markets sends one tools/call with typed arguments and prints the structured result", async () => {
  const { code, stdout } = await run([
    "markets",
    "--sort",
    "edge",
    "--category=crypto",
    "--q",
    "BTC 100k",
    "--limit",
    "5",
  ]);

  assert.equal(code, 0);
  assert.equal(requests.length, 1);
  const [{ method, headers, body }] = requests;
  assert.equal(method, "POST");
  assert.equal(headers.accept, "application/json");
  assert.equal(body.method, "tools/call");
  assert.equal(body.params.name, "odds_markets");
  assert.deepEqual(body.params.arguments, { sort: "edge", category: "crypto", q: "BTC 100k", limit: 5 });
  assert.deepEqual(JSON.parse(stdout), { echo: body.params.arguments });
});

test("category and sort go out in lower case", async () => {
  await run(["markets", "--category", "Crypto", "--sort", "EDGE"]);
  assert.deepEqual(requests[0].body.params.arguments, { category: "crypto", sort: "edge" });
});

test("fair and cluster take the outcome as a positional number", async () => {
  await run(["fair", "22091"]);
  await run(["cluster", "8572"]);
  await run(["cluster", "ipocap-anthropic-1750000000000-20270101-qwkbyp"]);

  assert.deepEqual(
    requests.map(({ body }) => [body.params.name, body.params.arguments]),
    [
      ["odds_fair", { outcome: 22091 }],
      ["odds_cluster", { outcome: 8572 }],
      ["odds_cluster", { id: "ipocap-anthropic-1750000000000-20270101-qwkbyp" }],
    ],
  );
});

test("new maps to odds_new", async () => {
  await run(["new", "--limit", "3"]);
  assert.equal(requests[0].body.params.name, "odds_new");
  assert.deepEqual(requests[0].body.params.arguments, { limit: 3 });
});

test("falls back to the text content when there is no structured content", async () => {
  reply = (message) => ok(message.id, { content: [{ type: "text", text: '{"total":0}' }] });
  const { code, stdout } = await run(["markets"]);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), { total: 0 });
});

test("a result with no content, or text that is not JSON, is named", async () => {
  reply = (message) => ok(message.id, {});
  assert.match((await run(["markets"])).stderr, /the tool answered with no content/);
  reply = (message) => ok(message.id, { content: [{ type: "text", text: "plain words" }] });
  const { code, stderr } = await run(["markets"]);
  assert.equal(code, 1);
  assert.match(stderr, /the tool answered with text that is not JSON/);
});

test("a tool error goes to stderr with exit code 1", async () => {
  reply = (message) =>
    ok(message.id, { isError: true, content: [{ type: "text", text: "No market with outcome id 1." }] });
  const { code, stdout, stderr } = await run(["fair", "1"]);
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr.trim(), "hyperodds: No market with outcome id 1.");
});

test("the burst limit waits for Retry-After and retries once", async () => {
  reply = (message, n) =>
    n === 1
      ? rpcError(message.id, { code: -32028, message: "Too many requests." }, 429, { "retry-after": "0" })
      : ok(message.id, { structuredContent: { total: 1 } });
  const { code, stdout } = await run(["markets"]);
  assert.equal(code, 0);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(stdout), { total: 1 });
});

test("a second burst limit in a row fails with the server's reason", async () => {
  reply = (message) =>
    rpcError(message.id, { code: -32028, message: "Too many requests." }, 429, { "retry-after": "0" });
  const { code, stderr } = await run(["markets"]);
  assert.equal(code, 1);
  assert.equal(requests.length, 2);
  assert.equal(stderr.trim(), "hyperodds: Too many requests.");
});

test("the daily limit exits 3 with the reset time and does not retry", async () => {
  reply = (message) =>
    rpcError(
      message.id,
      {
        code: -32029,
        message: "Daily free limit of 1000 tool calls reached. It resets at 00:00 UTC.",
        data: { limit: 1000, used: 1000, resetAt: "2026-11-23T00:00:00.000Z" },
      },
      429,
      { "retry-after": "3600" },
    );
  const { code, stderr } = await run(["markets"]);
  assert.equal(code, 3);
  assert.equal(requests.length, 1);
  assert.match(stderr, /Daily free limit of 1000 tool calls reached/);
  assert.match(stderr, /Next reset: 2026-11-23T00:00:00\.000Z/);
});

test("a JSON-RPC error names the server's reason, or its code when there is none", async () => {
  reply = (message) => rpcError(message.id, { code: -32602, message: "Invalid params." });
  assert.equal((await run(["markets"])).stderr.trim(), "hyperodds: Invalid params.");
  reply = (message) => rpcError(message.id, { code: -32603 });
  assert.match((await run(["markets"])).stderr, /Hyperodds answered JSON-RPC error -32603/);
});

test("a rate limit without a body asks the caller to wait", async () => {
  reply = () => ({ status: 429, type: "text/plain", text: "" });
  const { code, stderr } = await run(["markets"]);
  assert.equal(code, 1);
  assert.match(stderr, /rate limited/);
});

test("an HTTP error page is reported by status", async () => {
  reply = () => ({ status: 502, type: "text/html", text: "<html>bad gateway</html>" });
  const { code, stderr } = await run(["markets"]);
  assert.equal(code, 1);
  assert.equal(stderr.trim(), "hyperodds: Hyperodds answered HTTP 502");
});

test("a JSON error body that is not JSON-RPC is reported by status", async () => {
  reply = () => ({ status: 404, text: '{"error":"not found"}' });
  const { code, stderr } = await run(["markets"]);
  assert.equal(code, 1);
  assert.equal(stderr.trim(), "hyperodds: Hyperodds answered HTTP 404");
});

test("a 200 that is not JSON-RPC names what came back", async () => {
  reply = () => ({ type: "text/html; charset=utf-8", text: "<html>login</html>" });
  assert.match(
    (await run(["markets"])).stderr,
    /Hyperodds answered HTTP 200 with text\/html, not a JSON-RPC result/,
  );
  reply = () => ({ type: null, text: "" });
  assert.match((await run(["markets"])).stderr, /with no content type, not a JSON-RPC result/);
});

test("an answer that breaks off is reported as a lost connection", async () => {
  reply = () => ({ broken: true });
  const { code, stderr } = await run(["markets"]);
  assert.equal(code, 1);
  assert.match(stderr, /lost the connection to http:\/\/127\.0\.0\.1:\d+/);
});

test("an unreachable server is named by its origin only", async () => {
  const { code, stderr } = await run(["markets"], { HYPERODDS_MCP_URL: "http://127.0.0.1:9/mcp?key=abc" });
  assert.equal(code, 1);
  assert.match(stderr, /could not reach http:\/\/127\.0\.0\.1:9:/);
  assert.doesNotMatch(stderr, /key=abc|\/mcp/);
});

test("an endpoint with a user or password is refused without echoing it", async () => {
  const { code, stderr } = await run(["markets"], { HYPERODDS_MCP_URL: "http://me:secret@127.0.0.1:9/mcp" });
  assert.equal(code, 1);
  assert.match(stderr, /must not carry a user or password/);
  assert.doesNotMatch(stderr, /secret/);
});

test("an endpoint that is not a URL is named as such", async () => {
  const { code, stderr } = await run(["markets"], { HYPERODDS_MCP_URL: "not a url" });
  assert.equal(code, 1);
  assert.match(stderr, /HYPERODDS_MCP_URL is not a valid URL/);
});

test("a Node.js without fetch gets a clear message", async () => {
  const { code, stderr } = await run(["markets"], undefined, [
    "--import",
    "data:text/javascript,delete globalThis.fetch",
  ]);
  assert.equal(code, 1);
  assert.match(stderr, /needs Node\.js 18 or later/);
  assert.equal(requests.length, 0);
});

test("bad usage exits 2 without calling the server", async () => {
  const cases = [
    [[], /Usage:/],
    [["trade"], /unknown command "trade"/],
    [["toString"], /unknown command "toString"/],
    [["markets", "--outcome", "1"], /"markets" takes no --outcome/],
    [["markets", "--limit"], /--limit needs a value/],
    [["markets", "--limit", "ten"], /--limit must be a whole number/],
    [["markets", "--limit", "0"], /--limit 0 is out of range: use 1 to 100/],
    [["markets", "--limit", "101"], /--limit 101 is out of range: use 1 to 100/],
    [["markets", "--offset", "10001"], /--offset 10001 is out of range: use 0 to 10000/],
    [["markets", "--q", "x".repeat(101)], /--q can be at most 100 characters, not 101/],
    [["markets", "--category", "cars"], /--category must be one of sports, crypto/],
    [["markets", "--sort", "best"], /--sort must be one of volume, edge, new, settling/],
    [["markets", "extra"], /unexpected argument "extra"/],
    [["fair"], /fair needs an outcome id/],
    [["fair", "abc"], /outcome must be a whole number/],
    [["fair", "99999999999999999999"], /outcome 99999999999999999999 is out of range/],
    [["fair", "1", "2"], /unexpected argument "2"/],
    [["cluster"], /cluster needs an outcome id or --id/],
    [["cluster", "8572", "--id", "x"], /an outcome id or --id, not both/],
  ];
  for (const [args, message] of cases) {
    const { code, stderr } = await run(args);
    assert.equal(code, 2, `exit code for ${JSON.stringify(args)}`);
    assert.match(stderr, message);
  }
  assert.equal(requests.length, 0);
});

test("--help prints usage with the server's full URL and exits 0", async () => {
  const { code, stdout } = await run(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: node odds\.mjs <command>/);
  assert.match(stdout, /--q <text, up to 100 characters>/);
  assert.ok(stdout.includes(`Server: ${url}\n`), stdout);
  assert.match(stdout, /plain JSON only/);
});

test("a query of exactly 100 characters is sent", async () => {
  const { code } = await run(["markets", "--q", "x".repeat(100)]);
  assert.equal(code, 0);
  assert.equal(requests[0].body.params.arguments.q.length, 100);
});

test("user text quoted as SKILL.md says never reaches a shell", {
  skip: process.platform === "win32" && "needs a POSIX shell",
}, async () => {
  // A short path keeps the text inside the 100-character limit on --q.
  const marker = `/tmp/ho-inj-${process.pid}`;
  const typed = `fed $(touch ${marker}) \`touch ${marker}\` it's`;
  const quoted = `'${typed.replaceAll("'", "")}'`;
  const command = (q) => `"${process.execPath}" "${script}" markets --q ${q}`;
  try {
    assert.equal((await sh(command(quoted))).code, 0);
    assert.equal(requests[0].body.params.arguments.q, typed.replaceAll("'", ""));
    await assert.rejects(access(marker));

    // The same text in double quotes runs both substitutions, so the check above can fail.
    await sh(command(`"${typed}"`));
    await access(marker);
  } finally {
    await rm(marker, { force: true });
  }
});

test("every example command in SKILL.md runs, with ids taken from markets", async () => {
  const skill = await readFile(new URL("../openclaw/hyperodds/SKILL.md", import.meta.url), "utf8");
  const lines = [...skill.matchAll(/^node \{baseDir\}\/scripts\/odds\.mjs (.+)$/gm)].map(([, line]) => line);
  assert.ok(lines.length >= 4);
  for (const line of lines) assert.doesNotMatch(line, /^(fair|cluster) \d/, `hardcoded id in "${line}"`);
  for (const line of lines) {
    const args = [...line.replaceAll("<outcome>", "22091").matchAll(/'([^']*)'|(\S+)/g)].map(
      ([, quoted, bare]) => quoted ?? bare,
    );
    const { code, stderr } = await run(args);
    assert.equal(code, 0, `${line}: ${stderr}`);
  }
  assert.equal(requests.length, lines.length);
});
