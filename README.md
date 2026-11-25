# Hyperodds plugins

Live data on Hyperliquid's HIP-4 outcome markets, inside the agents you already use: markets from
every deployer, fair lines with their sources, edges after fees, the newest listings, and rule
comparisons when two or more deployers list the same question. Everything here reads from the free
Hyperodds MCP server at `https://api.usehyperodds.com/mcp`, which also takes forecasts for its public
forecast record when you ask an agent to enter one. There is no key to set up, and no tool can trade
or see an account.

## Claude Code, Codex and Gemini CLI

This repository installs as a Claude Code plugin, a Codex plugin and a Gemini CLI extension. Each
one connects the hosted Hyperodds MCP server and adds the `hip4-markets` skill, which tells the
agent which tool answers which question and how to read the numbers.

Claude Code:

```sh
claude plugin marketplace add usehyperodds/hyperodds-plugins
claude plugin install hyperodds@hyperodds
```

`claude plugin install hyperodds --marketplace usehyperodds/hyperodds-plugins` does both in one
step.

Codex:

```sh
codex plugin marketplace add usehyperodds/hyperodds-plugins
codex plugin add hyperodds@hyperodds
```

Gemini CLI:

```sh
gemini extensions install https://github.com/usehyperodds/hyperodds-plugins
```

Start a new session and ask. Once it is installed, `claude mcp list` shows the server as
`plugin:hyperodds:hyperodds`, and `codex mcp list` and `gemini mcp list` show it as `hyperodds`.
Gemini CLI asks you to trust the extension when you install it, and runs its MCP server only in
folders you trust.

Cursor, VS Code, Claude Desktop and other MCP clients can connect to the same server directly; see
the [MCP guide](https://usehyperodds.com/docs/mcp#install).

## OpenClaw

The `hyperodds` skill teaches an OpenClaw agent where HIP-4 data lives and how to read it. Install
it from ClawHub:

```sh
openclaw skills install @usehyperodds/hyperodds
```

Or from a clone of this repository:

```sh
openclaw skills install ./openclaw/hyperodds
```

Start a new session and ask. The skill needs Node.js, which OpenClaw already runs on. It calls the
hosted server through a small script in the skill folder, so it works without any other setup.

To give the agent the Hyperodds tools natively as well, add the MCP server. The skill prefers those
tools when they are present:

```sh
openclaw mcp add hyperodds --url https://api.usehyperodds.com/mcp --transport streamable-http
```

The server's tools include `odds_forecast`, which enters a forecast in the public forecast record;
the skill has the agent call it only when you ask.

## What to ask

- "Which HIP-4 markets show the biggest edge after fees right now?"
- "Does any question have more than one deployer right now, and do their rules match?"
- "Where does the fair line for the BTC markets settling today come from, and how far should I
  trust it?"
- "What was listed in the last hour?"

## What gets installed

| Host        | Manifest                                                        | MCP server                                     | Instructions                                   |
| ----------- | --------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Claude Code | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | `mcpServers` in `plugin.json` (HTTP)           | `skills/hip4-markets/SKILL.md`                 |
| Codex       | `plugin.json`, `.agents/plugins/marketplace.json`               | `mcp.json` (Streamable HTTP)                   | `skills/hip4-markets/SKILL.md`                 |
| Gemini CLI  | `gemini-extension.json`                                         | `mcpServers` in the manifest (Streamable HTTP) | `GEMINI.md` and `skills/hip4-markets/SKILL.md` |
| OpenClaw    | `openclaw/hyperodds/SKILL.md`                                   | optional, added with `openclaw mcp add`        | the skill and `scripts/odds.mjs`               |

The MCP server has nine tools. `odds_markets`, `odds_new`, `odds_fair` and `odds_cluster` read
markets, and `search` and `fetch` find a market from the words of a question and read it in full.
`odds_forecast`, `odds_forecast_record` and `odds_leaderboard` enter and read the public forecast
record, and the skills tell the agent to enter a forecast only when you ask. The
[MCP guide](https://usehyperodds.com/docs/mcp) explains every field. Each IP address gets 1,000
market tool calls a day, reset at 00:00 UTC (the forecast tools don't count), and 5 requests a
second across every tool.

## How the OpenClaw skill works

Each command the agent runs is one HTTPS request to the hosted server, and the answer comes back as
one line of JSON. After the 5-a-second limit the script waits and retries once. It has no
dependencies. When a request fails or gets no answer within 30 seconds, it exits with a message
that names the cause. Exit code 2 means a wrong command and 3 means the day's allowance is spent.

| Command                       | Hosted tool    | Answers                                                                                        |
| ----------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `markets [--sort edge]`       | `odds_markets` | Markets with bid, ask, fair line, best edge after fees, 24h volume and settle time             |
| `new`                         | `odds_new`     | The newest listings first                                                                      |
| `fair <outcome>`              | `odds_fair`    | One market's fair line, its sources, the book and the edge for each way to trade               |
| `cluster <outcome>` or `--id` | `odds_cluster` | One question, when two or more deployers list it: rule grades, differences and the merged book |

Run any of them yourself:

```sh
node openclaw/hyperodds/scripts/odds.mjs markets --sort edge --limit 5
```

Set `HYPERODDS_MCP_URL` to read from another server; the script reads servers that answer plain
JSON only.

## Development

You need Node.js 22 or later.

```sh
node --test
npx @biomejs/biome@2.6.2 check .
claude plugin validate .claude-plugin/plugin.json --strict
gemini extensions validate .
```

The tests check that every manifest names the same server, version and skill, and that the Codex
files follow the Agent Plugins 1.0.0 schemas. They run the OpenClaw script against a local mock
server, so they need no network. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull
request.

## Security

Report vulnerabilities privately to security@usehyperodds.com, or through
[the repository's Security tab](https://github.com/usehyperodds/hyperodds-plugins/security/advisories/new).
[SECURITY.md](SECURITY.md) has the details.

## License

[MIT](LICENSE). Skills published on ClawHub are also available there under MIT-0, as ClawHub
requires. Third-party names identify compatible clients and data sources; Hyperodds is not
affiliated with any of them.
