import { keccak_256 } from "@noble/hashes/sha3";

const DECIMAL = /^\d+(\.\d+)?$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAY = 86_400_000;

/** "1250.50" → "1,250.5". Anything that isn't a plain decimal comes back as it was signed. */
export function amount(value: string): string {
  if (!DECIMAL.test(value)) return value;
  const [int, frac = ""] = value.split(".");
  const grouped = int!.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

/** Integer units with `decimals` places, e.g. HYPE wei (8) → "50". */
export function units(value: unknown, decimals: number): string | null {
  const raw = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^\d+$/.test(raw)) return null;
  const padded = raw.padStart(decimals + 1, "0");
  return amount(`${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`);
}

export function integer(value: unknown): number | null {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** "18 May 2027, 12:00 UTC" */
export function date(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function days(ms: number): string {
  const n = Math.round(ms / DAY);
  return n === 1 ? "1 day" : `${n} days`;
}

export function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/** EIP-55 mixed-case checksum, the way wallets and explorers write an address. */
export function checksum(address: `0x${string}`): `0x${string}` {
  const hex = address.slice(2).toLowerCase();
  const hash = keccak_256(Uint8Array.from(hex, (c) => c.charCodeAt(0)));
  const out = [...hex].map((c, i) => (((hash[i >> 1]! >> (i % 2 ? 0 : 4)) & 0xf) >= 8 ? c.toUpperCase() : c));
  return `0x${out.join("")}`;
}

export function sameAddress(a: unknown, b: unknown): boolean {
  return isAddress(a) && isAddress(b) && a.toLowerCase() === b.toLowerCase();
}

/** "PURR:0xc1fb…" → { name: "PURR", id: "0xc1fb…" } */
export function token(value: string): { name: string; id: string | null } {
  const i = value.indexOf(":");
  return i < 0 ? { name: value, id: null } : { name: value.slice(0, i), id: value.slice(i + 1) };
}

/**
 * Hyperliquid's balance names: "" is the main perps balance, "spot" is spot, anything else a HIP-3
 * DEX. In a sentence "perps" or "xyz perps"; as a row value "Perps" or "Perps on xyz".
 */
export function balance(dex: string, row = false): string {
  if (dex === "") return row ? "Perps" : "perps";
  if (dex === "spot") return row ? "Spot" : "spot";
  return row ? `Perps on ${dex}` : `${dex} perps`;
}

const CHAINS: Record<number, string> = {
  1: "Ethereum",
  999: "HyperEVM",
  998: "HyperEVM testnet",
  8453: "Base",
  42161: "Arbitrum One",
};

export function chain(id: number): string {
  return Object.hasOwn(CHAINS, id) ? CHAINS[id]! : `chain ${id}`;
}

/** "SendToEvmWithData" → "send to evm with data" */
export function words(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

const ACRONYMS: Record<string, string> = {
  api: "API",
  dex: "DEX",
  evm: "EVM",
  hip: "HIP",
  hype: "HYPE",
  id: "ID",
  usd: "USD",
  usdc: "USDC",
};

/** "sendToEvmWithData" → "send to EVM with data" */
export function phrase(name: string): string {
  return words(name)
    .split(" ")
    .map((w) => (Object.hasOwn(ACRONYMS, w) ? ACRONYMS[w]! : w))
    .join(" ");
}

/** "destinationChainId" → "Destination chain ID" */
export function label(name: string): string {
  const p = phrase(name);
  return p.charAt(0).toUpperCase() + p.slice(1);
}

// Greek and Cyrillic letters that render like Latin ones.
const LOOKALIKES: Record<string, string> = Object.fromEntries(
  [
    ["a", "аα"],
    ["b", "Ьβ"],
    ["c", "сϲ"],
    ["d", "ԁ"],
    ["e", "еε"],
    ["h", "һհ"],
    ["i", "іι"],
    ["j", "ј"],
    ["k", "κк"],
    ["l", "ӏ"],
    ["n", "ո"],
    ["o", "оοσ"],
    ["p", "рρ"],
    ["q", "ԛ"],
    ["r", "г"],
    ["s", "ѕ"],
    ["t", "т"],
    ["u", "υ"],
    ["v", "ν"],
    ["w", "ԝω"],
    ["x", "хχ"],
    ["y", "уγ"],
  ].flatMap(([latin, others]) => [...others!].map((c) => [c, latin!])),
);

/**
 * How a name reads on screen: compatibility forms folded (NFKC), accents, invisible and format
 * characters dropped, Greek and Cyrillic lookalikes turned into Latin, lower case.
 */
export function skeleton(text: string): string {
  return [
    ...text
      .normalize("NFKC")
      .normalize("NFD")
      .toLowerCase()
      .replace(/[\p{M}\p{Cf}]/gu, ""),
  ]
    .map((c) => LOOKALIKES[c] ?? c)
    .join("");
}

/** Every character outside printable ASCII written as [U+XXXX], so hidden ones show. */
export function escaped(text: string): string {
  return [...text]
    .map((c) =>
      /[\x20-\x7e]/.test(c) ? c : `[U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}]`,
    )
    .join("");
}
