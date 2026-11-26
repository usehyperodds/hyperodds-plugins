import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
const read = (url) => readFile(url, "utf8");
const skip = !existsSync(new URL("functions.json", dist)) && "run npm run build in excel/ first";
const BASE = "https://excel.usehyperodds.com/";

test("the metadata declares the four streaming functions the script associates", { skip }, async () => {
  const { functions } = JSON.parse(await read(new URL("functions.json", dist)));
  assert.deepEqual(
    functions.map((f) => f.id),
    ["PRICE", "FAIR", "EDGE", "MARKET"],
  );
  for (const f of functions) {
    assert.equal(f.options.stream, true, f.id);
    assert.equal(f.helpUrl, `${BASE}index.html#${f.id.toLowerCase()}`);
    assert.ok(f.description.length <= 255, f.id);
    assert.equal(f.parameters[0].optional, f.id === "MARKET" ? true : undefined);
  }
  assert.deepEqual(functions.at(-1).result, { dimensionality: "matrix", type: "any" });
  const source = await read(new URL("src/addin.js", root));
  const associated = [...source.matchAll(/associate\("([A-Z]+)"/g)].map(([, id]) => id);
  assert.deepEqual(associated, ["PRICE", "FAIR", "EDGE", "MARKET"]);
  assert.match(await read(new URL("functions.js", dist)), /associate\("MARKET"/);
});

test("every Hyperodds URL in the manifest is a file the build puts in dist/", { skip }, async () => {
  const manifest = await read(new URL("manifest.xml", dist));
  const hyperodds = /"(https:\/\/(?:[a-z]+\.)?usehyperodds\.com\/[^"]*)"/g;
  const urls = [...manifest.matchAll(hyperodds)].map(([, url]) => url);
  assert.ok(urls.length >= 9);
  for (const url of urls) {
    assert.ok(url.startsWith(BASE), url);
    assert.ok(existsSync(new URL(url.slice(BASE.length), dist)), url);
  }
});

test("the manifest runs everything in one shared runtime under the HYPERODDS namespace", async () => {
  const manifest = await read(new URL("manifest.xml", root));
  assert.match(manifest, /<Set Name="SharedRuntime" MinVersion="1.1" \/>/);
  assert.match(manifest, /<Runtime resid="Taskpane.Url" lifetime="long" \/>/);
  assert.match(manifest, /<Page>\s*<SourceLocation resid="Taskpane.Url" \/>\s*<\/Page>/);
  assert.match(manifest, /<FunctionFile resid="Taskpane.Url" \/>/);
  assert.doesNotMatch(manifest, /<TaskpaneId>/);
  assert.match(manifest, /<Permissions>ReadWriteDocument<\/Permissions>/);
  assert.match(manifest, /<bt:String id="Functions.Namespace" DefaultValue="HYPERODDS" \/>/);
});

test("the page loads office.js from Microsoft's CDN before the functions", async () => {
  const html = await read(new URL("src/index.html", root));
  const office = html.indexOf('src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"');
  assert.ok(office > 0);
  assert.ok(html.indexOf('src="functions.js"') > office);
});
