---
name: hyperodds
description: Read live Hyperliquid HIP-4 outcome markets with Hyperodds. Prices, fair lines and edges after fees, the same question across deployers, new listings.
homepage: https://usehyperodds.com/docs/mcp
metadata:
  openclaw:
    homepage: https://usehyperodds.com/docs/mcp
    requires:
      bins:
        - node
    envVars:
      - name: HYPERODDS_MCP_URL
        required: false
        description: Another Hyperodds MCP endpoint to read from. Defaults to https://api.usehyperodds.com/mcp.
---

# Hyperodds

Hyperodds reads every HIP-4 outcome market on Hyperliquid, from every deployer, and estimates a fair
line from outside quotes where it can. Use this skill when someone asks about Hyperliquid outcome or
prediction markets: what is listed, what a market trades at, where its fair line sits, which markets
trade furthest from it after fees, whether two deployers list the same question under the same
rules, what settles soon or what was just listed.

The data is read-only. Nothing here can place an order or see an account.

## Getting data

Run the bundled script. It prints one line of JSON.

```bash
node {baseDir}/scripts/odds.mjs markets --sort edge --limit 5
node {baseDir}/scripts/odds.mjs markets --category crypto --q "BTC" --sort settling
node {baseDir}/scripts/odds.mjs new --limit 10
node {baseDir}/scripts/odds.mjs fair 22091
node {baseDir}/scripts/odds.mjs cluster 8572
```

| Command             | Answers                                                                                                      | Options                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `markets`           | Markets with bid, ask, fair line, best edge after fees, 24h volume, status and settle time                   | `--sort volume` (default), `edge`, `new` or `settling`; `--category`; `--deployer`; `--q` (text in the title); `--limit` up to 100; `--offset` |
| `new`               | The newest listings first, with the same fields                                                              | `--category`, `--limit`, `--offset`                                                                                                            |
| `fair <outcome>`    | One market's fair line with its band, method, confidence, flags and sources, the book, and the edge each way |                                                                                                                                                |
| `cluster <outcome>` | The same question on several deployers: each member's rule grade and differences, and the merged book        | `--id <clusterId>` in place of an outcome                                                                                                      |

Categories are `sports`, `crypto`, `equities`, `commodities`, `indices`, `macro`, `ipo`, `awards`
and `other`. Deployer `hl` is Hyperliquid itself; other codes, such as `out`, are independent
deployers.

Pass anything the user typed as its own quoted argument, as in `--q "fed cut"`. Never splice it
into other shell text.

If the session already has the Hyperodds MCP tools (`odds_markets`, `odds_new`, `odds_fair`,
`odds_cluster`), call them with the same arguments instead of running the script.

## Reading the numbers

- `bid`, `ask` and `fair` are probabilities from 0 to 1 for side 0, the first label in `sides`
  (usually Yes). Quote them as cents: 0.42 is 42¢.
- `edgePts` is the best buy edge in percentage points after every fee, including the fee
  Hyperliquid takes at settlement, for a $100 order. 2.9 means 2.9¢ a share. `edgeSide` is the
  index of that side in `sides`. The edge is null when there is no fair line or $100 would not fill.
- `fair` adds `edge.buy0`, `buy1`, `sell0` and `sell1`: the edge for each way to trade at
  `refUsd`. A negative edge means the trade costs more than the fair line says it is worth.
- A fair line is an estimate. Rely on it only when `fairConfidence` is at least 0.5 and
  `singleSource` is false, and say so when either check fails. `--sort edge` ranks the lines that
  pass both checks first.
- `status` is `open`, `live` (the event has started and still trades) or `awaiting` (past its
  time, trading until the deployer settles). `settles` is in UTC.
- `volume24h` counts shares. A share pays $1 if its side wins.
- A `clusterId` means other deployers list the same question. Run `cluster` before comparing their
  prices. Only `SAME` members are interchangeable; `CLOSE` and `DIFFERENT` members list their rule
  differences in `diffs`, and `flipped` means a member's sides are reversed.

## Answering

- Lead with the answer. For each market give the title, deployer, price, settle time and `url`.
- Show five markets or fewer unless asked for more.
- Present edges and fair lines as estimates, never as expected profit, and do not tell anyone to
  trade. To trade, they open the market's link in the Hyperodds Console.
- Each IP address gets 1,000 calls a day, reset at 00:00 UTC, and 5 requests a second. On a limit
  error, say which limit was hit and stop retrying.
