# Hyperodds plugins

Live data on Hyperliquid's HIP-4 outcome markets, inside the agents you already use: markets from
every deployer, fair lines with their sources, edges after fees, rule comparisons where several
deployers list the same question, and the newest listings. Everything here reads from the free
Hyperodds MCP server at `https://api.usehyperodds.com/mcp`, which also takes forecasts for its public
forecast record when you ask an agent to enter one. There is no key to set up, and no tool can trade
or see an account.

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
- "Is the next Fed decision priced the same on every deployer, and do their rules match?"
- "Where does the fair line for the BTC markets settling today come from, and how far should I
  trust it?"
- "What was listed in the last hour?"

## How it works

Each command the agent runs is one HTTPS request to the hosted server, and the answer comes back as
one line of JSON. After the 5-a-second limit it waits and retries once. The script keeps no state,
needs no dependencies, and fails with a message that names the cause when a request errors or gets
no answer within 30 seconds. It exits 2 for a wrong command and 3 when the day's allowance is spent.

| Command                       | Hosted tool    | Answers                                                                            |
| ----------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| `markets [--sort edge]`       | `odds_markets` | Markets with bid, ask, fair line, best edge after fees, 24h volume and settle time |
| `new`                         | `odds_new`     | The newest listings first                                                          |
| `fair <outcome>`              | `odds_fair`    | One market's fair line, its sources, the book and the edge for each way to trade   |
| `cluster <outcome>` or `--id` | `odds_cluster` | One question across deployers: rule grades, differences and the merged book        |

Run any of them yourself:

```sh
node openclaw/hyperodds/scripts/odds.mjs markets --sort edge --limit 5
```

The [MCP guide](https://usehyperodds.com/docs/mcp) explains every field. Each IP address gets 1,000
market tool calls a day, reset at 00:00 UTC, and 5 requests a second. Set `HYPERODDS_MCP_URL` to
read from another server.

## Development

You need Node.js 22 or later.

```sh
node --test
npx @biomejs/biome@2.6.2 check .
```

The tests run the script against a local mock server, so they need no network. See
[CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Security

Report vulnerabilities privately to security@usehyperodds.com, or through
[the repository's Security tab](https://github.com/usehyperodds/hyperodds-plugins/security/advisories/new).
[SECURITY.md](SECURITY.md) has the details.

## License

[MIT](LICENSE). Skills published on ClawHub are also available there under MIT-0, as ClawHub
requires. Third-party names identify compatible clients and data sources; Hyperodds is not
affiliated with any of them.
