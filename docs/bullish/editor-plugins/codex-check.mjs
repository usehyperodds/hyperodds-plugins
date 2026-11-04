// Asks Codex's app server which tools the installed hyperodds plugin gives it, then calls one.
// No model or login is involved. Run with CODEX_HOME pointing at the home the plugin is installed in.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const codex = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
const waiting = new Map();
let nextId = 1;

createInterface({ input: codex.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  waiting.get(message.id)?.(message);
  waiting.delete(message.id);
});

function request(method, params) {
  const id = nextId++;
  codex.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    waiting.set(id, (message) =>
      message.error ? reject(new Error(message.error.message)) : resolve(message.result),
    );
  });
}

const deadline = setTimeout(() => {
  console.error("codex app-server did not answer within 60 seconds");
  codex.kill();
  process.exit(1);
}, 60_000);

try {
  await request("initialize", { clientInfo: { name: "hyperodds-check", version: "0.1.0" } });
  codex.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);

  const { data } = await request("mcpServerStatus/list", { serverName: "hyperodds" });
  const [server] = data;
  if (!server) throw new Error("Codex has no hyperodds MCP server; install the plugin first");
  console.log(`server   ${server.name} from plugin ${server.pluginId} at ${server.httpOrigin}`);
  console.log(`tools    ${Object.keys(server.tools).sort().join(", ")}`);

  const { thread } = await request("thread/start", {});
  const result = await request("mcpServer/tool/call", {
    server: "hyperodds",
    tool: "odds_markets",
    threadId: thread.id,
    arguments: { sort: "edge", limit: 3 },
  });
  const { total, markets } = result.structuredContent ?? JSON.parse(result.content[0].text);
  console.log(`call     odds_markets {"sort":"edge","limit":3} -> ${markets.length} of ${total} markets`);
  for (const m of markets) {
    console.log(`         ${m.title} (${m.deployerName}): edge ${m.edgePts} pts on ${m.sides[m.edgeSide]}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  codex.kill();
}
