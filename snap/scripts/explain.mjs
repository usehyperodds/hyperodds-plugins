// Runs the built Snap in MetaMask's Snaps simulator and prints the panel MetaMask would show for a
// Hyperliquid signature request. Build first (npm run build, or npm test). See --help.

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { installSnap } from "@metamask/snaps-simulation";

const DEFAULT_ORIGIN = "https://usehyperodds.com";
const USAGE = `Usage: npm run explain -- <fixture | file.json | list> [options]

  <fixture>         a request from fixtures/payloads.json
  <file.json>       your own request, in any shape a site sends it:
                      typed data {domain, types, primaryType, message}, or that as a JSON string
                      eth_signTypedData_v4 params: [from, typedData]
                      a JSON-RPC request: {method, params: [from, typedData]}
                      {from, data}
  list              every fixture name

Options:
  --from <address>  the signing account (default: the one the request names)
  --origin <site>   the site that asks (default: ${DEFAULT_ORIGIN}); example.com means https://example.com
  --json            print the severity and MetaMask's UI tree instead of the panel
  --help            this text`;

function fail(message) {
  console.error(`explain: ${message}`);
  process.exit(1);
}

const isAddress = (value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);

/** "example.com" → "https://example.com", the way MetaMask reports a site's origin. */
function site(value) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`).origin;
  } catch {
    fail(`--origin isn't a site: "${value}"`);
  }
}

/** The signer and typed data from any shape a site sends to eth_signTypedData_v4. */
function shape(file) {
  if (Array.isArray(file))
    return isAddress(file[0]) ? { from: file[0], data: file[1] } : { from: file[1], data: file[0] };
  if (file && typeof file === "object") {
    if (Array.isArray(file.params)) return shape(file.params);
    if ("data" in file && !("domain" in file)) return { from: file.from, data: file.data };
  }
  return { from: undefined, data: file };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: "string" },
      origin: { type: "string", default: DEFAULT_ORIGIN },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
} catch (error) {
  fail(`${error.message.split(". ")[0]}. See --help.`);
}
const { values, positionals } = args;
const target = positionals[0];
if (values.help || !target) {
  console.log(USAGE);
  process.exit(0);
}
if (values.from !== undefined && !isAddress(values.from))
  fail(`--from must be an address, 0x and 40 hex digits; got "${values.from}"`);
const origin = site(values.origin);

const payloads = JSON.parse(await readFile(join(root, "fixtures/payloads.json"), "utf8"));
if (target === "list") {
  for (const [name, { note }] of Object.entries(payloads)) console.log(`${name.padEnd(30)} ${note}`);
  process.exit(0);
}

let request = Object.hasOwn(payloads, target) ? payloads[target] : null;
if (!request) {
  const raw = await readFile(resolve(target), "utf8").catch(() =>
    fail(`no fixture or file named "${target}". "npm run explain -- list" names the fixtures.`),
  );
  try {
    request = shape(JSON.parse(raw));
  } catch (error) {
    fail(`${target} isn't JSON: ${error.message}`);
  }
}
// Sites usually send the typed data as a JSON string; the simulator takes the object.
if (typeof request.data === "string") {
  try {
    request.data = JSON.parse(request.data);
  } catch {
    fail(`the typed data in ${target} is a string that isn't JSON`);
  }
}
const from = values.from ?? request.from;

const server = createServer(async (req, res) => {
  const path = join(root, new URL(req.url, "http://localhost").pathname);
  try {
    if (!path.startsWith(`${root}/`)) throw new Error("outside the package");
    res.setHeader("content-type", extname(path) === ".json" ? "application/json" : "text/plain");
    res.end(await readFile(path));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const snap = await installSnap(`local:http://localhost:${server.address().port}`);

try {
  const response = await snap
    .onSignature({ from, data: request.data, signatureMethod: "eth_signTypedData_v4", origin })
    // The simulator throws this when the Snap returns null, as it does for anything that isn't Hyperliquid.
    .catch((error) => (String(error).includes("At path: getInterface") ? null : Promise.reject(error)));
  const signer = isAddress(from) ? from : "not given, so every destination counts as another address";
  if (!values.json) console.log(`Request from ${origin}, signed by ${signer}\n`);
  if (!response) {
    if (values.json) console.log(JSON.stringify({ origin, from: from ?? null, panel: null }, null, 2));
    else console.log("No panel. This isn't a Hyperliquid request, so MetaMask shows its usual screen.");
  } else if (response.response.error) {
    throw new Error(`The Snap failed on this request: ${response.response.error.message}`);
  } else {
    const { content } = await response.getInterface();
    const severity = response.response.result.severity ?? null;
    if (values.json) console.log(JSON.stringify({ origin, from: from ?? null, severity, content }, null, 2));
    else print(content, severity);
  }
} finally {
  await snap.executionService.terminateAllSnaps();
  server.close();
}

function text(node) {
  if (node === null || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  if (node.type === "Address") return node.props.address;
  return text(node.props.children);
}

function blocks(node, out = []) {
  if (node === null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) blocks(child, out);
    return out;
  }
  const { type, props } = node;
  if (type === "Banner")
    out.push({ type, severity: props.severity, title: props.title, text: text(props.children) });
  else if (type === "Row") out.push({ type, label: props.label, text: text(props.children) });
  else if (type === "Heading" || type === "Text") out.push({ type, text: text(props.children) });
  else blocks(props.children, out);
  return out;
}

function print(content, severity) {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const LEVEL = { danger: ["HIGH", "41;97"], warning: ["CHECK", "43;30"], info: ["LOW", "44;97"] };
  const all = blocks(content);
  const width = Math.max(...all.filter((b) => b.type === "Row").map((b) => b.label.length)) + 2;
  console.log(paint("2", "Insights from Hyperodds Signature Insights\n"));
  for (const b of all) {
    if (b.type === "Banner") {
      const [word, code] = LEVEL[b.severity];
      console.log(
        `  ${paint(code, ` ${word} `)} ${paint("1", b.title)}\n  ${" ".repeat(word.length + 3)}${b.text}\n`,
      );
    } else if (b.type === "Heading") console.log(`  ${paint("1", b.text)}`);
    else if (b.type === "Text") console.log(`  ${b.text}\n`);
    else console.log(`  ${paint("2", b.label.padEnd(width))}${b.text}`);
  }
  if (severity === "critical") console.log(`\n  ${paint("2", "Marked critical for MetaMask.")}`);
}
