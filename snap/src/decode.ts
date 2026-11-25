import {
  amount,
  balance,
  chain,
  checksum,
  DAY,
  date,
  days,
  escaped,
  integer,
  isAddress,
  label,
  phrase,
  sameAddress,
  skeleton,
  token,
  units,
  words,
} from "./format";
import { L1_AGENT, MULTI_SIG_FIELDS, TOKENS, USER_SIGNED } from "./types";

export const HYPERODDS_BUILDER = "0xd31d379ba70a5b1a0689cfaa748beeeeac9846e9";
export const HYPERODDS_ORIGINS = ["https://usehyperodds.com", "https://www.usehyperodds.com"];

export type Level = "info" | "warning" | "danger";

export type Field = { label: string; address: `0x${string}` } | { label: string; text: string };

export interface Insight {
  title: string;
  body: string;
  level: Level;
  /** The banner: a short verdict and the one reason behind it. */
  verdict: string;
  reason: string;
  fields: Field[];
  network: string | null;
}

export interface Signature {
  from?: unknown;
  data?: unknown;
  signatureMethod?: unknown;
}

type Message = Record<string, unknown>;
type Parts = Omit<Insight, "network">;

interface Context {
  /** The account the funds belong to: the signer, or the multi-sig account a signer approves for. */
  owner: unknown;
  /** Whether the signer approves for a multi-sig account. */
  multi: boolean;
  /** hyperliquidChain as signed: "Mainnet" or "Testnet". */
  chain: unknown;
  /** The site that sent the request, as MetaMask reports it. */
  origin: string | undefined;
  /** The current time, or null where the runtime has no clock. */
  now: number | null;
}

const ZERO = "0x0000000000000000000000000000000000000000";
const EIP712_DOMAIN: [string, string][] = [
  ["name", "string"],
  ["version", "string"],
  ["chainId", "uint256"],
  ["verifyingContract", "address"],
];
// Amounts as Hyperliquid writes them; usdClassTransfer may name a sub-account after the number.
const AMOUNT = /^\d+(\.\d+)?$/;
const CLASS_AMOUNT = /^\d+(\.\d+)?( subaccount:0x[0-9a-fA-F]{40})?$/;
const STAYS = "Stays in this account";

function str(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

/** A request's own property only, never one inherited from Object.prototype. */
function own(object: Message, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

function to(label: string, value: unknown): Field {
  return isAddress(value) ? { label, address: checksum(value) } : { label, text: str(value) };
}

function parse(
  data: unknown,
): { domain: Message; types: Message; primaryType: string; message: Message } | null {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const { domain, types, primaryType, message } = value as Message;
  if (!domain || typeof domain !== "object" || !types || typeof types !== "object") return null;
  if (typeof primaryType !== "string" || !message || typeof message !== "object") return null;
  return { domain: domain as Message, types: types as Message, primaryType, message: message as Message };
}

function declared(types: Message, primaryType: string): [string, string][] | null {
  const list = own(types, primaryType);
  if (!Array.isArray(list)) return null;
  const out: [string, string][] = [];
  for (const f of list) {
    if (!f || typeof f.name !== "string" || typeof f.type !== "string") return null;
    out.push([f.name, f.type]);
  }
  return out;
}

/** Whether a value is the plain JSON form of its EIP-712 type, the form Hyperliquid's own apps send. */
function fits(type: string, value: unknown): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "bool") return typeof value === "boolean";
  if (type === "address") return isAddress(value);
  if (type === "bytes") return typeof value === "string" && /^0x([0-9a-fA-F]{2})*$/.test(value);
  const bytes = /^bytes(\d+)$/.exec(type);
  if (bytes) {
    const size = Number(bytes[1]);
    return (
      size >= 1 &&
      size <= 32 &&
      typeof value === "string" &&
      new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`).test(value)
    );
  }
  const uint = /^uint(\d+)$/.exec(type);
  const bits = uint ? Number(uint[1]) : 0;
  if (bits < 8 || bits > 256 || bits % 8) return false;
  const n =
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
      ? BigInt(value)
      : typeof value === "string" && /^\d+$/.test(value)
        ? BigInt(value)
        : null;
  return n !== null && n < 2n ** BigInt(bits);
}

function same(a: [string, string][], b: [string, string][]): boolean {
  return a.length === b.length && a.every(([n, t], i) => n === b[i]![0] && t === b[i]![1]);
}

function withMultiSig(list: [string, string][]): [string, string][] {
  return [list[0]!, ...MULTI_SIG_FIELDS, ...list.slice(1)];
}

const MISMATCH: Parts = {
  title: "This request doesn't match Hyperliquid's format",
  body: "It carries Hyperliquid's signing name with fields Hyperliquid doesn't use, so Hyperliquid would reject the signature. A site that asks for one may be trying to mislead you.",
  level: "danger",
  verdict: "Unexpected request",
  reason: "Reject it unless you know exactly why this site needs it.",
  fields: [],
};

function unreadable(action: string, field: string, value: unknown): Insight {
  const sent = value === undefined ? "Missing" : JSON.stringify(value);
  return {
    title: "This request can't be read safely",
    body: `Its "${field}" field is written in a form Hyperliquid's own apps don't use, so this Snap can't be sure what you would sign.`,
    level: "danger",
    verdict: "Unexpected request",
    reason: "Reject it unless you know exactly why this site needs it.",
    fields: [
      { label: "Action", text: action },
      { label: "Field", text: field },
      { label: "Value sent", text: sent.length > 80 ? `${sent.slice(0, 79)}…` : sent },
    ],
    network: null,
  };
}

/** The first signed field whose value isn't the plain JSON form of its type. */
function odd(list: [string, string][], message: Message): [string, unknown] | null {
  const bad = list.find(([n, t]) => !fits(t, own(message, n)));
  return bad ? [bad[0], own(message, bad[0])] : null;
}

function moveOut(dest: unknown, ctx: Context, what: string): Pick<Parts, "level" | "verdict" | "reason"> {
  if (sameAddress(dest, ctx.owner))
    return {
      level: "info",
      verdict: "Goes to the same account",
      reason: `The ${what} stays with the account that signs.`,
    };
  return {
    level: "danger",
    verdict: "Sends funds to another address",
    reason: "Check the whole address. Hyperliquid can't reverse a transfer.",
  };
}

// Hyperliquid's format, as its app and the Hyperodds console write it: "<name> valid_until <ms>".
const EXPIRY = /^(.*) valid_until (\d{1,15})$/;
const MAX_EXPIRY = 180 * DAY;

function expiry(raw: string, until: number | null, nonce: number | null, now: number | null): string {
  if (until === null)
    return raw.includes("valid_until") ? "Unclear: not in Hyperliquid's expiry format" : "No expiry set";
  if (nonce !== null && until - nonce > MAX_EXPIRY)
    return `${date(until)} (beyond Hyperliquid's 180-day limit)`;
  if (now !== null) {
    if (until <= now) return `${date(until)} (already passed)`;
    return `${date(until)} (in ${until - now < DAY ? "less than a day" : days(until - now)})`;
  }
  if (nonce === null) return date(until);
  if (until <= nonce) return `${date(until)} (already passed)`;
  return `${date(until)} (${days(until - nonce)} from the request's time)`;
}

function approveAgent(m: Message, ctx: Context): Parts {
  const raw = str(m.agentName);
  const match = EXPIRY.exec(raw);
  const hidden = /[^\x20-\x7e]/.test(raw);
  const name = hidden ? escaped(match ? match[1]! : raw) : match ? match[1]! : raw;
  const until = match ? Number(match[2]) : null;
  const fields: Field[] = [to("API wallet", m.agentAddress)];
  if (name) fields.push({ label: "Name", text: name });
  fields.push({ label: "Expires", text: expiry(raw, until, integer(m.nonce), ctx.now) });
  fields.push({
    label: "Replaces",
    text: name ? `Any API wallet already named "${name}"` : "Your unnamed API wallet, if you have one",
  });
  const copies = skeleton(raw).includes("hyperodds");
  const base = {
    title: "Approve an API wallet",
    body: "The key below can trade for this account, including perps with leverage. It can't withdraw, but its trades can lose this account's funds.",
    fields,
  };
  if (hidden)
    return {
      ...base,
      level: "danger",
      verdict: "Name uses hidden or lookalike characters",
      reason: copies
        ? 'It is made to read as "hyperodds" without being plain text. The Hyperodds console never does this. Reject it.'
        : "Invisible or non-Latin characters can make one name pass for another. Reject it.",
    };
  if (copies && !HYPERODDS_ORIGINS.includes(ctx.origin ?? "")) {
    const site = ctx.origin ? ctx.origin.replace(/^https:\/\//, "") : "an unknown site";
    return {
      ...base,
      level: "danger",
      verdict: "Name copies Hyperodds",
      reason: `The Hyperodds console only asks from usehyperodds.com. This request comes from ${site}. Reject it.`,
    };
  }
  return {
    ...base,
    level: "warning",
    verdict: "Gives a key trading access",
    reason:
      until !== null
        ? "Whoever holds it can trade this account's funds until it expires. Approve keys only from apps you trust."
        : "Whoever holds it can trade this account's funds until you remove or replace it. Approve keys only from apps you trust.",
  };
}

function approveBuilderFee(m: Message): Parts {
  const rate = str(m.maxFeeRate);
  const pct = /^\d+(\.\d+)?%$/.test(rate) ? Number(rate.slice(0, -1)) : Number.NaN;
  const ours = sameAddress(m.builder, HYPERODDS_BUILDER);
  const who = ours ? "Hyperodds" : "The builder below";
  const fields: Field[] = [to("Builder", m.builder)];
  if (ours) fields.push({ label: "Builder name", text: "Hyperodds" });
  fields.push(
    { label: "Most it can charge", text: `${rate} of each order` },
    { label: "Lasts", text: "Until you approve a different rate" },
  );

  const base = { title: `Approve a builder fee of up to ${rate}`, fields };
  const body = `${who} can add a fee of up to ${rate} to orders you place through ${ours ? "its console" : "its app"}. It can't place orders or move funds.`;
  if (Number.isNaN(pct))
    return {
      ...base,
      body,
      level: "warning",
      verdict: "Unreadable fee rate",
      reason: "Hyperliquid expects a rate like 0.05%.",
    };
  if (pct === 0)
    return {
      ...base,
      title: "Set a builder fee to 0%",
      body: `${who} can no longer charge a fee on your orders.`,
      level: "info",
      verdict: "Removes a fee",
      reason: "Orders through this builder then carry no builder fee.",
    };
  if (pct > 1)
    return {
      ...base,
      body,
      level: "warning",
      verdict: "Above Hyperliquid's limit",
      reason: "Builder fees are capped at 1%. Hyperliquid will refuse this rate.",
    };
  if (pct > 0.1)
    return {
      ...base,
      body,
      level: "warning",
      verdict: "Above the perps limit",
      reason: `Perps fees are capped at 0.1%. On spot orders this builder can charge up to ${rate}.`,
    };
  if (pct === 0.1)
    return {
      ...base,
      body,
      level: "warning",
      verdict: "Highest perps fee",
      reason: "0.1% is the most Hyperliquid lets a builder charge on perps orders.",
    };
  return {
    ...base,
    body,
    level: "info",
    verdict: "Fee approval only",
    reason: "It sets a ceiling on one builder's fee.",
  };
}

function usdSend(m: Message, ctx: Context): Parts {
  const value = amount(str(m.amount));
  return {
    title: `Send ${value} USDC`,
    body: `Moves ${value} USDC from this account's perps balance to the address below on Hyperliquid.`,
    ...moveOut(m.destination, ctx, "USDC"),
    fields: [
      to("To", m.destination),
      { label: "Amount", text: `${value} USDC` },
      { label: "Lasts", text: "Once" },
    ],
  };
}

/** The token a request moves, and a red banner when its name and ID belong to different tokens. */
interface Asset {
  /** "1,000 PURR", or the token the ID belongs to when the name lies. */
  quantity: string;
  name: string;
  id: string | null;
  mismatch: Pick<Parts, "level" | "verdict" | "reason"> | null;
}

function asset(m: Message, ctx: Context): Asset {
  const value = amount(str(m.amount));
  const t = token(str(m.token));
  const plain = { quantity: `${value} ${t.name}`, name: t.name, id: t.id, mismatch: null };
  if (!t.id || typeof ctx.chain !== "string" || !Object.hasOwn(TOKENS, ctx.chain)) return plain;
  const known = TOKENS[ctx.chain]!;
  const id = t.id.toLowerCase();
  const actual = Object.keys(known).find((n) => known[n] === id);
  if (actual === t.name || (actual === undefined && !Object.hasOwn(known, t.name))) return plain;
  return {
    quantity: actual ? `${value} ${actual}` : `${value} of an unknown token`,
    name: actual ?? "token",
    id: t.id,
    mismatch: {
      level: "danger",
      verdict: "Token name doesn't match its ID",
      reason: actual
        ? `The request says ${t.name}, but this ID belongs to ${actual}. Reject it.`
        : `The request says ${t.name}, but this isn't the ID of Hyperliquid's ${t.name}. Reject it.`,
    },
  };
}

function amountRows(a: Asset): Field[] {
  const rows: Field[] = [{ label: "Amount", text: a.quantity }];
  if (a.id) rows.push({ label: "Token ID", text: a.id });
  return rows;
}

function spotSend(m: Message, ctx: Context): Parts {
  const a = asset(m, ctx);
  return {
    title: `Send ${a.quantity}`,
    body: `Moves ${a.quantity} from this account's spot balance to the address below on Hyperliquid.`,
    ...moveOut(m.destination, ctx, a.name),
    ...a.mismatch,
    fields: [to("To", m.destination), ...amountRows(a), { label: "Lasts", text: "Once" }],
  };
}

// A multi-sig account's own address on another chain belongs to its original key, not to the signers.
function multiSigAddress(where: string): Pick<Parts, "level" | "reason"> {
  return {
    level: "warning",
    reason: `On ${where} that address is controlled by its own key, not by the multi-sig's signers.`,
  };
}

function withdraw(m: Message, ctx: Context): Parts {
  const value = amount(str(m.amount));
  const own = sameAddress(m.destination, ctx.owner);
  const arbitrum = ctx.chain === "Testnet" ? "Arbitrum Sepolia" : "Arbitrum One";
  const base = {
    title: `Withdraw ${value} USDC to ${arbitrum}`,
    body: `Withdraws ${value} USDC from Hyperliquid to the address below on ${arbitrum}, less Hyperliquid's withdrawal fee.`,
    fields: [
      to("To", m.destination),
      { label: "Amount", text: `${value} USDC` },
      { label: "Lasts", text: "Once" },
    ],
  };
  if (!own)
    return {
      ...base,
      level: "danger",
      verdict: "Withdraws to another address",
      reason: "Check the whole address. A withdrawal can't be reversed.",
    };
  if (ctx.multi)
    return { ...base, ...multiSigAddress(arbitrum), verdict: "Withdraws to the multi-sig address" };
  return {
    ...base,
    level: "info",
    verdict: "Withdraws to the same address",
    reason: `The USDC arrives at the signing address on ${arbitrum}.`,
  };
}

function usdClassTransfer(m: Message): Parts {
  const [raw = "", sub] = str(m.amount).split(" subaccount:");
  const value = amount(raw);
  const toPerp = m.toPerp === true;
  const fields: Field[] = [
    { label: "Amount", text: `${value} USDC` },
    { label: "From", text: toPerp ? "Spot" : "Perps" },
    { label: "To", text: toPerp ? "Perps" : "Spot" },
  ];
  if (sub) fields.push(to("Sub-account", sub));
  fields.push({ label: "Lasts", text: "Once" });
  return {
    title: `Move ${value} USDC from ${toPerp ? "spot to perps" : "perps to spot"}`,
    body: sub
      ? "Moves USDC between the perps and spot balances of the sub-account below. Nothing leaves it."
      : "Moves USDC between this account's own balances. Nothing leaves the account.",
    level: "info",
    verdict: STAYS,
    reason: "Only the balance the USDC sits in changes.",
    fields,
  };
}

function sendAsset(m: Message, ctx: Context): Parts {
  const a = asset(m, ctx);
  const from = balance(str(m.sourceDex));
  const dest = balance(str(m.destinationDex));
  const sub = isAddress(m.fromSubAccount) ? m.fromSubAccount : null;
  const own = sameAddress(m.destination, ctx.owner);
  const fields: Field[] = [];
  if (!own) fields.push(to("To", m.destination));
  if (sub) fields.push(to("From sub-account", sub));
  fields.push(
    ...amountRows(a),
    { label: "From balance", text: balance(str(m.sourceDex), true) },
    { label: "To balance", text: balance(str(m.destinationDex), true) },
    { label: "Lasts", text: "Once" },
  );
  if (!own)
    return {
      title: `Send ${a.quantity}`,
      body: `Moves ${a.quantity} from ${sub ? "the sub-account below" : `this account's ${from} balance`} to the ${dest} balance of the address below.`,
      ...moveOut(m.destination, ctx, a.name),
      ...a.mismatch,
      fields,
    };
  return {
    title: sub ? `Move ${a.quantity} from a sub-account` : `Move ${a.quantity} from ${from} to ${dest}`,
    body: sub
      ? `Moves ${a.quantity} from the sub-account below to this account's ${dest} balance.`
      : "Moves funds between this account's own balances on Hyperliquid.",
    level: "info",
    verdict: STAYS,
    reason: sub
      ? "The funds go from a sub-account to the account that signs."
      : "Only the balance the funds sit in changes.",
    ...a.mismatch,
    fields,
  };
}

function sendToEvmWithData(m: Message, ctx: Context): Parts {
  const a = asset(m, ctx);
  const id = integer(m.destinationChainId);
  const where = id === null ? "another chain" : chain(id);
  const bytes = (str(m.data).length - 2) / 2;
  const gas = integer(m.gasLimit);
  const hex = m.addressEncoding === "hex";
  const own = hex && sameAddress(m.destinationRecipient, ctx.owner) && bytes === 0;
  const verdict = own
    ? ctx.multi
      ? "Sends to the multi-sig address"
      : "Leaves Hyperliquid"
    : bytes
      ? "Sends funds to a contract call"
      : "Sends funds to another address";
  return {
    title: `Send ${a.quantity} to ${where}`,
    body: `Sends ${a.quantity} out of Hyperliquid to the recipient below on ${where}${bytes ? ", with data for a contract to run" : ""}.`,
    level: own ? "warning" : "danger",
    verdict,
    reason: "Sign only if you started this transfer in an app you trust. It can't be reversed.",
    ...(own && ctx.multi ? multiSigAddress(where) : {}),
    ...a.mismatch,
    fields: [
      to("Recipient", m.destinationRecipient),
      ...(hex ? [] : [{ label: "Address format", text: str(m.addressEncoding) }]),
      { label: "Chain", text: id === null ? str(m.destinationChainId) : `${where} (${id})` },
      ...amountRows(a),
      { label: "From balance", text: balance(str(m.sourceDex), true) },
      ...(bytes ? [{ label: "Contract data", text: `${bytes} bytes` }] : []),
      { label: "Gas limit", text: gas === null ? str(m.gasLimit) : amount(String(gas)) },
      { label: "Lasts", text: "Once" },
    ],
  };
}

function tokenDelegate(m: Message): Parts {
  const value = units(m.wei, 8) ?? str(m.wei);
  const undelegate = m.isUndelegate === true;
  return {
    title: `${undelegate ? "Undelegate" : "Delegate"} ${value} HYPE`,
    body: undelegate
      ? `Returns ${value} HYPE from the validator below to your staking balance.`
      : `Stakes ${value} HYPE from your staking balance with the validator below.`,
    level: "info",
    verdict: STAYS,
    reason: "Delegated HYPE remains yours.",
    fields: [
      to("Validator", m.validator),
      { label: "Amount", text: `${value} HYPE` },
      { label: "Lasts", text: undelegate ? "Once" : "Locked with this validator for at least 1 day" },
    ],
  };
}

function staking(m: Message, deposit: boolean): Parts {
  const value = units(m.wei, 8) ?? str(m.wei);
  return {
    title: deposit ? `Move ${value} HYPE into staking` : `Move ${value} HYPE out of staking`,
    body: deposit
      ? `Moves ${value} HYPE from your spot balance to your staking balance.`
      : `Moves ${value} HYPE from your staking balance back to spot, after Hyperliquid's 7-day unstaking queue.`,
    level: "info",
    verdict: STAYS,
    reason: "Only the balance the HYPE sits in changes.",
    fields: [
      { label: "Amount", text: `${value} HYPE` },
      { label: "Lasts", text: deposit ? "Once" : "Arrives after 7 days" },
    ],
  };
}

function convertToMultiSig(m: Message): Parts {
  const raw = str(m.signers);
  let signers: unknown;
  try {
    signers = JSON.parse(raw);
  } catch {
    return { ...MISMATCH, fields: [{ label: "Signers", text: raw }] };
  }
  if (signers === null)
    return {
      title: "Turn a multi-sig back into a normal account",
      body: "After this, the account no longer needs its signers' approvals.",
      level: "warning",
      verdict: "Changes who controls the account",
      reason: "Make sure every signer agreed to this.",
      fields: [{ label: "Lasts", text: "Until the account is converted again" }],
    };
  const { authorizedUsers: users, threshold } = (typeof signers === "object" ? signers : {}) as Message;
  const valid = typeof threshold === "number" && Number.isSafeInteger(threshold) && threshold >= 1;
  if (!valid || !Array.isArray(users) || !users.every(isAddress))
    return { ...MISMATCH, fields: [{ label: "Signers", text: raw }] };
  return {
    title: `Turn this account into a ${threshold}-of-${users.length} multi-sig`,
    body: `After this, actions on this account need signatures from ${threshold} of the ${users.length} signers below. This wallet alone can no longer act for it.`,
    level: "danger",
    verdict: "Hands control to a group of signers",
    reason: "If you don't control enough of these signers, you lose access to the account.",
    fields: [
      ...users.map((u, i) => to(`Signer ${i + 1}`, u)),
      { label: "Signatures needed", text: `${threshold} of ${users.length}` },
      { label: "Lasts", text: "Until the signers convert it back" },
    ],
  };
}

function sendMultiSig(m: Message): Parts {
  return {
    title: "Submit a multi-sig action",
    body: "Submits an action that the multi-sig account's signers approved. Its details are hashed, so no wallet can show them here.",
    level: "warning",
    verdict: "Details can't be shown",
    reason: "Check the action in the app that collected the signatures.",
    fields: [
      { label: "Action hash", text: str(m.multiSigActionHash) },
      { label: "Lasts", text: "Once" },
    ],
  };
}

function account(m: Message, ctx: Context): Field[] {
  return sameAddress(m.user, ctx.owner) ? [] : [to("Account", m.user)];
}

function dexAbstraction(m: Message, ctx: Context): Parts {
  const on = m.enabled === true;
  return {
    title: `Turn ${on ? "on" : "off"} HIP-3 DEX abstraction`,
    body: "Changes how this account's collateral is used on HIP-3 perp DEXs. It moves no funds out of the account.",
    level: "info",
    verdict: "Account setting",
    reason: "You can change it back.",
    fields: [...account(m, ctx), { label: "Lasts", text: "Until you change it" }],
  };
}

const MODES: Record<string, string> = {
  unifiedAccount: "unified account",
  portfolioMargin: "portfolio margin",
  disabled: "standard",
};

function marginMode(title: string, m: Message, ctx: Context): Parts {
  return {
    title,
    body: "Changes how margin is shared across this account's balances and positions. It moves no funds out of the account.",
    level: "warning",
    verdict: "Margin works differently",
    reason: "Liquidation levels of open positions can change. Read Hyperliquid's guide to this mode first.",
    fields: [...account(m, ctx), { label: "Lasts", text: "Until you change it" }],
  };
}

function linkStakingUser(m: Message): Parts {
  if (m.isFinalize === true)
    return {
      title: "Link a trading account to this staking account",
      body: "Confirms a permanent link with the trading account below. Its trades then get this account's staking fee discount, and this account stops getting one.",
      level: "warning",
      verdict: "Can't be undone",
      reason: "Hyperliquid has no way to unlink. Link only accounts you control.",
      fields: [to("Trading account", m.user), { label: "Lasts", text: "Permanent" }],
    };
  return {
    title: "Ask to link this account to a staking account",
    body: "Starts a permanent link with the staking account below, for its staking fee discount. That account has to confirm it.",
    level: "danger",
    verdict: "Gives another account control of your funds",
    reason:
      "Once that account confirms, it can lock this account and take all of its funds. Link only to an account you control.",
    fields: [to("Staking account", m.user), { label: "Lasts", text: "Permanent once both sides sign" }],
  };
}

function disableTradingUser(m: Message): Parts {
  return {
    title: "Lock a linked trading account and receive its funds in a year",
    body: "You sign as the staking account. The trading account below can no longer trade or move its funds, and after one year all of them move to this staking account.",
    level: "danger",
    verdict: "Can't be undone",
    reason: "Sign only if you control both accounts and mean to shut the trading account down for good.",
    fields: [
      to("Trading account", m.tradingUser),
      { label: "Its funds go to", text: "This staking account, after one year" },
      { label: "Lasts", text: "Permanent" },
    ],
  };
}

const HANDLERS: Record<string, (m: Message, ctx: Context) => Parts> = {
  ApproveAgent: approveAgent,
  ApproveBuilderFee: approveBuilderFee,
  UsdSend: usdSend,
  SpotSend: spotSend,
  Withdraw: withdraw,
  UsdClassTransfer: usdClassTransfer,
  SendAsset: sendAsset,
  SendToEvmWithData: sendToEvmWithData,
  TokenDelegate: tokenDelegate,
  CDeposit: (m) => staking(m, true),
  CWithdraw: (m) => staking(m, false),
  ConvertToMultiSigUser: convertToMultiSig,
  SendMultiSig: sendMultiSig,
  UserDexAbstraction: dexAbstraction,
  UserSetAbstraction: (m, ctx) =>
    marginMode(`Switch to ${own(MODES, str(m.abstraction)) ?? `"${str(m.abstraction)}"`} mode`, m, ctx),
  UserPortfolioMargin: (m, ctx) =>
    marginMode(`Turn ${m.enabled === true ? "on" : "off"} portfolio margin`, m, ctx),
  LinkStakingUser: linkStakingUser,
  StakingLinkDisableTradingUser: disableTradingUser,
};

// Field names that suggest money or a counterparty, read as words: "destinationRecipient", "toUser".
const FUNDS = /\b(destination|recipient|amount|wei|user)\b/;

function unknown(name: string, list: [string, string][], m: Message): Parts {
  const shown = list.filter(([n]) => n !== "hyperliquidChain");
  const funds = shown.some(([n, t]) => t === "address" || FUNDS.test(words(n)));
  return {
    title: `Hyperliquid action: ${phrase(name)}`,
    body: "This Snap doesn't know this action yet. Check each field below before you sign.",
    level: funds ? "danger" : "warning",
    verdict: "Unknown action",
    reason: funds
      ? "It names an amount or an account, so it may move funds. Sign only if you started it in an app you trust."
      : "Sign only if you started it in an app you trust.",
    fields: shown.map(([n]) => to(label(n), m[n])),
  };
}

function network(value: unknown): string | null {
  if (value === "Mainnet") return "Hyperliquid";
  if (value === "Testnet") return "Hyperliquid testnet";
  return value === undefined ? null : str(value);
}

function userSigned(
  domain: Message,
  types: Message,
  primaryType: string,
  message: Message,
  from: unknown,
  origin: string | undefined,
  now: number | null,
): Insight {
  const name = primaryType.startsWith("HyperliquidTransaction:") ? primaryType.slice(23) : null;
  const list = declared(types, primaryType);
  const domainOk =
    domain.version === "1" && sameAddress(domain.verifyingContract, ZERO) && hasDomainType(types);
  if (!name || !list || !domainOk) return { ...MISMATCH, network: null };

  const signed: Message = Object.fromEntries(list.map(([n]) => [n, own(message, n)]));
  const bad = odd(list, signed);
  if (bad) return unreadable(label(name), ...bad);
  const env = signed.hyperliquidChain;
  if (env !== "Mainnet" && env !== "Testnet") return unreadable(label(name), "hyperliquidChain", env);
  const net = network(signed.hyperliquidChain);
  if (!Object.hasOwn(USER_SIGNED, name)) return { ...unknown(name, list, signed), network: net };
  const canonical = USER_SIGNED[name]!;

  const multi = same(list, withMultiSig(canonical));
  if (!multi && !same(list, canonical)) return { ...MISMATCH, network: net };
  const amountForm = name === "UsdClassTransfer" ? CLASS_AMOUNT : AMOUNT;
  if (Object.hasOwn(signed, "amount") && !amountForm.test(str(signed.amount)))
    return unreadable(label(name), "amount", signed.amount);

  const ctx = {
    owner: multi ? signed.payloadMultiSigUser : from,
    multi,
    chain: signed.hyperliquidChain,
    origin,
    now,
  };
  const parts = HANDLERS[name]!(signed, ctx);
  if (!multi) return { ...parts, network: net };
  return {
    ...parts,
    title: `Multi-sig: ${parts.title}`,
    body: `You sign as one signer of the multi-sig account below. ${parts.body.replaceAll("this account", "the multi-sig account")}`,
    fields: [
      to("Multi-sig account", signed.payloadMultiSigUser),
      to("Submitted by", signed.outerSigner),
      ...parts.fields,
    ],
    network: net,
  };
}

/** Whether types declares Hyperliquid's EIP712Domain; without it the wallet signs another domain. */
function hasDomainType(types: Message): boolean {
  const list = declared(types, "EIP712Domain");
  return list !== null && same(list, EIP712_DOMAIN);
}

/** A domain chainId as MetaMask accepts it: a number, or a decimal or hex string. */
function chainId(value: unknown): number | null {
  if (typeof value === "number") return value;
  return typeof value === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(value) ? Number(value) : null;
}

function l1(domain: Message, types: Message, message: Message): Insight | null {
  const hyperliquid =
    domain.version === "1" && chainId(domain.chainId) === 1337 && sameAddress(domain.verifyingContract, ZERO);
  if (!hyperliquid) return null;
  const list = declared(types, "Agent");
  if (!list || !same(list, L1_AGENT) || !hasDomainType(types)) return { ...MISMATCH, network: null };
  const bad = odd(list, message);
  if (bad) return unreadable("Trading action (Agent)", ...bad);
  const source = message.source;
  return {
    title: "Sign a Hyperliquid trading action",
    body: "This signs one trading action, such as an order or a cancel. Hyperliquid hashes its details, so no wallet can show what it does.",
    level: "danger",
    verdict: "Details can't be shown",
    reason:
      "Trading apps usually sign these with an API wallet. If a site asks your main wallet, be sure you started this action.",
    fields: [
      { label: "Action hash", text: str(message.connectionId) },
      { label: "Lasts", text: "Once" },
    ],
    network: source === "a" ? "Hyperliquid" : source === "b" ? "Hyperliquid testnet" : str(source),
  };
}

/**
 * What a Hyperliquid signature request allows, or null for anything that isn't one. `now` defaults
 * to the runtime's clock; a locked-down runtime without one gives NaN, and expiries are then
 * counted from the request's own time.
 */
export function decode(signature: Signature, origin?: string, now = Date.now()): Insight | null {
  const method = signature.signatureMethod;
  if (method !== "eth_signTypedData_v4" && method !== "eth_signTypedData_v3") return null;
  const parsed = parse(signature.data);
  if (!parsed) return null;
  const { domain, types, primaryType, message } = parsed;
  if (domain.name === "HyperliquidSignTransaction")
    return userSigned(
      domain,
      types,
      primaryType,
      message,
      signature.from,
      origin,
      Number.isFinite(now) ? now : null,
    );
  if (domain.name === "Exchange" && primaryType === "Agent") return l1(domain, types, message);
  return null;
}
