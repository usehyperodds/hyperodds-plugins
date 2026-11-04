import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
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
    const { status = 200, type = "application/json", text } = reply(JSON.parse(body));
    res.writeHead(status, { "content-type": type });
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

function run(args, env = { HYPERODDS_MCP_URL: url }) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      { env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        resolve({ code: error ? error.code : 0, stdout, stderr });
      },
    );
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
  assert.match(headers.accept, /application\/json/);
  assert.match(headers.accept, /text\/event-stream/);
  assert.equal(body.method, "tools/call");
  assert.equal(body.params.name, "odds_markets");
  assert.deepEqual(body.params.arguments, { sort: "edge", category: "crypto", q: "BTC 100k", limit: 5 });
  assert.deepEqual(JSON.parse(stdout), { echo: body.params.arguments });
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

test("reads a result sent as an event stream", async () => {
  reply = (message) => ({
    type: "text/event-stream",
    text: `event: message\ndata: ${ok(message.id, { structuredContent: { total: 7 } }).text}\n\n`,
  });
  const { code, stdout } = await run(["markets"]);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), { total: 7 });
});

test("a tool error goes to stderr with exit code 1", async () => {
  reply = (message) =>
    ok(message.id, { isError: true, content: [{ type: "text", text: "No market with outcome id 1." }] });
  const { code, stdout, stderr } = await run(["fair", "1"]);
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr.trim(), "hyperodds: No market with outcome id 1.");
});

test("a JSON-RPC error names the server's reason", async () => {
  reply = (message) => ({
    status: 429,
    text: JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32000, message: "Daily limit reached." },
    }),
  });
  const { code, stderr } = await run(["markets"]);
  assert.equal(code, 1);
  assert.equal(stderr.trim(), "hyperodds: Daily limit reached.");
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
  assert.match(stderr, /answered HTTP 502/);
});

test("an unreachable server is named in the error", async () => {
  const { code, stderr } = await run(["markets"], { HYPERODDS_MCP_URL: "http://127.0.0.1:9/mcp" });
  assert.equal(code, 1);
  assert.match(stderr, /could not reach http:\/\/127\.0\.0\.1:9\/mcp/);
});

test("bad usage exits 2 without calling the server", async () => {
  const cases = [
    [[], /Usage:/],
    [["trade"], /unknown command "trade"/],
    [["toString"], /unknown command "toString"/],
    [["markets", "--outcome", "1"], /"markets" takes no --outcome/],
    [["markets", "--limit"], /--limit needs a value/],
    [["markets", "--limit", "ten"], /--limit must be a whole number/],
    [["markets", "extra"], /unexpected argument "extra"/],
    [["fair"], /fair needs an outcome id/],
    [["fair", "abc"], /outcome must be a whole number/],
    [["fair", "1", "2"], /unexpected argument "2"/],
    [["cluster"], /cluster needs an outcome id or --id/],
  ];
  for (const [args, message] of cases) {
    const { code, stderr } = await run(args);
    assert.equal(code, 2, `exit code for ${JSON.stringify(args)}`);
    assert.match(stderr, message);
  }
  assert.equal(requests.length, 0);
});

test("--help prints usage and exits 0", async () => {
  const { code, stdout } = await run(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: node odds\.mjs <command>/);
  assert.match(stdout, new RegExp(url.replaceAll(".", "\\.")));
});

test("every example command in SKILL.md runs", async () => {
  const skill = await readFile(new URL("../openclaw/hyperodds/SKILL.md", import.meta.url), "utf8");
  const examples = [...skill.matchAll(/^node \{baseDir\}\/scripts\/odds\.mjs (.+)$/gm)].map(([, line]) =>
    [...line.matchAll(/"([^"]*)"|(\S+)/g)].map(([, quoted, bare]) => quoted ?? bare),
  );
  assert.ok(examples.length >= 4);
  for (const args of examples) {
    const { code, stderr } = await run(args);
    assert.equal(code, 0, `${args.join(" ")}: ${stderr}`);
  }
  assert.equal(requests.length, examples.length);
});
