// Serves dist/ at its real origin inside headless Chrome, so the page calls the API under real CORS.
// Checks the public page with Microsoft's real office.js (a live preview, a search that matches nothing,
// and the API unreachable), then stands in for Excel (office.js replaced by a stub that reports the Excel
// host and records CustomFunctions.associate) and runs the four functions there. Writes screenshots, a
// recording (MP4 when ffmpeg is installed) and a log to OUT.
//
//   npm run build && npm run check:browser -- [seconds]
//
// OUT defaults to /tmp/hyperodds-excel-check. CHROME names a Chrome binary; without it, Playwright looks
// for the installed Google Chrome. ADDIN_ORIGIN and API_ORIGIN match a local build's (see build.mjs).
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const out =
  process.env.OUT ?? join(process.platform === "win32" ? tmpdir() : "/tmp", "hyperodds-excel-check");
await mkdir(out, { recursive: true });
const here = pathToFileURL(`${out.replace(/[\\/]$/, "")}/`);
const file = (name) => fileURLToPath(new URL(name, here));
const dist = new URL("../dist/", import.meta.url);
const addin = process.env.ADDIN_ORIGIN?.replace(/\/$/, "") ?? "https://usehyperodds.com";
const api = process.env.API_ORIGIN?.replace(/\/$/, "") ?? "https://api.usehyperodds.com";
const pageUrl = `${addin}/excel/index.html`;
const seconds = Number(process.argv[2] ?? 30);
const viewport = { width: 1440, height: 900 };
const TYPES = {
  html: "text/html",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  xml: "text/xml",
  png: "image/png",
};

const log = [];
const say = (line) => {
  console.log(line);
  log.push(line);
};
const check = (ok, line) => {
  say(`${ok ? "ok  " : "FAIL"}  ${line}`);
  if (!ok) process.exitCode = 1;
};

const OFFICE_STUB = `
window.Office = {
  HostType: { Excel: "Excel" },
  onReady(callback) {
    const info = { host: "Excel", platform: "OfficeOnline" };
    setTimeout(() => callback(info));
    return Promise.resolve(info);
  },
};
window.associated = {};
window.CustomFunctions = {
  ErrorCode: { invalidValue: "#VALUE!", notAvailable: "#N/A" },
  Error: class { constructor(code, message) { this.code = code; this.message = message; } },
  associate(id, fn) { window.associated[id] = fn; },
};`;

async function serve(context, { stubOffice }) {
  await context.route(`${addin}/excel/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.replace(/^\/excel\//, "");
    try {
      route.fulfill({ body: await readFile(new URL(name, dist)), contentType: TYPES[name.split(".").pop()] });
    } catch {
      route.fulfill({ status: 404, body: "not found" });
    }
  });
  if (stubOffice) {
    await context.route("https://appsforoffice.microsoft.com/**", (route) =>
      route.fulfill({ body: OFFICE_STUB, contentType: "text/javascript" }),
    );
  }
}

const browser = await chromium.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: "chrome" }),
  headless: true,
});

say(`Hyperodds for Excel, browser check, ${new Date().toISOString()}`);
say(`Page served as ${pageUrl} from dist/; API calls go to ${api}.`);

// The public page, light and night, with its live preview of =HYPERODDS.MARKET("btc", 5).
for (const colorScheme of ["light", "dark"]) {
  const context = await browser.newContext({ viewport, colorScheme });
  await serve(context, { stubOffice: false });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pageUrl);
  await page.waitForSelector("[data-status][data-state='live']", { timeout: 20_000 });
  await page.waitForSelector("[data-preview] tbody tr:nth-child(3)", { timeout: 20_000 });
  const rows = await page.$$eval("[data-preview] tbody tr", (trs) => trs.length - 1);
  check(
    rows >= 2 && errors.length === 0,
    `public page (${colorScheme}): stream live, preview spilled ${rows} market rows`,
  );
  await page.waitForTimeout(1500);
  await page.screenshot({ path: file(`excel-page${colorScheme === "dark" ? "-night" : ""}.png`) });
  await context.close();
}

// The same page when the search matches nothing (the API answers a query rewritten to match nothing) and
// when the API can't be reached: the preview and the status line must say which. Interception skips the
// browser's CORS check, so a CORS block needs a real server without the headers; it isn't run here.
const failures = [
  [
    "no match",
    (route) => {
      const url = new URL(route.request().url());
      const input = url.searchParams.get("input");
      if (!input?.includes('"q"')) return route.continue();
      url.searchParams.set("input", JSON.stringify({ ...JSON.parse(input), q: "zzqx no such market" }));
      return route.continue({ url: url.toString() });
    },
    '#N/A No live market matches "btc".',
  ],
  ["offline", (route) => route.abort("internetdisconnected"), "#N/A Can't reach Hyperodds. Retrying."],
];
for (const [name, handler, expected] of failures) {
  const context = await browser.newContext({ viewport });
  await serve(context, { stubOffice: false });
  await context.route(`${api}/**`, handler);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pageUrl);
  const caption = await page
    .waitForSelector("[data-preview] caption", { timeout: 20_000 })
    .then((node) => node.textContent())
    .catch(() => "no caption");
  await page.waitForTimeout(1500);
  const status = await page.$eval("[data-status]", (node) => node.textContent);
  check(
    caption === expected && errors.length === 0,
    `public page (${name}): preview says "${caption}"; status "${status}"${errors.length ? `; errors: ${errors.join(" | ")}` : ""}`,
  );
  await page.screenshot({ path: file(`excel-page-${name.replace(" ", "-")}.png`) });
  await context.close();
}

// Inside Excel: the same page in task pane mode, running the functions Excel would call.
{
  const context = await browser.newContext({ viewport: { width: 380, height: 900 } });
  await serve(context, { stubOffice: true });
  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.waitForFunction(() => document.body.dataset.mode === "excel");
  const ids = await page.evaluate(() => Object.keys(window.associated));
  check(ids.join() === "PRICE,FAIR,EDGE,MARKET", `associated with Excel: ${ids.join(", ")}`);

  const first = await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.associated.MARKET("btc", 5, { setResult: resolve });
      }),
  );
  check(
    Array.isArray(first) && first.length > 1,
    `=HYPERODDS.MARKET("btc", 5) spilled ${first.length - 1} rows`,
  );
  const id = first[1][0];
  const formulas = [
    [`=HYPERODDS.PRICE(${id})`, "PRICE", [id, null, null]],
    [`=HYPERODDS.PRICE(${id}, "No")`, "PRICE", [id, "No", null]],
    [`=HYPERODDS.FAIR(${id})`, "FAIR", [id, null]],
    [`=HYPERODDS.EDGE(${id})`, "EDGE", [id, null]],
    [`=HYPERODDS.MARKET("btc", 5)`, "MARKET", ["btc", 5]],
  ];
  await page.evaluate((formulas) => {
    window.results = {};
    window.started = Date.now();
    for (const [formula, id, args] of formulas) {
      window.results[formula] = [];
      window.associated[id](...args, {
        setResult: (value) => window.results[formula].push([Date.now() - window.started, value]),
      });
    }
  }, formulas);
  await page.waitForTimeout(seconds * 1000);
  const results = await page.evaluate(() => window.results);
  for (const [formula, values] of Object.entries(results)) {
    const shown = values.map(([ms, value]) =>
      Array.isArray(value)
        ? `table @${(ms / 1000).toFixed(1)}s`
        : `${typeof value === "number" ? value : `${value.code} ${value.message}`} @${(ms / 1000).toFixed(1)}s`,
    );
    const numeric = values.some(([, value]) => typeof value === "number" || Array.isArray(value));
    check(
      numeric,
      `${formula}: ${values.length} value(s) in ${seconds} s: ${shown.slice(0, 6).join(", ")}${shown.length > 6 ? ", ..." : ""}`,
    );
  }
  const status = await page.$eval("[data-status]", (node) => node.dataset.state);
  check(status === "live", `task pane status: ${status}`);
  await page.screenshot({ path: file("excel-taskpane.png"), fullPage: false });
  await context.close();
}

// A recording of the public page's preview ticking.
{
  const videos = new URL("video/", here);
  await rm(videos, { recursive: true, force: true });
  await mkdir(videos);
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: fileURLToPath(videos), size: viewport },
  });
  await serve(context, { stubOffice: false });
  const page = await context.newPage();
  await page.goto(pageUrl);
  await page.waitForSelector("[data-preview] tbody tr:nth-child(3)", { timeout: 20_000 });
  await page.evaluate(() => document.querySelector(".preview").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(seconds * 1000);
  const video = await page.video().path();
  await context.close();
  const webm = file("excel-preview.webm");
  await rename(video, webm);
  await rm(videos, { recursive: true, force: true });
  let name = "excel-preview.webm";
  try {
    const mp4 = file("excel-preview.mp4");
    const h264 = [
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "24",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
    ];
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", webm, ...h264, "-an", mp4]);
    await rm(webm);
    name = "excel-preview.mp4";
  } catch (error) {
    say(`kept the WebM: ffmpeg could not make an MP4 (${error.message.split("\n")[0]})`);
  }
  say(`recording: ${name}, ${seconds} s of the public page's live preview`);
}

await browser.close();
await writeFile(new URL("browser-check.txt", here), `${log.join("\n")}\n`);
