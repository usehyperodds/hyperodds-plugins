---
name: hip4-markets
description: Read Hyperliquid HIP-4 outcome markets with the Hyperodds MCP tools. Use when someone asks about HIP-4 or Hyperliquid prediction markets, what a market trades at, fair lines, edges after fees, deployers, rules or new listings.
---

# Reading HIP-4 markets

The `hyperodds` MCP server reads every HIP-4 outcome market on Hyperliquid, from every deployer, and
estimates a fair line from outside quotes where it can. Its four tools are read-only. None can place
an order or see an account.

## Pick the tool

| Question                                       | Tool           | Arguments                                                                                                       |
| ---------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| Find markets, rank them, see what settles soon | `odds_markets` | `sort` (`volume` default, `edge`, `new`, `settling`), `category`, `deployer`, `q` (title text), `limit` up to 100, `offset` |
| What was just listed                           | `odds_new`     | `category`, `limit`, `offset`                                                                                   |
| One market's fair line and edge each way       | `odds_fair`    | `outcome`                                                                                                       |
| The same question on several deployers         | `odds_cluster` | `outcome` of any member, or `id` (a market's `clusterId`)                                                       |

Categories are `sports`, `crypto`, `equities`, `commodities`, `indices`, `macro`, `ipo`, `awards`
and `other`. Deployer `hl` is Hyperliquid itself; other codes, such as `out`, are independent
deployers. Find a market's `outcome` id with `odds_markets` and `q` before calling `odds_fair` or
`odds_cluster`.

## Read the numbers

- `bid`, `ask` and `fair` are probabilities from 0 to 1 for side 0, the first label in `sides`
  (usually Yes). Quote them as cents: 0.42 is 42¢.
- `edgePts` is the best buy edge in percentage points after every fee, including the fee
  Hyperliquid takes at settlement, for a $100 order. 2.9 means 2.9¢ a share. `edgeSide` is the
  index of that side in `sides`. The edge is null when there is no fair line or $100 would not fill.
- `odds_fair` adds `edge.buy0`, `buy1`, `sell0` and `sell1`: the edge for each way to trade at
  `refUsd`. A negative edge means the trade costs more than the fair line says it is worth.
- A fair line is an estimate. Rely on it only when `fairConfidence` is at least 0.5 and
  `singleSource` is false, and say so when either check fails. `sort: "edge"` ranks the lines that
  pass both checks first.
- `status` is `open`, `live` (the event has started and still trades) or `awaiting` (past its
  time, trading until the deployer settles). `settles` is in UTC.
- `volume24h` counts shares. A share pays $1 if its side wins.
- A `clusterId` means other deployers list the same question. Call `odds_cluster` before comparing
  their prices. Only `SAME` members are interchangeable; `CLOSE` and `DIFFERENT` members list their
  rule differences in `diffs`, and `flipped` means a member's sides are reversed.

## Answer

- Lead with the answer. For each market give the title, deployer, price, settle time and `url`.
- Show five markets or fewer unless asked for more.
- Present edges and fair lines as estimates, never as expected profit, and do not tell anyone to
  trade. To trade, they open the market's link in the Hyperodds Console.
- Each IP address gets 1,000 tool calls a day, reset at 00:00 UTC, and 5 requests a second. On a
  limit error, say which limit was hit and stop retrying.
