import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const json = async (path) => JSON.parse(await read(path));

const endpoint = "https://api.usehyperodds.com/mcp";
const tools = [
  "odds_markets",
  "odds_new",
  "odds_fair",
  "odds_cluster",
  "odds_forecast",
  "odds_forecast_record",
  "odds_leaderboard",
];
const claude = await json(".claude-plugin/plugin.json");
const claudeMarket = await json(".claude-plugin/marketplace.json");
const portable = await json("plugin.json");
const portableMcp = await json("mcp.json");
const codexMarket = await json(".agents/plugins/marketplace.json");
const gemini = await json("gemini-extension.json");

test("every host sees the same name, version and description", () => {
  for (const manifest of [claude, portable, gemini]) {
    assert.equal(manifest.name, "hyperodds");
    assert.equal(manifest.version, claude.version);
    assert.equal(manifest.description, claude.description);
  }
  assert.equal(claudeMarket.plugins[0].description, claude.description);
});

test("every host registers the hosted server in its own transport format", () => {
  assert.deepEqual(claude.mcpServers, { hyperodds: { type: "http", url: endpoint } });
  assert.deepEqual(portableMcp.mcpServers, { hyperodds: { type: "streamable-http", url: endpoint } });
  assert.equal(gemini.mcpServers.hyperodds.httpUrl, endpoint);
  assert.equal(Object.keys(gemini.mcpServers).length, 1);
});

test("no .mcp.json at the root, so working inside this repository adds no project server", async () => {
  await assert.rejects(access(new URL(".mcp.json", root)));
});

test("plugin.json follows the Agent Plugins 1.0.0 manifest schema", () => {
  const allowed = [
    "$schema",
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "repository",
    "license",
    "keywords",
    "extensions",
  ];
  assert.equal(portable.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.match(portable.name, /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  assert.deepEqual(
    Object.keys(portable).filter((key) => !allowed.includes(key)),
    [],
  );
  assert.deepEqual(
    Object.keys(portable.author).filter((key) => !["name", "email", "url"].includes(key)),
    [],
  );
  for (const value of Object.values(portable.extensions)) assert.equal(typeof value, "object");
});

test("mcp.json follows the Agent Plugins 1.0.0 MCP schema", () => {
  assert.equal(portableMcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  assert.deepEqual(Object.keys(portableMcp).sort(), ["$schema", "mcpServers"]);
  for (const server of Object.values(portableMcp.mcpServers)) {
    assert.deepEqual(
      Object.keys(server).filter((key) => !["type", "url", "headers"].includes(key)),
      [],
    );
  }
});

test("the Claude Code marketplace lists this repository as the plugin", () => {
  assert.equal(claudeMarket.name, "hyperodds");
  assert.ok(claudeMarket.owner.name);
  assert.ok(claudeMarket.description);
  assert.deepEqual(
    claudeMarket.plugins.map(({ name, source }) => [name, source]),
    [["hyperodds", "./"]],
  );
});

test("the Codex marketplace entry carries the policy and category Codex requires", () => {
  assert.equal(codexMarket.name, "hyperodds");
  assert.ok(codexMarket.interface.displayName);
  const [entry] = codexMarket.plugins;
  assert.equal(entry.name, "hyperodds");
  assert.deepEqual(entry.source, { source: "local", path: "./" });
  assert.equal(entry.policy.installation, "AVAILABLE");
  assert.equal(entry.policy.authentication, "ON_INSTALL");
  assert.ok(entry.category);
});

test("files the manifests point at exist", async () => {
  const { interface: ui } = portable.extensions["com.openai"];
  for (const path of [claude.icon, ui.composerIcon, ui.logo, gemini.contextFileName]) {
    await access(new URL(path, root));
  }
});

test("the shared skill has the frontmatter every host reads", async () => {
  const skill = await read("skills/hip4-markets/SKILL.md");
  const [, frontmatter] = skill.match(/^---\n([\s\S]*?)\n---\n/) ?? [];
  assert.ok(frontmatter);
  assert.match(frontmatter, /^name: hip4-markets$/m);
  const [, description] = frontmatter.match(/^description: (.+)$/m);
  assert.ok(description.length <= 1024);
});

test("the skill and the Gemini context name every tool the server gives", async () => {
  for (const path of ["skills/hip4-markets/SKILL.md", "GEMINI.md"]) {
    const text = await read(path);
    for (const tool of tools) assert.match(text, new RegExp(`\`${tool}\``), `${path} names ${tool}`);
  }
});

test("odds_forecast writes, so no manifest calls the plugin read-only", () => {
  for (const manifest of [claude, claudeMarket, portable, gemini]) {
    assert.doesNotMatch(JSON.stringify(manifest), /read-only/i);
  }
  assert.ok(portable.extensions["com.openai"].interface.capabilities.includes("Write"));
});

// The console's cents() and pairDecimals(): one decimal, two below 1¢ or above 99¢, three below 0.1¢
// or above 99.9¢; a bid and an ask that match at one decimal get the fewest decimals that differ.
const cents = (p, decimals) => {
  const c = p * 100;
  const d = decimals ?? (c === 0 || c === 100 ? 0 : c < 0.1 || c > 99.9 ? 3 : c < 1 || c > 99 ? 2 : 1);
  return `${c.toFixed(d)}¢`;
};
const pairDecimals = (a, b) => {
  for (let d = 1; d <= 3; d++)
    if ((a * 100).toFixed(d) !== (b * 100).toFixed(d)) return d === 1 ? undefined : d;
  return 3;
};

test("the skill's price examples print as the console prints them", async () => {
  const skill = await read("skills/hip4-markets/SKILL.md");
  const singles = [...skill.matchAll(/\b(0\.\d+) is (\d+\.\d+¢)/g)];
  const pairs = [...skill.matchAll(/\b(0\.\d+) and (0\.\d+)\s+are (\d+\.\d+¢) and (\d+\.\d+¢)/g)];
  assert.ok(singles.length >= 4, "single examples");
  assert.ok(pairs.length >= 2, "bid and ask examples");
  for (const [, p, shown] of singles) assert.equal(cents(Number(p)), shown);
  for (const [, a, b, shownA, shownB] of pairs) {
    const d = pairDecimals(Number(a), Number(b));
    assert.deepEqual([cents(Number(a), d), cents(Number(b), d)], [shownA, shownB]);
  }
});

test("the skill keeps answers to what the tool returned, with no recommendations", async () => {
  const skill = await read("skills/hip4-markets/SKILL.md");
  assert.match(skill, /Summarise only what the tool returned/);
  assert.match(skill, /Never call a market\s+actionable, recommend one or tell anyone to trade/);
  assert.match(skill, /Quote `asOf` \(UTC\) when the tool gives one/);
});
