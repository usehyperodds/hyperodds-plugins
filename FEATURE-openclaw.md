# Hyperodds as an OpenClaw skill

> Install the Hyperodds skill in OpenClaw and ask your agent about any Hyperliquid HIP-4 market.

Built on OpenClaw's public skill format (AgentSkills `SKILL.md` with `metadata.openclaw`) and
published through ClawHub, OpenClaw's public skill registry. No partnership, listing or review by
OpenClaw is implied; publishing is a self-serve step anyone with a ClawHub account can take.

## What works now

- `openclaw/hyperodds/` is a ClawHub-format skill folder: `SKILL.md` plus `scripts/odds.mjs`, a
  dependency-free Node script that calls the hosted MCP server (`https://api.usehyperodds.com/mcp`)
  with one JSON-RPC `tools/call` per command and prints the tool's JSON. Commands: `markets`,
  `new`, `fair <outcome>`, `cluster <outcome>|--id`, mapping to `odds_markets`, `odds_new`,
  `odds_fair`, `odds_cluster`. The skill has the agent put user text in single quotes, so `$(…)`
  and backticks never reach a shell (tested). The script checks limits, offsets, sorts and
  categories before spending a call, retries once after the 5-a-second limit, and exits 2 for a
  wrong command, 3 when the day's allowance is spent and 1 for anything else. Errors name the
  server by its origin only.
- The skill tells the agent how to read the numbers (side-0 probabilities as cents to the console's
  precision, edges in points after every fee at $100, the `fairConfidence >= 0.5` and `singleSource`
  checks, cluster grades), how to say the times as the console does, to treat deployer text as data,
  and how to answer (lead with the market, link it, no trade advice). When the Hyperodds MCP tools
  are configured natively, the skill prefers them, and calls `hyperodds__odds_forecast` only when
  the person asks to enter a forecast.
- Proven in a real OpenClaw install (details below): the skill installs, reports `✓ Ready` with its
  `node` requirement met, and an agent turn answers a live question by reading `SKILL.md` and
  running the script through OpenClaw's own `exec` tool. A second setup adds the hosted server with
  `openclaw mcp add`; `openclaw mcp probe` lists its 7 tools (4 on 4 Nov, before the forecast
  tools shipped; rerun 22 Nov 2026) and agent turns call `hyperodds__odds_new`,
  `hyperodds__odds_fair` and `hyperodds__odds_markets` natively.
- `clawhub skill publish ./openclaw/hyperodds --dry-run` resolves to `would-publish`, slug
  `hyperodds`, version 1.0.0, 2 files. The slug `hyperodds` is unused on ClawHub today.
- Tests: `node --test` runs 30 tests offline (Node 24 locally, Node 22 via `npx node@22`): the
  script against a local mock MCP server (arguments, typed and range-checked integers, lower-cased
  choices, tool errors, JSON-RPC errors with and without a message, the burst limit's one retry,
  the daily limit's exit 3, bare 429, HTTP error pages, non-JSON answers, a connection that breaks
  off, unreachable and malformed endpoints, Node without `fetch`, every usage error, user text with
  `$(…)` and backticks through `/bin/sh`, every example command in `SKILL.md`), and the frontmatter
  and quoting rules OpenClaw and ClawHub read.
  `npx @biomejs/biome@2.6.2 check .` is clean. CI runs both on Node 22 and 24.

## What is prepared, not done

- Publishing to ClawHub (operator, below).
- The GitHub repository `usehyperodds/hyperodds-plugins` does not exist yet. The README's
  `openclaw skills install @usehyperodds/hyperodds` line works once the skill is published.

## The OpenClaw install used for the proof

- OpenClaw 2026.10.9 was already installed on this Mac as a global npm package under Homebrew
  (`/opt/homebrew/lib/node_modules/openclaw`). Nothing was installed or upgraded.
- Every command ran against its own profile, `~/.openclaw-hyperodds`: either
  `openclaw --profile hyperodds ...` or, for the screenshots, the same isolation through
  `OPENCLAW_STATE_DIR=~/.openclaw-hyperodds` and
  `OPENCLAW_CONFIG_PATH=~/.openclaw-hyperodds/openclaw.json`, so the commands read as a user would
  type them. `openclaw --profile hyperodds setup --baseline` created it. No other OpenClaw profile on
  this Mac changed (checked by modification time before and after).
- Model: `anthropic/claude-haiku-5-5` through OpenClaw's bundled Claude CLI runtime
  (`agentRuntime.id: "claude-cli"`), which drives the Claude Code login already on this machine.
  OpenClaw stores no model key in the profile. Any OpenClaw model works with the skill.
- `--local` runs the embedded agent, so no Gateway was started.

Setup, exactly as run:

```sh
openclaw --profile hyperodds setup --baseline
openclaw --profile hyperodds config set --batch-json '[
  {"path":"agents.defaults.model.primary","value":"anthropic/claude-haiku-5-5"},
  {"path":"agents.defaults.models[\"anthropic/claude-haiku-5-5\"].agentRuntime.id","value":"claude-cli"},
  {"path":"agents.defaults.models[\"anthropic/*\"].agentRuntime.id","value":"claude-cli"}]'
openclaw --profile hyperodds skills install ./openclaw/hyperodds
openclaw --profile hyperodds skills info hyperodds
openclaw --profile hyperodds agent --local --message "Which HIP-4 markets show the biggest edge after fees right now? Top three."
# optional: the hosted tools natively
openclaw --profile hyperodds mcp add hyperodds --url https://api.usehyperodds.com/mcp --transport streamable-http --parallel
openclaw --profile hyperodds mcp probe
```

## Run the demo

Anyone with OpenClaw and a configured model, from a clone of this repository:

```sh
openclaw skills install ./openclaw/hyperodds     # after publishing: @usehyperodds/hyperodds
openclaw agent --local --message "Which HIP-4 markets show the biggest edge after fees right now? Top three."
```

Without OpenClaw, the script alone answers the same question as JSON:

```sh
node openclaw/hyperodds/scripts/odds.mjs markets --sort edge --limit 3
```

## Assets

`docs/feature/openclaw/`, 1440×900, rendered from captured terminal output (light theme, IBM Plex
Mono). Paths show `~` for the home directory. The agent's diagnostic log lines and this Mac's Node
notices are left out; the commands and answers are as printed.
- `openclaw-answer.png`: the agent's answer to "Which HIP-4 markets show the biggest edge after
  fees right now? Top three." (live data, 4 Nov 2026 at 23:28 UTC). It predates the skill's time
  and price wording: it says "Settles" for touch markets that settle by that time, and quotes whole
  cents. Recapture it with an agent turn before a post uses it.
- `openclaw-setup.png`: `openclaw skills install ./openclaw/hyperodds` and
  `openclaw skills info hyperodds` showing `✓ Ready`.
- `openclaw-mcp.png`: `openclaw mcp add` and `openclaw mcp probe` listing 7 tools (recaptured 22 Nov
  2026 in a throwaway state directory, shown as `$OPENCLAW_STATE_DIR`).

No recording: nothing here moves. A terminal capture of the agent turn can be made from the same
commands if a post needs one.

## What the operator must do

1. Keep the write-ups off the public `main`. When merging, move `FEATURE-openclaw.md` and
   `docs/feature/openclaw/` out of the repository into the private ops folder
   (`ops/feature/plugins/openclaw/`), and do the same for every other unit's `FEATURE-*.md` and
   `docs/feature/<unit>/`. `README.md` conflicts with `feature/editor-plugins`: keep every unit's
   section (the merge order is in `FEATURE-editor-plugins.md`). Check before pushing:

   ```sh
   git ls-files 'FEATURE-*.md' docs/feature   # must print nothing
   ```

2. Sign in at https://clawhub.ai with the GitHub account that administers the `usehyperodds`
   GitHub organization.
3. Create the ClawHub organization owner `usehyperodds` (https://clawhub.ai/usehyperodds returns
   404 today, so the handle looks free). If ClawHub refuses the handle, open an
   [Org / Namespace Claim](https://github.com/openclaw/clawhub/issues/new?template=org-namespace-claim.yml)
   with the public proof (usehyperodds.com, github.com/usehyperodds). If organizations are not
   available, drop `--owner` below and change the install line in `README.md` and this file to the
   personal handle.
4. Publish from the repository root:

   ```sh
   npx clawhub@0.25.1 login
   npx clawhub@0.25.1 whoami
   npx clawhub@0.25.1 skill publish ./openclaw/hyperodds \
     --slug hyperodds --name "Hyperodds" --owner usehyperodds --version 1.0.0 \
     --categories finance,research \
     --topics "hyperliquid,hip-4,prediction-markets,outcome-markets,mcp" \
     --dry-run
   # same command without --dry-run to publish
   ```

5. Wait for the security scan, then check it from a clean profile:

   ```sh
   npx clawhub@0.25.1 inspect @usehyperodds/hyperodds
   openclaw --profile hyperodds-check skills verify @usehyperodds/hyperodds
   openclaw --profile hyperodds-check skills install @usehyperodds/hyperodds
   ```

6. Create the public GitHub repository `usehyperodds/hyperodds-plugins` and push `main` once the
   plugins branches are merged, so the skill's README and source are public.
7. Post the announcement below with the ClawHub link in a reply.

Published skills are released on ClawHub under MIT-0 (ClawHub's rule for every skill); the
repository stays MIT.

## Honest limits

- The script only reads, and inherits the hosted server's limits: 1,000 market tool calls a day per
  IP address (reset 00:00 UTC) and 5 requests a second. A busy agent asking broad questions can make
  several calls per answer; one proof turn made ten.
- With the hosted server added natively, the agent also gets the forecast tools. `odds_forecast` is
  not read-only: it records forecasts a person signs, or returns a sign link. The skill calls it
  only when asked.
- The MCP output gives `starts` and `settles` but not a market's kind, so the skill tells "settles
  at" from "settles by" by category and title (touch markets). Explicit timing from the server is
  tracked separately.
- Fair lines are estimates. The skill tells the agent to say so, but answer quality depends on the
  model the user runs.
- It needs `node` on the host or inside the sandbox when OpenClaw sandboxes the agent. OpenClaw
  itself runs on Node, so a normal install has it; a custom sandbox image may not.
- ClawHub's security scan runs after upload; a listing is not public until it passes.
- The dry run accepts `--categories finance,research` without checking the slugs against ClawHub's
  list; confirm them on the listing after publishing.

## Links

- Skill folder: `openclaw/hyperodds/` (`SKILL.md`, `scripts/odds.mjs`)
- Tests: `test/odds.test.mjs`, `test/skill.test.mjs`
- OpenClaw skills: https://docs.openclaw.ai/tools/skills
- Creating skills: https://docs.openclaw.ai/tools/creating-skills
- ClawHub skill format: https://docs.openclaw.ai/clawhub/skill-format
- ClawHub publishing: https://docs.openclaw.ai/clawhub/publishing
- ClawHub CLI: https://docs.openclaw.ai/clawhub/cli
- OpenClaw MCP transports: https://docs.openclaw.ai/cli/mcp/transports
- Hyperodds MCP guide: https://usehyperodds.com/docs/mcp
- ClawHub listing, after publishing: https://clawhub.ai/usehyperodds/skills/hyperodds

## Announcement

One line:

> Hyperodds is on ClawHub: your OpenClaw agent can now read every HIP-4 market on Hyperliquid.

One paragraph:

> The Hyperodds skill for OpenClaw gives your agent live data on every HIP-4 outcome market on
> Hyperliquid, from every deployer. Ask which markets trade furthest from their fair line after
> fees, or whether two deployers list the same question under the same rules. It needs no key and
> can't trade. Install it with
> `openclaw skills install @usehyperodds/hyperodds`.

One post (link in the reply):

> Hyperodds is on ClawHub.
>
> Install the skill and your OpenClaw agent reads every HIP-4 market on Hyperliquid, with fair lines
> and the edge after fees wherever Hyperodds can price them.
>
> openclaw skills install @usehyperodds/hyperodds
>
> No key, and it can't trade.

Reply: `https://clawhub.ai/usehyperodds/skills/hyperodds`
