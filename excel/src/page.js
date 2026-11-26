import { market } from "./functions.js";

const STATUS = {
  idle: 'Ready. Type =HYPERODDS.MARKET("btc") in a cell to start.',
  connecting: "Connecting to Hyperodds.",
  live: "Live. Cells update as the market moves.",
  reconnecting: "Reconnecting. Cells keep their last values meanwhile.",
  polling: "Live updates can't get through here, so cells refresh every 15 seconds.",
  offline: "No update from Hyperodds in two minutes. Cells show #N/A until updates resume. Retrying.",
};

// Where the add-in is served; a local build points this elsewhere (scripts/build.mjs, ADDIN_ORIGIN).
const HOME = typeof HYPERODDS_ADDIN === "string" ? HYPERODDS_ADDIN : "https://excel.usehyperodds.com";

function trouble(kind, wait, loaded) {
  if (kind === "offline") {
    return loaded
      ? "You're offline."
      : "You're offline, and no market data has loaded yet. Cells fill in once you're back online.";
  }
  if (kind === "blocked")
    return `Your browser is blocking Hyperodds' answers to this page (CORS). Retrying in ${wait} s.`;
  if (kind === "rate-limited") return `Too many requests from this address. Retrying in ${wait} s.`;
  if (kind === "unreachable") return `Can't reach Hyperodds. Retrying in ${wait} s.`;
  return `Hyperodds is unavailable right now. Retrying in ${wait} s.`;
}

// Why the last snapshot failed comes first, unless the stream is live and data is flowing anyway.
function describe(state, { note, loaded, problem }) {
  if (problem && (state !== "live" || !loaded)) {
    const text = trouble(problem.kind, problem.waitS, loaded);
    if (state === "offline") return `${text} Cells show #N/A until updates resume.`;
    return loaded ? `${text} Cells keep their last values for up to two minutes.` : text;
  }
  if (state === "polling" && note) return `${note} Until then, cells refresh every 15 seconds.`;
  return STATUS[state];
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

// Draws a spilled result the way a sheet shows it, flashing the numbers that moved.
function draw(table, value, previous) {
  table.replaceChildren();
  if (!Array.isArray(value)) {
    table.append(element("caption", `${value.code} ${value.message}`, "error"));
    return;
  }
  const head = element("tr");
  head.append(element("th", ""), ...value[0].map((_, i) => element("th", LETTERS[i])));
  table.append(element("thead"));
  table.tHead.append(head);
  const body = element("tbody");
  value.forEach((cells, r) => {
    const tr = element("tr");
    tr.append(element("th", String(r + 1)));
    cells.forEach((cell, c) => {
      const td = element("td", String(cell));
      if (c === 1 && r > 0) td.title = String(cell);
      if (typeof cell === "number") td.className = "number";
      if (r === 0) td.className = "label";
      const before = previous?.find((row) => row[0] === cells[0])?.[c];
      if (r > 0 && typeof cell === "number" && typeof before === "number" && before !== cell) {
        td.classList.add(cell > before ? "up" : "down");
      }
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(body);
  setTimeout(() => {
    for (const td of table.querySelectorAll(".up, .down")) td.classList.remove("up", "down");
  }, 60);
}

function preview(table) {
  let shown = null;
  market("btc", 5, {
    setResult(value) {
      draw(table, value, shown);
      shown = Array.isArray(value) ? value : null;
    },
  });
}

export function render(inExcel, feed) {
  document.body.dataset.mode = inExcel ? "excel" : "web";
  const status = document.querySelector("[data-status]");
  feed.onStatus((state, info) => {
    status.dataset.state = state;
    status.lastElementChild.textContent = describe(state, info);
  });
  if (inExcel) return;
  preview(document.querySelector("[data-preview]"));
  if (location.origin !== HOME) {
    const elsewhere = document.querySelector("[data-elsewhere]");
    elsewhere.textContent = `This copy runs from ${location.origin}. The add-in installs once it's live at ${HOME}/.`;
    elsewhere.hidden = false;
  }
}
