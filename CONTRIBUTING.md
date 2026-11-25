# Contributing

Thanks for helping. This repository holds the Hyperodds skills, plugins and extensions. The ones for
agent hosts read from the hosted Hyperodds MCP server. The Raycast extension and the Excel add-in
read the public API under `https://api.usehyperodds.com/trpc`, and the MetaMask Snap reads nothing.
- A host it does not install in, a skill that misreads a field, or a gap in these docs: open an
  issue or a pull request here.
- A tool's output, a missing field or a new tool: open an issue. Those changes ship on the hosted
  server (`/mcp`, and the public API under `/trpc`), with no change here.

## Set up

You need Node.js 22.18 or later, which runs the Raycast extension's TypeScript tests as they are.
Nothing to install at the root.

```sh
git clone https://github.com/usehyperodds/hyperodds-plugins.git
cd hyperodds-plugins
node --test
npx @biomejs/biome@2.6.2 check .
```

The tests use Node's own test runner and a local mock server, so they run offline. CI runs both
commands on Node 22 and 24 on Linux, and on Node 24 on Windows.

`raycast/`, `excel/` and `snap/` are npm packages of their own. Each has a CI job that runs the
commands below.

```sh
cd raycast && npm ci && npm test && npm run build && npx prettier --check .
cd excel && npm ci && npm run build && npm test && npm run validate
cd snap && npm ci && npm run typecheck && npm test
```

Raycast's CLI needs Node.js 22.22.2 or later. `npm run live -- btc` in `raycast/` runs its data
layer against the live API; the extension itself runs in Raycast on a Mac, with `npm run dev`. The
Snap's tests run in MetaMask's Snaps simulator and rebuild the bundle first, so a change under
`snap/src/` also changes the checksum in `snap/snap.manifest.json`. Commit both.

## Pull requests

- Keep each pull request to one change, with a test that fails without it.
- Outside `raycast/`, `excel/` and `snap/`, keep the repository free of runtime dependencies; hosts
  copy it as it is.
- Write commit messages in the imperative, short and lowercase: `name the limit in rate errors`.
- Say which host and version you tried it in.

By contributing, you agree to release your work under the [MIT license](LICENSE) and to follow the
[code of conduct](CODE_OF_CONDUCT.md).
