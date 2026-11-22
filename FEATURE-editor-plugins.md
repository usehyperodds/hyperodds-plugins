# Hyperodds plugins for Claude Code, Codex and Gemini CLI

> One install puts live HIP-4 market data in Claude Code, Codex or Gemini CLI.

Built on each tool's public plugin format: Claude Code plugins and marketplaces, Codex plugins
(the Agent Plugins 1.0.0 package format plus a Codex marketplace file) and Gemini CLI extensions.
Each install connects the hosted Hyperodds MCP server and adds one skill. No listing in any
vendor directory exists or is implied; installs run straight from the GitHub repository.

## What works now

One repository root is all three packages:

| File                               | Read by                               | Holds                                                                         |
| ---------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| `.claude-plugin/plugin.json`       | Claude Code                           | Manifest, with the MCP server inline (`type: "http"`)                         |
| `.claude-plugin/marketplace.json`  | Claude Code (and Codex as a fallback) | Marketplace `hyperodds` listing the root as the plugin                        |
| `plugin.json`                      | Codex                                 | Agent Plugins manifest, OpenAI display metadata                               |
| `mcp.json`                         | Codex                                 | Agent Plugins MCP config (`type: "streamable-http"`)                          |
| `.agents/plugins/marketplace.json` | Codex                                 | Marketplace `hyperodds`, policy and category                                  |
| `gemini-extension.json`            | Gemini CLI                            | Extension manifest, MCP server as `httpUrl`                                   |
| `GEMINI.md`                        | Gemini CLI                            | Always-on context: how to read the numbers, say the times and take forecasts  |
| `skills/hip4-markets/SKILL.md`     | Claude Code, Codex, Gemini CLI        | The skill: which tool for which question, how to read and present the numbers |
| `assets/icon.png`                  | Codex app, Claude directory listing   | The Hyperodds mark, 512×512                                                   |

The MCP server is declared inline in `.claude-plugin/plugin.json`. A root `.mcp.json` would also
register a project-scope server for anyone who opens Claude Code inside this repository, and an
early test run picked that unapproved copy over the plugin's.

Every host was installed on this Mac, each in a throwaway config directory:
- **Claude Code 2.1.330**, rerun 22 Nov 2026 (`CLAUDE_CONFIG_DIR` set to a fresh temporary
  directory):
  `claude plugin validate .claude-plugin/plugin.json --strict` passes with nothing to report,
  including the plugin-directory checks. `claude plugin marketplace add ./` and
  `claude plugin install hyperodds@hyperodds` succeed; `claude mcp list` shows
  `plugin:hyperodds:hyperodds ... ✔ Connected`; `claude plugin details` lists the `hip4-markets`
  skill and the `hyperodds` server. A live answer: the throwaway directory has no login, so the
  model run used this Mac's existing Claude Code login with the plugin loaded for that one session
  (`--plugin-dir .`, `--setting-sources project`, no settings written). The model invoked
  `hyperodds:hip4-markets`, called `odds_markets` with `sort: "edge"` and answered with three
  markets, their links and the reliability checks.
- **Codex CLI 0.166.0** (`CODEX_HOME` set to a fresh temporary directory):
  `codex plugin marketplace add ./` reads `.agents/plugins/marketplace.json`;
  `codex plugin add hyperodds@hyperodds` installs 0.1.0 into the cache; `codex plugin list` shows
  `installed, enabled`; `codex mcp list` shows the `hyperodds` server enabled.
  `codex debug prompt-input` shows `hyperodds:hip4-markets` in the skills the model would see.
  `docs/feature/editor-plugins/codex-check.mjs` drives Codex's own app server: it lists the 7
  tools Codex discovered from the plugin's server (rerun on 22 Nov 2026) and calls `odds_markets`
  through Codex's MCP client, returning live markets. No model turn: the throwaway home has no
  ChatGPT login.
- **Gemini CLI 0.66.0** (`GEMINI_CLI_HOME` set to a fresh temporary directory):
  `gemini extensions validate .` passes; `gemini extensions install . --consent --skip-settings`
  installs after the folder-trust prompt; `gemini extensions list` shows the `GEMINI.md` context
  file, the `hyperodds` MCP server and the `hip4-markets` skill; `gemini mcp list` shows
  `hyperodds ... Connected` in a trusted folder. No model turn: there is no Gemini login or key.
- The user configurations on this Mac (`~/.claude`, `~/.codex/config.toml`, `~/.gemini`) carry no
  trace of these installs (checked after the runs).
- Tests: `node --test` runs 13 tests (same name, version and description everywhere;
  the same endpoint in each host's transport format; the Agent Plugins schema rules for
  `plugin.json` and `mcp.json`; both marketplace files; referenced files exist; no root
  `.mcp.json`; the skill's frontmatter; all seven server tools named in the skill and `GEMINI.md`;
  no manifest calling the plugin read-only, and Codex's `Write` capability; the skill's price
  examples checked against the console's own formatting; the answer rules).
  `npx @biomejs/biome@2.6.2 check .` is clean. CI runs both on Node 22 and 24.

## Not done yet

- The public GitHub repository. Every install line in the README needs
  `github.com/usehyperodds/hyperodds-plugins` to exist and be public.
- Gemini's extension gallery listing, which is automatic once the repository is public and tagged
  (operator, below).
- Vendor directories (Anthropic's plugin directory, OpenAI's plugin directory) are optional
  submissions with their own reviews. Nothing in this build or its copy depends on them.

## Run the demo

From a clone (or, once public, with the README's GitHub install lines):

```sh
# Claude Code
claude plugin marketplace add ./ && claude plugin install hyperodds@hyperodds
claude -p "Which HIP-4 markets show the biggest edge after fees right now? Top three." \
  --allowedTools mcp__plugin_hyperodds_hyperodds Skill

# Codex
codex plugin marketplace add ./ && codex plugin add hyperodds@hyperodds
codex exec "Which HIP-4 markets show the biggest edge after fees right now? Top three."

# Gemini CLI
gemini extensions install . --consent
gemini -p "Which HIP-4 markets show the biggest edge after fees right now? Top three."
```

To try without touching your own configuration, prefix each block with
`CLAUDE_CONFIG_DIR=$(mktemp -d)`, `CODEX_HOME=$(mktemp -d)` or `GEMINI_CLI_HOME=$(mktemp -d)`;
the model runs then need a login in that directory. `codex exec` and `gemini -p` were not run here
for that reason.

## Assets

`docs/feature/editor-plugins/`, 1440×900, rendered from captured terminal output (light theme, IBM
Plex Mono). Throwaway directories show as `$CODEX_HOME` and `$GEMINI_CLI_HOME`, the home directory
as `~`.
- `editor-claude-answer.png`: Claude Code answering "Which HIP-4 markets show the biggest edge
  after fees right now? Top three." through the plugin (live data, 4 Nov 2026 about 23:50 UTC). It
  predates the skill's time and price wording: it says "Settles" for touch markets that settle by
  that time, and quotes whole cents. Recapture it with a model run before a post uses it.
- `editor-claude.png`: marketplace add, install, `claude mcp list` (Connected), plugin details
  (recaptured 22 Nov 2026 from a fresh clone at `/tmp/hyperodds-plugins`).
- `editor-codex.png`: marketplace add, plugin add, plugin list, `codex mcp list`, and the check
  script (copied to `/tmp`) listing the 7 tools and a live `odds_markets` call through Codex
  (recaptured 22 Nov 2026 from the same clone).
- `editor-gemini.png`: validate, install with the trust prompt, extension list (context file, MCP
  server, skill), `gemini mcp list` (Connected).
- `codex-check.mjs`: the Codex app-server check used for `editor-codex.png`.

No recording: nothing here moves.

## What the operator must do

1. Keep the write-ups off the public `main`. When merging, move `FEATURE-editor-plugins.md` and
   `docs/feature/editor-plugins/` out of the repository into the private ops folder
   (`ops/feature/plugins/editor-plugins/`), and do the same for every other unit's `FEATURE-*.md`
   and `docs/feature/<unit>/`. Check before pushing:

   ```sh
   git ls-files 'FEATURE-*.md' docs/feature   # must print nothing
   ```

2. Create the public repository and push `main` once the plugins branches are merged:

   ```sh
   gh repo create usehyperodds/hyperodds-plugins --public \
     --description "Hyperodds plugins: live data on Hyperliquid HIP-4 outcome markets" \
     --homepage https://usehyperodds.com/docs/mcp
   git remote add origin https://github.com/usehyperodds/hyperodds-plugins.git
   git push -u origin main
   ```

3. Gemini CLI gallery: add the topic and tag the first release; the crawler indexes daily.

   ```sh
   gh repo edit usehyperodds/hyperodds-plugins \
     --add-topic gemini-cli-extension --add-topic hyperliquid --add-topic mcp --add-topic claude-code-plugin
   git tag v0.1.0 && git push origin v0.1.0
   gh release create v0.1.0 --title "v0.1.0" --notes "First release: Hyperodds for Claude Code, Codex and Gemini CLI."
   gh api 'search/code?q=repo:usehyperodds/hyperodds-plugins+filename:gemini-extension.json' --jq .total_count
   ```

   If the last command prints 0 after a day, open
   `https://github.com/search?q=repo%3Ausehyperodds%2Fhyperodds-plugins+gemini-extension.json&type=code`
   while signed in to trigger indexing.

4. Check each install line from the public repository in a clean directory:

   ```sh
   CLAUDE_CONFIG_DIR=$(mktemp -d) claude plugin marketplace add usehyperodds/hyperodds-plugins
   CODEX_HOME=$(mktemp -d) codex plugin marketplace add usehyperodds/hyperodds-plugins
   GEMINI_CLI_HOME=$(mktemp -d) gemini extensions install https://github.com/usehyperodds/hyperodds-plugins --consent
   ```

5. Optional, separate reviews: Anthropic's directory through https://claude.ai/directory/manage
   (needs a paid claude.ai plan; `claude plugin validate .claude-plugin/plugin.json --profile directory`
   passes today), and OpenAI's plugin directory through https://platform.openai.com/plugins (needs
   a verified organization, five test cases and domain verification for api.usehyperodds.com).
6. Post the announcement below with the repository link in a reply.

## Known limits

- A model answer was proven in Claude Code only. Codex and Gemini CLI are proven up to the agent's
  own MCP client: installed, connected, tools discovered, and in Codex a live tool call. Their
  model turns need a login this build did not have.
- The Claude Code answer ran on this Mac's existing login with the plugin loaded through
  `--plugin-dir`, because the throwaway install had no login. The plugin, skill and server are the
  same files either way.
- Gemini CLI asks the user to trust the extension source, and disables MCP servers in untrusted
  workspaces. Skills ask for consent the first time they activate. Both are Gemini's design.
- `codex mcp list` prints `Auth: Unsupported` for the server. It means the server offers no OAuth,
  which is correct for a keyless server.
- Every host copies the whole repository into its install, `.git` included, so `test/` and every
  other unit's folder (`excel/`, `openclaw/`, `raycast/`, `shortcuts/`, `snap/`, about 1 MB
  together) ride along. The write-ups and screenshots still move to the ops folder at merge
  (step 1), so they never ship.
- Six branches share this repository and an identical scaffold commit: `feature/editor-plugins`,
  `feature/openclaw`, `feature/excel`, `feature/metamask-snap`, `feature/raycast` and
  `feature/siri`. Merged in that order (checked in a scratch clone), this branch merges cleanly,
  `feature/openclaw` conflicts in `README.md` (keep every unit's section), and each of the last
  four conflicts in `.github/workflows/ci.yml`, because every branch adds that file and
  `feature/excel` and `feature/raycast` add jobs to it: keep the shared `test` job once, plus the
  `excel` and `raycast` jobs.
- The hosted server's limits apply: 1,000 market tool calls a day per IP address (the forecast
  tools don't count) and 5 requests a second.
- Every host gets the server's seven tools. `odds_forecast` is not read-only: it records forecasts
  a person signs, or returns a sign link. The skill calls it only when the person asks to enter a
  forecast.
- The MCP output gives `starts` and `settles` but not a market's kind, so the skill tells "settles
  at" from "settles by" by category and title (touch markets).

## Links

- Claude Code plugin manifest: https://code.claude.com/docs/en/plugins-reference
- Claude Code marketplaces: https://code.claude.com/docs/en/plugins/marketplace-reference
- Codex plugins: https://developers.openai.com/codex/plugins/build
- Agent Plugins schemas: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json,
  https://agent-plugins.org/schemas/1.0.0/mcp.schema.json
- Gemini CLI extensions: https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md
- Gemini CLI extension releases and gallery: https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/releasing.md
- Hyperodds MCP guide: https://usehyperodds.com/docs/mcp
- Repository, after publishing: https://github.com/usehyperodds/hyperodds-plugins

## Announcement

One line:

> Agents in Claude Code, Codex and Gemini CLI can now read every HIP-4 market on Hyperliquid.

One paragraph:

> Agents in Claude Code, Codex and Gemini CLI can now read every HIP-4 market on Hyperliquid
> through the Hyperodds plugin. It connects the Hyperodds MCP server and adds a skill that teaches
> the agent to read fair lines and edges after fees. Ask which markets trade furthest from their
> fair line, or, when two or more deployers list the same question, whether their rules match. It
> needs no key, and no tool can trade or see an account.

One post (link in the reply):

> Agents in Claude Code, Codex and Gemini CLI can now read every HIP-4 market on Hyperliquid.
>
> They get fair lines and the edge after fees wherever Hyperodds can price them.
>
> No key, and no tool can trade. Install lines in the reply.

Reply: `https://github.com/usehyperodds/hyperodds-plugins` (the README has the install line for
each tool).
