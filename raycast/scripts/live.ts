// Runs the extension's data layer in Node against the live Hyperodds API and prints what each command
// shows: list rows, the first row's detail pane, and the menu bar for a few pins. A failed load prints
// what the view shows instead.
// npm run live -- [search ...]     HYPERODDS_API=<base> points it at another server, such as a local proxy.
import { API, createClient, type Market, marketUrl } from "../src/lib/api.ts";
import { accessories, detailGroups, menuBar, price, type TitleMode } from "../src/lib/format.ts";

const base = process.env.HYPERODDS_API || API;
const api = createClient({ base });
const searches = process.argv.length > 2 ? process.argv.slice(2) : ["btc"];
const ROWS = 5;
const started = Date.now();

function list(title: string, markets: Market[], edges = false) {
  console.log(`\n${title} (${markets.length} rows, first ${Math.min(ROWS, markets.length)} shown)`);
  const now = Date.now();
  for (const m of markets.slice(0, ROWS)) {
    const right = accessories(m, now, { edges })
      .map((a) => a.text)
      .join("   ");
    console.log(`  ${m.title.slice(0, 54).padEnd(54)}  ${right}`);
  }
}

function detail(m: Market) {
  console.log(`\n  Detail pane: ${m.title}`);
  for (const [i, rows] of detailGroups(m).entries()) {
    if (i > 0) console.log(`    ${"-".repeat(64)}`);
    for (const row of rows) console.log(`    ${row.title.padEnd(20)} ${row.text}`);
  }
}

async function load<T>(
  title: string,
  run: () => Promise<T>,
  failure = "Couldn't load markets",
): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    console.log(`\n${title}\n  ${failure}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

console.log(`Hyperodds for Raycast, data layer against ${base}`);
console.log(`Run at ${new Date(started).toISOString()}`);

const results: Market[][] = [];
for (const search of searches) {
  const title = `Search Markets: "${search}"`;
  const found = await load(title, () => api.search({ q: search }));
  if (!found) continue;
  list(title, found);
  if (found[0]) detail(found[0]);
  results.push(found);
}
const [first, second] = results.flat();

const sportsTitle = "Search Markets: empty search, Sports category";
const sports = await load(sportsTitle, () => api.search({ category: "sports", limit: 50 }));
if (sports) list(sportsTitle, sports);

const edges = await load("Top Edges", () => api.edges(50));
if (edges) {
  list("Top Edges", edges, true);
  const edge = edges.find((m) => m.outcome !== first?.outcome) ?? edges[0];
  if (edge) detail(edge);
}

const fresh = await load("New Listings", () => api.newest());
if (fresh) {
  list("New Listings", fresh);
  if (fresh[0]) detail(fresh[0]);
}

const link = marketUrl(first?.outcome ?? 41294);
const linkTitle = `Search Markets: pasted link ${link}`;
const byLink = await load(linkTitle, () => api.search({ q: link }));
if (byLink) list(linkTitle, byLink);

// A few real pins, a market without a price first when there is one, and an id that isn't listed, to
// show the Unpin path.
const unpriced = [...results.flat(), ...(fresh ?? [])].find((m) => price(m) === null);
const pins = [
  ...new Set([unpriced, edges?.[0], second, sports?.[0], fresh?.[0]].flatMap((m) => (m ? [m.outcome] : []))),
];
pins.push(1);
const t0 = Date.now();
const barTitle = `Pinned Prices (menu bar): pins ${pins.join(", ")}`;
const pinned = await load(barTitle, () => api.pinned(pins), "Couldn't refresh prices");
if (pinned) {
  console.log(`\n${barTitle}, one batched request in ${Date.now() - t0} ms`);
  for (const mode of ["name", "price", "icon"] as TitleMode[]) {
    console.log(`  Menu bar title (${mode}): ${menuBar(pinned, mode).title ?? "(icon only)"}`);
  }
  const bar = menuBar(pinned, "name");
  for (const item of bar.items) console.log(`    ${item.title.padEnd(48)}  ${item.subtitle}`);
  for (const outcome of bar.gone) console.log(`    No longer listed: #${outcome} (offers Unpin)`);
}

console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
