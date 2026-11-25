# Hyperodds

Find any HIP-4 market on Hyperliquid from Raycast and see where its price sits against the Hyperodds fair
line. Pin the markets you follow and their prices stay in the macOS menu bar.

## Commands

- **Search Markets**: type what you're looking for (`btc`, `arsenal`, `fed`) or paste a market link from
  usehyperodds.com. It shows up to 50 markets, busiest first. An empty search shows your pinned markets,
  then the busiest of all. The dropdown narrows to one of the categories that have markets right now.
- **Top Edges**: the markets priced furthest below their fair line right now.
- **New Listings**: the newest HIP-4 markets from every deployer.
- **Pinned Prices**: your first pinned market's name and price in the menu bar, refreshed about once a
  minute, with every pin a click away. Choose name and price, price only, or the icon alone in the
  command's settings.

Each market shows the bid and ask for both sides, the fair line and the edge after fees, when it settles
and who settles it. Press Enter to open it on usehyperodds.com, `⌘⇧C` to copy its link, `⌘.` to pin it
and `⌘Y` to show or hide the details.

## Install from source

The extension runs inside Raycast, so you need the Raycast app on a Mac, and Node.js 22.22.2 or later
to build it.

```sh
git clone https://github.com/usehyperodds/hyperodds-plugins.git
cd hyperodds-plugins/raycast
npm ci
npm run dev
```

`npm run dev` adds the extension to Raycast, where it stays after you stop the command with Ctrl+C.
Open Raycast and type "Search Markets". For prices in the menu bar, open Pinned Prices once.

## Reading the numbers

- **Price** is the middle of the book, in cents, when the bid and the ask are both quoted and no more
  than 10 cents apart. For a wider or one-sided book it is the last trade from the past 24 hours, or
  "No trades in 24h" when there was none. A settled market shows the side that won.
- **Fair line** is the Hyperodds estimate of the probability that a side wins, from options markets,
  realized volatility, or matched Polymarket and Kalshi markets. The detail pane names the method and how
  confident the estimate is.
- **Edge after fees** is how far the fair line sits above what a $100 buy costs, in percentage points,
  after every fee. Top Edges lists only edges of at least half a point, on fair lines from more than one
  source with at least 50% confidence.

Fair lines are estimates. An edge is the gap between a price and an estimate, not a promise of profit.
Read the market's rules on usehyperodds.com before you trade.

## Data and privacy

Market data comes from the public Hyperodds API at `api.usehyperodds.com`. There is no account and no API
key. The extension only reads market data: it cannot trade and never sees a wallet. Pins stay in Raycast's
local storage on your computer, and the extension collects no analytics.
