#!/usr/bin/env node
const endpoint = process.env.HYPERODDS_MCP_URL || "https://api.usehyperodds.com/mcp";
const timeoutMs = 30_000;
const BURST_LIMIT = -32028;
const DAILY_LIMIT = -32029;

const commands = {
  markets: { tool: "odds_markets", flags: ["category", "deployer", "sort", "q", "limit", "offset"] },
  new: { tool: "odds_new", flags: ["category", "limit", "offset"] },
  fair: { tool: "odds_fair", flags: ["outcome"] },
  cluster: { tool: "odds_cluster", flags: ["id", "outcome"] },
};
const integerFlags = new Set(["limit", "offset", "outcome"]);
const ranges = { limit: [1, 100], offset: [0, 10_000] };
const choices = {
  sort: ["volume", "edge", "new", "settling"],
  category: ["sports", "crypto", "equities", "commodities", "indices", "macro", "ipo", "awards", "other"],
};

let server;
try {
  server = new URL(endpoint);
} catch {
  server = null;
}
const origin = server?.origin ?? "an invalid HYPERODDS_MCP_URL";

const usage = `Usage: node odds.mjs <command> [options]

Commands:
  markets             Markets from every deployer, most traded first
                      --sort volume|edge|new|settling  --category <name>  --deployer <code>
                      --q <text>  --limit <1-100>  --offset <0-10000>
  new                 Newest listings first
                      --category <name>  --limit <1-100>  --offset <0-10000>
  fair <outcome>      One market's fair line, its sources, the book and the edge each way
  cluster <outcome>   One question across deployers: rule grades, differences, merged book
                      (or --id <cluster id>, not both)

Categories: ${choices.category.join(", ")}.
Prints the result as one line of JSON. Read-only; no key needed.
Exit codes: 0 done, 1 failed, 2 wrong command, 3 daily allowance spent until 00:00 UTC.
Server: ${origin} (set HYPERODDS_MCP_URL to change it)`;

class UsageError extends Error {}
class DailyLimitError extends Error {}

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
      if (/^\d+$/.test(token)) args.outcome = integer("outcome", token, "outcome");
      else if (command === "cluster") args.id = token;
      else throw new UsageError(`outcome must be a whole number, not "${token}"`);
      continue;
    }

    const eq = token.indexOf("=");
    const key = eq === -1 ? token.slice(2) : token.slice(2, eq);
    if (!spec.flags.includes(key)) throw new UsageError(`"${command}" takes no --${key}`);
    const value = eq === -1 ? rest[++i] : token.slice(eq + 1);
    if (value === undefined || value === "") throw new UsageError(`--${key} needs a value`);

    if (integerFlags.has(key)) {
      args[key] = integer(key, value);
    } else if (Object.hasOwn(choices, key)) {
      const choice = value.toLowerCase();
      if (!choices[key].includes(choice)) {
        throw new UsageError(`--${key} must be one of ${choices[key].join(", ")}, not "${value}"`);
      }
      args[key] = choice;
    } else {
      args[key] = value;
    }
  }

  if (command === "fair" && !("outcome" in args)) throw new UsageError("fair needs an outcome id");
  if (command === "cluster" && !("outcome" in args) && !("id" in args)) {
    throw new UsageError("cluster needs an outcome id or --id");
  }
  if ("outcome" in args && "id" in args) {
    throw new UsageError("cluster takes an outcome id or --id, not both");
  }
  return { tool: spec.tool, args };
}

function integer(key, value, label = `--${key}`) {
  const n = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(n)) throw new UsageError(`${label} must be a whole number, not "${value}"`);
  const range = ranges[key];
  if (range && (n < range[0] || n > range[1])) {
    throw new UsageError(`${label} must be from ${range[0]} to ${range[1]}, not ${n}`);
  }
  return n;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(tool, args, retried = false) {
  if (!server) throw new Error("HYPERODDS_MCP_URL is not a valid URL");
  if (server.username || server.password)
    throw new Error("HYPERODDS_MCP_URL must not carry a user or password");
  let response;
  let text;
  try {
    response = await fetch(server, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
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
    text = await response.text();
  } catch (error) {
    if (error.name === "TimeoutError") {
      throw new Error(`no answer from ${origin} within ${timeoutMs / 1000} seconds`);
    }
    const cause = error.cause?.message ?? error.message;
    throw new Error(`${response ? "lost the connection to" : "could not reach"} ${origin}: ${cause}`);
  }

  const type = response.headers.get("content-type")?.split(";")[0].trim() || "no content type";
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    message = undefined;
  }

  if (message?.error) {
    const { code, message: reason, data } = message.error;
    if (code === BURST_LIMIT && !retried) {
      const header = response.headers.get("retry-after");
      const wait = header === null ? 1 : Number(header);
      await sleep((Number.isFinite(wait) && wait >= 0 ? Math.min(wait, 2) : 1) * 1000);
      return call(tool, args, true);
    }
    if (code === DAILY_LIMIT) {
      const reset = data?.resetAt ? ` Next reset: ${data.resetAt}.` : "";
      throw new DailyLimitError(`${reason ?? "Daily limit reached."}${reset}`);
    }
    throw new Error(reason || `${origin} answered JSON-RPC error ${code}`);
  }
  if (response.status === 429) throw new Error("rate limited: wait a second, then try again");
  if (!response.ok) throw new Error(`${origin} answered HTTP ${response.status} (${type})`);
  if (!message?.result) {
    throw new Error(`${origin} answered HTTP ${response.status} with ${type}, not a JSON-RPC result`);
  }

  const { result } = message;
  const body = result.content?.find((part) => part.type === "text")?.text;
  if (result.isError) throw new Error(body ?? "the tool reported an error");
  if (result.structuredContent) return result.structuredContent;
  if (body === undefined) throw new Error("the tool answered with no content");
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("the tool answered with text that is not JSON");
  }
}

const argv = process.argv.slice(2);
if (typeof fetch !== "function") {
  console.error("hyperodds: this script needs Node.js 18 or later");
  process.exitCode = 1;
} else if (argv.length === 0) {
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
    process.exitCode = error instanceof UsageError ? 2 : error instanceof DailyLimitError ? 3 : 1;
  }
}
