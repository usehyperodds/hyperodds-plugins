# Hyperodds for Excel

Live HIP-4 odds as Excel functions. Type `=HYPERODDS.MARKET("btc")` in A1 for a live table of markets with
their outcome ids in column A, then `=HYPERODDS.PRICE(A2)` in the first free column (N2) and fill it down.
Each cell follows its market on Hyperliquid. Prices and fair lines are in cents and edges in points.

| Function                                     | Gives                                                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `=HYPERODDS.PRICE(outcome, [side], [quote])` | The price of one side in cents, 0 to 100: `"mid"` (default), `"bid"`, `"ask"` or `"last"`. 100 or 0 once settled. No mid on a book wider than 10 points |
| `=HYPERODDS.FAIR(outcome, [side])`           | The Hyperodds fair line in cents: its estimate of the chance that side wins                                             |
| `=HYPERODDS.EDGE(outcome, [side])`           | Points on a $100 buy: the fair line minus the price you'd pay (the ask) after every fee; without a side, the better one |
| `=HYPERODDS.MARKET([search], [limit])`       | A spilled table of matching markets, busiest first                                                                      |

`MARKET` columns: outcome, market, status (Open, In play, Started 25m ago, Settlement was due 2h ago,
Settled), deployer, side, bid (¢), ask (¢), fair (¢), edge side, edge (pts), volume 24h (contracts, each worth
$1 at settlement), starts (UTC) and settles (UTC). Status shows whether a game is in play or settlement is
overdue. Times are UTC text, because a custom function can't format its cell as a date.

`outcome` is the number at the end of a market's link (`usehyperodds.com/m/<id>`) or the link itself. `side`
is 0 or `"Yes"` (default), 1 or `"No"`, or a side's own name such as `"BAL"`.

The add-in installs from https://usehyperodds.com/excel/index.html, with the steps and
full reference on that page. Office lists it as able to read and change your workbook, the permission Excel
requires of every add-in with custom functions. The add-in writes each result to the cell that asked for it
and leaves the rest of the workbook alone. It can't trade or touch an account.

## How it works

An Office add-in with an XML manifest and a shared runtime: the custom functions and the task pane run in
one page, `index.html`, loaded from `https://usehyperodds.com/excel/`. Every cell in a workbook shares one
`live.summaries` stream from `https://api.usehyperodds.com` (server-sent events) and one snapshot of every
market, taken at once and retaken whenever the stream reconnects. If the stream can't connect, cells
refresh every 15 seconds instead, waiting longer when the API asks, and the stream is retried with backoff.
`MARKET` asks the API's search which markets match once a minute, one query per distinct search, and takes
their numbers from the stream in between. Two minutes after the last update, cells show `#N/A` with its
time until updates resume, and the task pane says why.

## Development

Node.js 22.3 or later.

```sh
npm ci
npm run build          # dist/: the files served at usehyperodds.com/excel/
npm test               # unit tests with a mocked API and stream, plus checks on dist/
npm run validate       # Microsoft's manifest validator (sends dist/manifest.xml to Microsoft's service)
npm run live           # the functions in Node against the live API, printing what each cell gets
npm run check:browser  # the page in headless Chrome: live preview, no match, unreachable, Excel stub
```

`npm run live -- 60 eth` runs for 60 seconds on markets matching "eth".

### Local builds

A local build serves the add-in from another origin and reads another API:

```sh
ADDIN_ORIGIN=http://localhost:3281 API_ORIGIN=http://localhost:3181 npm run build
```

Serve `dist/` at `/excel/` on that origin (the web app does it from `apps/web/public/excel/`). The API must
allow the origin: the web app's own origin always is; any other goes in the API's `CORS_ORIGINS`. The build
gives a local manifest its own id and name, so it never replaces the real add-in in Excel.

`npm run check:browser -- 30` runs the browser check for 30 seconds against whatever `ADDIN_ORIGIN` and
`API_ORIGIN` name (production by default). It writes screenshots, a recording and a log to `OUT`
(`/tmp/hyperodds-excel-check` by default). `CHROME` names a Chrome binary when Playwright can't find one.
