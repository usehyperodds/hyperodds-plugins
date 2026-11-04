#!/usr/bin/env node
const endpoint = process.env.HYPERODDS_MCP_URL || "https://api.usehyperodds.com/mcp";
const timeoutMs = 30_000;

const commands = {
  markets: { tool: "odds_markets", flags: ["category", "deployer", "sort", "q", "limit", "offset"] },
  new: { tool: "odds_new", flags: ["category", "limit", "offset"] },
  fair: { tool: "odds_fair", flags: ["outcome"] },
  cluster: { tool: "odds_cluster", flags: ["id", "outcome"] },
};
const integerFlags = new Set(["limit", "offset", "outcome"]);

const usage = `Usage: node odds.mjs <command> [options]

Commands:
  markets             Markets from every deployer, most traded first
                      --sort volume|edge|new|settling  --category <name>  --deployer <code>
                      --q <text>  --limit <1-100>  --offset <n>
  new                 Newest listings first
                      --category <name>  --limit <1-100>  --offset <n>
  fair <outcome>      One market's fair line, its sources, the book and the edge each way
  cluster <outcome>   One question across deployers: rule grades, differences, merged book
                      (or --id <cluster id>)

Categories: sports, crypto, equities, commodities, indices, macro, ipo, awards, other.
Prints the result as one line of JSON. Read-only; no key needed.
Server: ${endpoint} (set HYPERODDS_MCP_URL to change it)`;

class UsageError extends Error {}

function parse(argv) {
  const [command, ...rest] = argv;
  const spec = Object.hasOwn(commands, command ?? "") ? commands[command] : undefined;
  if (!spec) throw new UsageError(command ? `unknown command "${command}"` : "missing command");

  const args = {};
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      if ((command !== "fair" && command !== "cluster") || "outcome" in args || "id" in args) {
        throw new UsageError(`unexpected argument "${token}"`);
      }
      if (/^\d+$/.test(token)) args.outcome = Number(token);
      else if (command === "cluster") args.id = token;
      else throw new UsageError(`outcome must be a whole number, not "${token}"`);
      continue;
    }

    const eq = token.indexOf("=");
    const key = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (!spec.flags.includes(key)) throw new UsageError(`"${command}" takes no --${key}`);
    const value = eq === -1 ? rest[++i] : token.slice(eq + 1);
    if (value === undefined || value === "") throw new UsageError(`--${key} needs a value`);

    if (!integerFlags.has(key)) {
      args[key] = value;
    } else if (/^\d+$/.test(value)) {
      args[key] = Number(value);
    } else {
      throw new UsageError(`--${key} must be a whole number, not "${value}"`);
    }
  }

  if (command === "fair" && !("outcome" in args)) throw new UsageError("fair needs an outcome id");
  if (command === "cluster" && !("outcome" in args) && !("id" in args)) {
    throw new UsageError("cluster needs an outcome id or --id");
  }
  return { tool: spec.tool, args };
}

function readMessage(text, contentType) {
  if (!contentType.includes("text/event-stream")) return JSON.parse(text);
  const events = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)));
  const message = events.findLast((event) => "result" in event || "error" in event);
  if (!message) throw new Error("the event stream ended without a result");
  return message;
}

async function call(tool, args) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === "TimeoutError") throw new Error(`no answer from ${endpoint} within 30 seconds`);
    throw new Error(`could not reach ${endpoint}: ${error.cause?.message ?? error.message}`);
  }

  const text = await response.text();
  let message;
  try {
    message = readMessage(text, response.headers.get("content-type") ?? "");
  } catch {
    message = undefined;
  }

  if (message?.error) throw new Error(message.error.message);
  if (response.status === 429) throw new Error("rate limited: wait a second, then try again");
  if (!response.ok) throw new Error(`${endpoint} answered HTTP ${response.status}`);
  if (!message?.result) throw new Error(`${endpoint} sent a response that is not JSON-RPC`);

  const { result } = message;
  const body = result.content?.find((part) => part.type === "text")?.text;
  if (result.isError) throw new Error(body ?? "the tool reported an error");
  return result.structuredContent ?? JSON.parse(body);
}

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error(usage);
  process.exitCode = 2;
} else if (["--help", "-h", "help"].includes(argv[0])) {
  console.log(usage);
} else {
  try {
    const { tool, args } = parse(argv);
    console.log(JSON.stringify(await call(tool, args)));
  } catch (error) {
    console.error(`hyperodds: ${error.message}`);
    if (error instanceof UsageError) console.error('Run "node odds.mjs --help" for usage.');
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
