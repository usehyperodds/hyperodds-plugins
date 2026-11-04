# Hyperodds

The `hyperodds` MCP server gives read-only data on Hyperliquid HIP-4 outcome markets:
`odds_markets`, `odds_new`, `odds_fair` and `odds_cluster`. For a question about HIP-4 or
Hyperliquid prediction markets, use these tools and activate the `hip4-markets` skill for the
details.
- Prices are probabilities from 0 to 1 for side 0, the first label in `sides`. Quote them as cents.
- `edgePts` is in percentage points after every fee for a $100 order, on the side `edgeSide` names.
- Rely on a fair line only when `fairConfidence` is at least 0.5 and `singleSource` is false.
- Call `odds_cluster` before comparing one question across deployers; only `SAME` members match.
- Give each market's title, deployer, price, settle time (UTC) and `url`. Edges are estimates;
  never tell anyone to trade.
