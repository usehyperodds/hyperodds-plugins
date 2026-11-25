// Builds dist/, the exact contents of usehyperodds.com/excel/ (apps/web/public/excel/ in the web app).
// A local build serves the add-in from ADDIN_ORIGIN/excel/ and reads markets from API_ORIGIN:
//   ADDIN_ORIGIN=http://localhost:3281 API_ORIGIN=http://localhost:3181 npm run build
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const PRODUCTION = { addin: "https://usehyperodds.com", api: "https://api.usehyperodds.com" };

function origin(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const url = new URL(value);
  if (url.pathname === "/" && !url.search && !url.hash) return url.origin;
  console.error(`${name} must be an origin, such as ${fallback}`);
  process.exit(1);
}

const addin = origin("ADDIN_ORIGIN", PRODUCTION.addin);
const api = origin("API_ORIGIN", PRODUCTION.api);
const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const path = (relative) => fileURLToPath(new URL(relative, root));
const served = (text) => text.replaceAll(`${PRODUCTION.addin}/excel/`, `${addin}/excel/`);

await rm(dist, { recursive: true, force: true });
await mkdir(dist);

await build({
  entryPoints: [path("src/addin.js")],
  outfile: path("dist/functions.js"),
  bundle: true,
  format: "iife",
  target: "es2020",
  legalComments: "none",
  logLevel: "warning",
  define: { HYPERODDS_API: JSON.stringify(api), HYPERODDS_ADDIN: JSON.stringify(addin) },
});

execFileSync(
  process.execPath,
  [
    path("node_modules/custom-functions-metadata/lib/cli.js"),
    "generate",
    path("src/functions.js"),
    path("dist/functions.json"),
  ],
  { stdio: "inherit" },
);
await writeFile(
  new URL("functions.json", dist),
  served(await readFile(new URL("functions.json", dist), "utf8")),
);

// Another origin gets its own add-in id and name, so a local copy never replaces the real one in Excel.
let manifest = served(await readFile(new URL("manifest.xml", root), "utf8"));
if (addin !== PRODUCTION.addin) {
  const hex = createHash("sha256").update(addin).digest("hex");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  manifest = manifest
    .replace(/<Id>[^<]+<\/Id>/, `<Id>${id}</Id>`)
    .replace(
      '<DisplayName DefaultValue="Hyperodds" />',
      `<DisplayName DefaultValue="Hyperodds (${new URL(addin).host})" />`,
    );
}
await writeFile(new URL("manifest.xml", dist), manifest);

for (const file of ["src/index.html", "src/page.css"]) {
  await cp(new URL(file, root), new URL(file.replace(/^src\//, ""), dist));
}
await cp(new URL("assets/", root), new URL("assets/", dist), { recursive: true });

async function list(dir, prefix = "") {
  for (const name of (await readdir(dir)).sort()) {
    const url = new URL(name, dir);
    const info = await stat(url);
    if (info.isDirectory()) await list(new URL(`${name}/`, dir), `${prefix}${name}/`);
    else console.log(`${String(info.size).padStart(8)}  ${prefix}${name}`);
  }
}
await list(dist);
if (addin !== PRODUCTION.addin || api !== PRODUCTION.api) console.log(`add-in ${addin}/excel/, API ${api}`);
