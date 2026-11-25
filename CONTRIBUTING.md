# Contributing

Thanks for helping. This repository holds the Hyperodds skills, plugins and extensions for agent
hosts. Each one reads from the hosted Hyperodds MCP server.
- A host it does not install in, a skill that misreads a field, or a gap in these docs: open an
  issue or a pull request here.
- A tool's output, a missing field or a new tool: open an issue. Those changes ship on the hosted
  server (`/mcp`, and the public API under `/trpc`), with no change here.

## Set up

You need Node.js 22 or later. Nothing to install.

```sh
git clone https://github.com/usehyperodds/hyperodds-plugins.git
cd hyperodds-plugins
node --test
npx @biomejs/biome@2.6.2 check .
```

The tests use Node's own test runner and a local mock server, so they run offline. CI runs both
commands on Node 22 and 24 on Linux, and on Node 24 on Windows.

## Pull requests

- Keep each pull request to one change, with a test that fails without it.
- Keep the repository free of runtime dependencies; hosts copy it as it is.
- Write commit messages in the imperative, short and lowercase: `name the limit in rate errors`.
- Say which host and version you tried it in.

By contributing, you agree to release your work under the [MIT license](LICENSE) and to follow the
[code of conduct](CODE_OF_CONDUCT.md).
