// Runs the add-in's functions in Node against the live Hyperodds API and prints every value a cell would get.
// npm run live -- [seconds] [search]
import { createFeed } from "../src/feed.js";
import { COLUMNS, edge, fair, market, price, useFeed } from "../src/functions.js";

if (typeof EventSource === "undefined") {
  console.error("Run with node --experimental-eventsource (Node 22.3 or later), or use npm run live.");
  process.exit(1);
}

const seconds = Number(process.argv[2] ?? 45);
const search = process.argv[3] ?? "btc";
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
  console.error("Usage: npm run live -- [seconds, 1 to 3600] [search]");
  process.exit(1);
}
const feed = createFeed();
useFeed(feed);

const start = Date.now();
const at = () => `+${((Date.now() - start) / 1000).toFixed(1).padStart(5)}s`;
const text = (value) => (typeof value === "object" ? `${value.code} ${value.message}` : String(value));

function printTable(rows) {
  const shown = rows.map((row) => row.map((cell, i) => (i === 1 ? String(cell).slice(0, 38) : String(cell))));
  const widths = COLUMNS.map((_, i) => Math.max(...shown.map((row) => row[i].length)));
  for (const row of shown)
    console.log(`          ${row.map((cell, i) => cell.padEnd(widths[i])).join("  ")}`.trimEnd());
}

feed.onStatus((status) => status !== "idle" && console.log(`${at()}  stream ${status}`));

const WIDTH = 64;
const cells = [];
function enter(formula, fn, ...args) {
  const cell = { formula, values: [] };
  cells.push(cell);
  fn(...args, {
    setResult(value) {
      cell.values.push(value);
      if (!Array.isArray(value)) console.log(`${at()}  ${formula.padEnd(WIDTH)} ${text(value)}`);
    },
    set onCanceled(stop) {
      cell.stop = stop;
    },
  });
  return cell;
}

const table = enter(`=HYPERODDS.MARKET("${search}", 5)`, market, search, 5);
for (let waited = 0; !table.values.length; waited += 100) {
  if (waited >= 30_000) {
    console.error(`${table.formula} had no answer after 30 s.`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
const first = table.values[0];
if (!Array.isArray(first)) {
  console.error(`${table.formula} answered ${text(first)}`);
  process.exit(1);
}
console.log(`${at()}  ${table.formula} spills ${first.length} rows:`);
printTable(first);

const ids = first.slice(1).map((row) => row[0]);
for (const id of ids) enter(`=HYPERODDS.PRICE(${id})`, price, id, null, null);
const [id] = ids;
enter(`=HYPERODDS.PRICE(${id}, "No", "bid")`, price, id, "No", "bid");
enter(`=HYPERODDS.FAIR(${id})`, fair, id, null);
enter(`=HYPERODDS.EDGE(${id})`, edge, id, null);
enter(
  `=HYPERODDS.PRICE("https://usehyperodds.com/m/${id}", 0, "ask")`,
  price,
  `https://usehyperodds.com/m/${id}`,
  0,
  "ask",
);
enter(`=HYPERODDS.FAIR("usehyperodds.com/m/${id}", "No")`, fair, `usehyperodds.com/m/${id}`, "No");
enter("=HYPERODDS.PRICE(999999999)", price, 999999999, null, null);

await new Promise((resolve) => setTimeout(resolve, seconds * 1000));

console.log(`${at()}  ${table.formula} after ${seconds} s (${table.values.length} updates):`);
printTable(table.values.at(-1));
console.log(`${at()}  updates per cell over ${seconds} s:`);
for (const cell of cells) {
  console.log(`          ${cell.formula.padEnd(WIDTH)} ${String(cell.values.length).padStart(3)}`);
  cell.stop?.();
}
feed.close();
