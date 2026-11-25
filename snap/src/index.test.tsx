import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { installSnap } from "@metamask/snaps-jest";
import consoleJson from "../fixtures/console.json";
import payloads from "../fixtures/payloads.json";
import { decode, type Level } from "./decode";
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
  label,
  skeleton,
  token,
  units,
} from "./format";

type Fixture = { from: `0x${string}`; data: Record<string, unknown> };
type Node = { type: string; props: Record<string, unknown> } | string | boolean | null | Node[];
type Snap = Awaited<ReturnType<typeof installSnap>>;

const fixtures = payloads as unknown as Record<string, Fixture>;
const consoleRequests = consoleJson as unknown as Record<string, Fixture>;
const SIGNER = "0x3DE927fcC729450313c8ac20162B28f61A2A4D96";
const OTHER = "0x9c5781c5353bD5E17eB883F3E78634d4D9c092b0";
const SUB_ACCOUNT = "0xcDAA19b1acd399049F4184267CA5a29C932fC28D";
const MULTI_SIG = "0xcB1983119D23f962e40DA3e119Ea322cD826470f";
const ORIGIN = "https://usehyperodds.com";
const EIP712_DOMAIN = (payloads.usdSend.data.types as Record<string, unknown>).EIP712Domain;

// The days left on an expiry depend on today's date, so lines() writes "(time left)" instead.
const LEFT = /\((in \d+ days?|in less than a day|already passed)\)/;

/** The panel as text, one line per block, so a test reads like the screen. */
function lines(node: Node): string[] {
  if (node === null || typeof node === "boolean") return [];
  if (typeof node === "string") return [node.replace(LEFT, "(time left)")];
  if (Array.isArray(node)) return node.flatMap(lines);
  const { type, props } = node;
  const inner = () => lines(props.children as Node).join(" ");
  switch (type) {
    case "Banner":
      return [`[${props.severity}] ${props.title}: ${inner()}`];
    case "Heading":
      return [`# ${inner()}`];
    case "Row":
      return [`${props.label}: ${inner()}`];
    case "Address":
      return [String(props.address)];
    case "Text":
      return [inner()];
    default:
      return lines(props.children as Node);
  }
}

function props(node: Node, type: string): Record<string, unknown>[] {
  if (node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((n) => props(n, type));
  const own = node.type === type ? [node.props] : [];
  return [...own, ...props(node.props.children as Node, type)];
}

async function show(snap: Snap, fixture: Fixture, { method = "eth_signTypedData_v4", origin = ORIGIN } = {}) {
  const response = await snap.onSignature({
    from: fixture.from,
    data: structuredClone(fixture.data),
    signatureMethod: method as "eth_signTypedData_v4",
    origin,
  });
  const ui = await response.getInterface();
  const { result } = response.response as { result: { severity?: string } };
  return { severity: result.severity, content: ui.content as Node, text: lines(ui.content as Node) };
}

const snapDir = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(snapDir, path), "utf8");

const scratch = mkdtempSync(join(tmpdir(), "explain-test-"));
const typedData = (payloads as Record<string, { data: unknown }>).usdSend!.data;

function file(name: string, content: unknown): string {
  const path = join(scratch, name);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

function explain(...args: string[]) {
  const run = spawnSync(process.execPath, ["scripts/explain.mjs", ...args], {
    cwd: snapDir,
    encoding: "utf8",
  });
  return { code: run.status, out: run.stdout, err: run.stderr.trim() };
}

// [fixture, level, heading, lines the panel must show]
const CASES: [string, Level, string, string[]][] = [
  [
    "approveAgentConsole",
    "warning",
    "Approve an API wallet",
    [
      "[warning] Gives a key trading access: Whoever holds it can trade this account's funds until it expires. Approve keys only from apps you trust.",
      "The key below can trade for this account, including perps with leverage. It can't withdraw, but its trades can lose this account's funds.",
      "API wallet: 0x8465414CEDb577d816de94634c26404778d6Dd35",
      "Name: hyperodds",
      "Expires: 18 May 2027, 12:00 UTC (time left)",
      'Replaces: Any API wallet already named "hyperodds"',
    ],
  ],
  [
    "approveAgentUnnamed",
    "warning",
    "Approve an API wallet",
    ["Expires: No expiry set", "Replaces: Your unnamed API wallet, if you have one"],
  ],
  ["approveAgentNamed", "warning", "Approve an API wallet", ["Name: bot", "Expires: No expiry set"]],
  [
    "approveAgentSpoofedName",
    "warning",
    "Approve an API wallet",
    [
      "[warning] Gives a key trading access:",
      "Name: HyperOdds",
      'Replaces: Any API wallet already named "HyperOdds"',
    ],
  ],
  [
    "approveBuilderFeeHyperodds",
    "warning",
    "Approve a builder fee of up to 0.1%",
    [
      "[warning] Highest perps fee: 0.1% is the most Hyperliquid lets a builder charge on perps orders.",
      "Hyperodds can add a fee of up to 0.1% to orders you place through its console. It can't place orders or move funds.",
      "Builder: 0xd31d379Ba70A5B1a0689cfAA748bEEEEAc9846e9",
      "Builder name: Hyperodds",
      "Most it can charge: 0.1% of each order",
    ],
  ],
  [
    "approveBuilderFeeLow",
    "info",
    "Approve a builder fee of up to 0.001%",
    [
      "[info] Fee approval only: It sets a ceiling on one builder's fee.",
      "Lasts: Until you approve a different rate",
    ],
  ],
  [
    "approveBuilderFeeSpotCap",
    "warning",
    "Approve a builder fee of up to 1%",
    [
      "[warning] Above the perps limit: Perps fees are capped at 0.1%. On spot orders this builder can charge up to 1%.",
    ],
  ],
  [
    "approveBuilderFeeAboveCap",
    "warning",
    "Approve a builder fee of up to 2%",
    [
      "[warning] Above Hyperliquid's limit: Builder fees are capped at 1%. Hyperliquid will refuse this rate.",
    ],
  ],
  [
    "approveBuilderFeeZero",
    "info",
    "Set a builder fee to 0%",
    ["[info] Removes a fee: Orders through this builder then carry no builder fee."],
  ],
  [
    "usdSend",
    "danger",
    "Send 250.5 USDC",
    [
      "[danger] Sends funds to another address: Check the whole address. Hyperliquid can't reverse a transfer.",
      `To: ${OTHER}`,
      "Amount: 250.5 USDC",
      "Lasts: Once",
    ],
  ],
  [
    "usdSendSelf",
    "info",
    "Send 5 USDC",
    ["[info] Goes to the same account: The USDC stays with the account that signs."],
  ],
  [
    "spotSend",
    "danger",
    "Send 1,000 PURR",
    [`To: ${OTHER}`, "Amount: 1,000 PURR", "Token ID: 0xc1fb593aeffbeb02f85e0308e9956a90"],
  ],
  [
    "withdraw",
    "danger",
    "Withdraw 1,200 USDC to Arbitrum One",
    [
      "[danger] Withdraws to another address: Check the whole address. A withdrawal can't be reversed.",
      `To: ${OTHER}`,
    ],
  ],
  [
    "withdrawSelf",
    "info",
    "Withdraw 40 USDC to Arbitrum Sepolia",
    [
      "[info] Withdraws to the same address: The USDC arrives at the signing address on Arbitrum Sepolia.",
      "Withdraws 40 USDC from Hyperliquid to the address below on Arbitrum Sepolia, less Hyperliquid's withdrawal fee.",
      "Network: Hyperliquid testnet",
    ],
  ],
  [
    "usdClassTransferConsole",
    "info",
    "Move 25 USDC from perps to spot",
    ["[info] Stays in this account: Only the balance the USDC sits in changes.", "From: Perps", "To: Spot"],
  ],
  [
    "usdClassTransferSubAccount",
    "info",
    "Move 10 USDC from spot to perps",
    [`Sub-account: ${SUB_ACCOUNT}`, "From: Spot", "To: Perps"],
  ],
  [
    "sendAssetOwnDexes",
    "info",
    "Move 30 USDC from perps to spot",
    [
      "From balance: Perps",
      "To balance: Spot",
      "Moves funds between this account's own balances on Hyperliquid.",
    ],
  ],
  [
    "sendAssetOther",
    "danger",
    "Send 12.5 HYPE",
    [
      `To: ${OTHER}`,
      "From balance: Spot",
      "Amount: 12.5 HYPE",
      "Token ID: 0x0d01dc56dcaaca66ad901c959b4011ec",
    ],
  ],
  [
    "sendAssetFromSubAccount",
    "info",
    "Move 100 USDC from a sub-account",
    [
      `From sub-account: ${SUB_ACCOUNT}`,
      "To balance: Perps on xyz",
      "Moves 100 USDC from the sub-account below to this account's xyz perps balance.",
    ],
  ],
  [
    "sendToEvmWithData",
    "danger",
    "Send 1 USDC to Arbitrum One",
    [
      "[danger] Sends funds to a contract call: Sign only if you started this transfer in an app you trust. It can't be reversed.",
      "Chain: Arbitrum One (42161)",
      "From balance: Spot",
      "Contract data: 4 bytes",
      "Gas limit: 200,000",
    ],
  ],
  [
    "sendToEvmWithDataSelf",
    "warning",
    "Send 1 USDC to Arbitrum One",
    [
      "[warning] Leaves Hyperliquid: Sign only if you started this transfer in an app you trust. It can't be reversed.",
      `Recipient: ${SIGNER}`,
      "From balance: Spot",
    ],
  ],
  [
    "tokenDelegate",
    "info",
    "Delegate 50 HYPE",
    [
      "Validator: 0x358b66F044C8Ed6C8b06Da939Be6467fa0140f4b",
      "Amount: 50 HYPE",
      "Lasts: Locked with this validator for at least 1 day",
    ],
  ],
  ["tokenUndelegate", "info", "Undelegate 0.5 HYPE", ["Amount: 0.5 HYPE", "Lasts: Once"]],
  ["cDeposit", "info", "Move 75 HYPE into staking", ["Amount: 75 HYPE"]],
  ["cWithdraw", "info", "Move 20 HYPE out of staking", ["Lasts: Arrives after 7 days"]],
  [
    "convertToMultiSigUser",
    "danger",
    "Turn this account into a 2-of-2 multi-sig",
    [
      "[danger] Hands control to a group of signers: If you don't control enough of these signers, you lose access to the account.",
      "Signer 1: 0x11A9B34b79c02a19ce3A7AFC1d69660B6EE3Ee1E",
      `Signer 2: ${SIGNER}`,
      "Signatures needed: 2 of 2",
    ],
  ],
  [
    "convertToMultiSigUserRevert",
    "warning",
    "Turn a multi-sig back into a normal account",
    [
      "[warning] Changes who controls the account: Make sure every signer agreed to this.",
      "Lasts: Until the account is converted again",
    ],
  ],
  [
    "userDexAbstraction",
    "info",
    "Turn on HIP-3 DEX abstraction",
    ["[info] Account setting: You can change it back.", "Lasts: Until you change it"],
  ],
  [
    "userSetAbstraction",
    "warning",
    "Switch to portfolio margin mode",
    [
      "[warning] Margin works differently: Liquidation levels of open positions can change. Read Hyperliquid's guide to this mode first.",
    ],
  ],
  ["userSetAbstractionUnified", "warning", "Switch to unified account mode", ["Lasts: Until you change it"]],
  ["userSetAbstractionDisabled", "warning", "Switch to standard mode", ["Lasts: Until you change it"]],
  ["userPortfolioMargin", "warning", "Turn on portfolio margin", ["Lasts: Until you change it"]],
  [
    "linkStakingUser",
    "warning",
    "Link a trading account to this staking account",
    [
      "[warning] Can't be undone: Hyperliquid has no way to unlink. Link only accounts you control.",
      "Confirms a permanent link with the trading account below. Its trades then get this account's staking fee discount, and this account stops getting one.",
      `Trading account: ${OTHER}`,
      "Lasts: Permanent",
    ],
  ],
  [
    "linkStakingUserInitiate",
    "danger",
    "Ask to link this account to a staking account",
    [
      "[danger] Gives another account control of your funds: Once that account confirms, it can lock this account and take all of its funds. Link only to an account you control.",
      `Staking account: ${OTHER}`,
      "Lasts: Permanent once both sides sign",
    ],
  ],
  [
    "stakingLinkDisableTradingUser",
    "danger",
    "Lock a linked trading account and receive its funds in a year",
    [
      "[danger] Can't be undone: Sign only if you control both accounts and mean to shut the trading account down for good.",
      "You sign as the staking account. The trading account below can no longer trade or move its funds, and after one year all of them move to this staking account.",
      `Trading account: ${OTHER}`,
      "Its funds go to: This staking account, after one year",
      "Lasts: Permanent",
    ],
  ],
  [
    "multiSigSendAsset",
    "danger",
    "Multi-sig: Send 100 USDC",
    [`Multi-sig account: ${MULTI_SIG}`, `Submitted by: ${SIGNER}`, `To: ${OTHER}`],
  ],
  [
    "multiSigWithdraw",
    "warning",
    "Multi-sig: Withdraw 10 USDC to Arbitrum One",
    [
      "[warning] Withdraws to the multi-sig address: On Arbitrum One that address is controlled by its own key, not by the multi-sig's signers.",
      `Multi-sig account: ${MULTI_SIG}`,
      `To: ${MULTI_SIG}`,
    ],
  ],
  [
    "multiSigSendToEvmWithData",
    "warning",
    "Multi-sig: Send 1 USDC to Arbitrum One",
    [
      "[warning] Sends to the multi-sig address: On Arbitrum One that address is controlled by its own key, not by the multi-sig's signers.",
      `Recipient: ${MULTI_SIG}`,
      "From balance: Spot",
    ],
  ],
  [
    "sendMultiSig",
    "warning",
    "Submit a multi-sig action",
    [
      "[warning] Details can't be shown: Check the action in the app that collected the signatures.",
      "Action hash: 0x20bc628e257065c22787a6d11422d36fbc81143772b9ce68b86e1b963fb61dcb",
    ],
  ],
  [
    "l1Order",
    "danger",
    "Sign a Hyperliquid trading action",
    [
      "[danger] Details can't be shown: Trading apps usually sign these with an API wallet. If a site asks your main wallet, be sure you started this action.",
      "Action hash: 0xa4ca4d97753df7ba9f50f8e2bd48251e94e436fb60f79349a832d69908b11c6a",
      "Network: Hyperliquid",
    ],
  ],
  [
    "l1Testnet",
    "danger",
    "Sign a Hyperliquid trading action",
    [
      "Action hash: 0x5d165c6ff08854973dc369baa14a5359c0d399b0ecb9b1654e30989888e1c749",
      "Network: Hyperliquid testnet",
    ],
  ],
];

describe("onSignature", () => {
  let snap: Snap;
  beforeAll(async () => {
    snap = await installSnap();
  });

  it("covers every fixture", () => {
    expect(CASES.map(([name]) => name).sort()).toEqual(Object.keys(fixtures).sort());
  });

  it.each(CASES)("%s", async (name, level, heading, expected) => {
    const { severity, text } = await show(snap, fixtures[name]!);
    expect(severity).toBe(level === "danger" ? "critical" : undefined);
    expect(text[0]).toMatch(new RegExp(`^\\[${level}\\] `));
    expect(text[1]).toBe(`# ${heading}`);
    for (const line of expected) expect(text.some((t) => t.startsWith(line))).toBe(true);
    expect(text).toMatchSnapshot();
  });

  it("names Hyperodds only for its own builder address", async () => {
    for (const [name, fixture] of Object.entries(fixtures)) {
      // The Name and Replaces rows repeat the API wallet name the request carries.
      const text = (await show(snap, fixture)).text.filter((t) => !/^(Name|Replaces): /.test(t));
      expect(/hyperodds/i.test(text.join("\n"))).toBe(name === "approveBuilderFeeHyperodds");
    }
  });

  it("names Hyperodds for its builder address in any letter case, and not for a lookalike", async () => {
    const named = async (builder: string) => {
      const data = structuredClone(fixtures.approveBuilderFeeHyperodds!.data) as {
        message: Record<string, unknown>;
      };
      data.message.builder = builder;
      return (await show(snap, { from: SIGNER, data })).text.includes("Builder name: Hyperodds");
    };
    expect(await named("0xD31D379BA70A5B1A0689CFAA748BEEEEAC9846E9")).toBe(true);
    expect(await named("0xd31d379ba70a5b1a0689cfaa748beeeeac9846e9")).toBe(true);
    expect(await named("0xd31d000000000000000000000000000000c846e9")).toBe(false);
  });

  it("flags an API wallet named after Hyperodds from any other site", async () => {
    const sites = [
      "https://usehyperodds.co",
      "http://usehyperodds.com",
      "https://app.usehyperodds.com",
      "https://usehyperodds.com.example.org",
      "https://www.usehyperodds.com.example.org",
      "http://www.usehyperodds.com",
      "https://example.com",
    ];
    for (const name of ["approveAgentConsole", "approveAgentSpoofedName"]) {
      expect((await show(snap, fixtures[name]!)).severity).toBeUndefined();
      expect(
        (await show(snap, fixtures[name]!, { origin: "https://www.usehyperodds.com" })).severity,
      ).toBeUndefined();
      for (const origin of sites) {
        const { severity, text } = await show(snap, fixtures[name]!, { origin });
        expect(severity).toBe("critical");
        expect(text[0]).toBe(
          `[danger] Name copies Hyperodds: The Hyperodds console only asks from usehyperodds.com. This request comes from ${origin.replace("https://", "")}. Reject it.`,
        );
      }
    }
  });

  it("leaves other API wallet names at Check on any site", async () => {
    const { severity, text } = await show(snap, fixtures.approveAgentNamed!, {
      origin: "https://example.com",
    });
    expect(severity).toBeUndefined();
    expect(text[0]).toMatch(/^\[warning\] Gives a key trading access: /);
  });

  it("leaves out empty rows and writes balances one way", async () => {
    for (const fixture of Object.values(fixtures)) {
      const { text } = await show(snap, fixture);
      expect(text.filter((t) => /: None$/.test(t) || /balance: [a-z]/.test(t))).toEqual([]);
    }
  });

  it("writes every address with its checksum", async () => {
    const { text } = await show(snap, fixtures.multiSigWithdraw!);
    expect(text.filter((t) => /0x[0-9a-fA-F]{40}/.test(t))).toEqual([
      `Multi-sig account: ${MULTI_SIG}`,
      `Submitted by: ${SIGNER}`,
      `To: ${MULTI_SIG}`,
    ]);
  });

  it("shows every address in full", async () => {
    const { content } = await show(snap, fixtures.usdSend!);
    expect(props(content, "Address")).toEqual([{ address: OTHER, displayName: true, truncate: false }]);
  });

  it("reads the console's own requests as wagmi sends them", async () => {
    for (const [name, request] of Object.entries(consoleRequests)) {
      const wire = await show(snap, request);
      const sdk = await show(snap, fixtures[name]!);
      // The console sends lower-case addresses; MetaMask shows every address checksummed.
      expect(wire.text.map((l) => l.toLowerCase())).toEqual(sdk.text.map((l) => l.toLowerCase()));
    }
  });

  it("reads eth_signTypedData_v3 requests the same way", async () => {
    const fixture = fixtures.usdSend!;
    expect((await show(snap, fixture, { method: "eth_signTypedData_v3" })).text).toEqual(
      (await show(snap, fixture)).text,
    );
  });

  it("flags a request that borrows Hyperliquid's name with other fields", async () => {
    const data = structuredClone(fixtures.usdSend!.data) as { types: Record<string, unknown> };
    data.types["HyperliquidTransaction:UsdSend"] = [
      { name: "hyperliquidChain", type: "string" },
      { name: "amount", type: "string" },
      { name: "time", type: "uint64" },
    ];
    const { severity, text } = await show(snap, { from: SIGNER, data });
    expect(severity).toBe("critical");
    expect(text.slice(0, 2)).toEqual([
      "[danger] Unexpected request: Reject it unless you know exactly why this site needs it.",
      "# This request doesn't match Hyperliquid's format",
    ]);
  });

  it("marks an unreadable request critical", async () => {
    const data = structuredClone(fixtures.usdClassTransferConsole!.data) as {
      message: Record<string, unknown>;
    };
    data.message.toPerp = "true";
    const { severity, text } = await show(snap, { from: SIGNER, data });
    expect(severity).toBe("critical");
    expect(text.slice(0, 2)).toEqual([
      "[danger] Unexpected request: Reject it unless you know exactly why this site needs it.",
      "# This request can't be read safely",
    ]);
  });

  it("marks an unknown action that may move funds critical", async () => {
    const data = {
      domain: fixtures.usdSend!.data.domain,
      types: {
        EIP712Domain: EIP712_DOMAIN,
        "HyperliquidTransaction:PerpDexClassTransfer": [
          { name: "hyperliquidChain", type: "string" },
          { name: "destination", type: "string" },
          { name: "amount", type: "string" },
          { name: "nonce", type: "uint64" },
        ],
      },
      primaryType: "HyperliquidTransaction:PerpDexClassTransfer",
      message: { hyperliquidChain: "Mainnet", destination: OTHER, amount: "1000", nonce: 1795176000000 },
    };
    const { severity, text } = await show(snap, { from: SIGNER, data });
    expect(severity).toBe("critical");
    expect(text).toEqual([
      "[danger] Unknown action: It names an amount or an account, so it may move funds. Sign only if you started it in an app you trust.",
      "# Hyperliquid action: perp DEX class transfer",
      "This Snap doesn't know this action yet. Check each field below before you sign.",
      `Destination: ${OTHER}`,
      "Amount: 1000",
      "Nonce: 1795176000000",
      "Network: Hyperliquid",
    ]);
  });

  it("lists the signed fields of an action it doesn't know yet", async () => {
    const data = {
      domain: fixtures.usdSend!.data.domain,
      types: {
        EIP712Domain: EIP712_DOMAIN,
        "HyperliquidTransaction:SetDisplayName": [
          { name: "hyperliquidChain", type: "string" },
          { name: "displayName", type: "string" },
          { name: "nonce", type: "uint64" },
        ],
      },
      primaryType: "HyperliquidTransaction:SetDisplayName",
      message: {
        hyperliquidChain: "Mainnet",
        displayName: "orchid",
        nonce: 1795176000000,
        extra: "unsigned",
      },
    };
    const { text } = await show(snap, { from: SIGNER, data });
    expect(text).toEqual([
      "[warning] Unknown action: Sign only if you started it in an app you trust.",
      "# Hyperliquid action: set display name",
      "This Snap doesn't know this action yet. Check each field below before you sign.",
      "Display name: orchid",
      "Nonce: 1795176000000",
      "Network: Hyperliquid",
    ]);
  });
});

describe("decode", () => {
  it("flags API wallet names with hidden or lookalike characters, on any site", () => {
    const named = (agentName: string) => {
      const data = structuredClone(fixtures.approveAgentNamed!.data) as { message: Record<string, unknown> };
      data.message.agentName = agentName;
      const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN)!;
      return [insight.level, insight.verdict, insight.reason, insight.fields.find((f) => f.label === "Name")];
    };
    const copy =
      'It is made to read as "hyperodds" without being plain text. The Hyperodds console never does this. Reject it.';
    const cases: [string, string][] = [
      ["hyper\u200bodds", "hyper[U+200B]odds"],
      ["hyper\u03bfdds", "hyper[U+03BF]dds"],
      ["hyper\u043edds", "hyper[U+043E]dds"],
      [
        "\uff48\uff59\uff50\uff45\uff52\uff4f\uff44\uff44\uff53",
        "[U+FF48][U+FF59][U+FF50][U+FF45][U+FF52][U+FF4F][U+FF44][U+FF44][U+FF53]",
      ],
      ["hyper\u2060odds", "hyper[U+2060]odds"],
      ["hypero\u0301dds", "hypero[U+0301]dds"],
      ["\u0570yperodds", "[U+0570]yperodds"],
    ];
    for (const [agentName, shown] of cases)
      expect(named(`${agentName} valid_until 1810641600000`)).toEqual([
        "danger",
        "Name uses hidden or lookalike characters",
        copy,
        { label: "Name", text: shown },
      ]);
    expect(named("caf\u00e9")).toEqual([
      "danger",
      "Name uses hidden or lookalike characters",
      "Invisible or non-Latin characters can make one name pass for another. Reject it.",
      { label: "Name", text: "caf[U+00E9]" },
    ]);
    expect(named("bot\tvalid_until 1810641600000")[3]).toEqual({
      label: "Name",
      text: "bot[U+0009]valid_until 1810641600000",
    });
    expect(named("bot \u00a0valid_until 1810641600000")[1]).toBe("Name uses hidden or lookalike characters");
    expect(named("bot")[0]).toBe("warning");
  });

  it("reads an API wallet expiry only in Hyperliquid's own format", () => {
    const NONCE = 1795176000000;
    const expires = (agentName: string, now = NONCE + 2 * 3_600_000) => {
      const data = structuredClone(fixtures.approveAgentNamed!.data) as { message: Record<string, unknown> };
      data.message.agentName = agentName;
      const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN, now)!;
      const row = (label: string) => insight.fields.find((f) => f.label === label);
      return [row("Name"), row("Expires"), insight.reason];
    };
    const untilExpiry =
      "Whoever holds it can trade this account's funds until it expires. Approve keys only from apps you trust.";
    const untilRemoved =
      "Whoever holds it can trade this account's funds until you remove or replace it. Approve keys only from apps you trust.";
    expect(expires(`bot valid_until ${NONCE + 30 * DAY}`)).toEqual([
      { label: "Name", text: "bot" },
      { label: "Expires", text: "20 Dec 2026, 12:00 UTC (in 30 days)" },
      untilExpiry,
    ]);
    expect(expires(`bot valid_until ${NONCE + 30 * DAY}`, NONCE + 29.5 * DAY)[1]).toEqual({
      label: "Expires",
      text: "20 Dec 2026, 12:00 UTC (in less than a day)",
    });
    expect(expires(`bot valid_until ${NONCE + 30 * DAY}`, NONCE + 31 * DAY)[1]).toEqual({
      label: "Expires",
      text: "20 Dec 2026, 12:00 UTC (already passed)",
    });
    expect(expires(`bot valid_until ${NONCE + 30 * DAY}`, Number.NaN)[1]).toEqual({
      label: "Expires",
      text: "20 Dec 2026, 12:00 UTC (30 days from the request's time)",
    });
    expect(expires(`bot valid_until ${NONCE + 181 * DAY}`)[1]).toEqual({
      label: "Expires",
      text: "20 May 2027, 12:00 UTC (beyond Hyperliquid's 180-day limit)",
    });
    expect(expires(`bot valid_until ${NONCE - DAY}`)[1]).toEqual({
      label: "Expires",
      text: "19 Nov 2026, 12:00 UTC (already passed)",
    });
    for (const name of [
      `botvalid_until ${NONCE + DAY}`,
      `bot valid_until  ${NONCE + DAY}`,
      `bot valid_until ${NONCE + DAY} `,
      "bot valid_until 99999999999999999999999",
      "bot valid_until soon",
    ])
      expect(expires(name)).toEqual([
        { label: "Name", text: name },
        { label: "Expires", text: "Unclear: not in Hyperliquid's expiry format" },
        untilRemoved,
      ]);
  });

  it("marks an unknown action red when it names an amount or an account", () => {
    const unknownAction = (fields: string[]) => {
      const primaryType = "HyperliquidTransaction:Future";
      const all = ["hyperliquidChain", ...fields, "nonce"];
      const data = {
        domain: fixtures.usdSend!.data.domain,
        primaryType,
        types: {
          EIP712Domain: EIP712_DOMAIN,
          [primaryType]: all.map((name) => ({ name, type: name === "nonce" ? "uint64" : "string" })),
        },
        message: Object.fromEntries(
          all.map((n) => [n, n === "hyperliquidChain" ? "Mainnet" : n === "nonce" ? 1 : "x"]),
        ),
      };
      return decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN)?.level;
    };
    for (const field of [
      "destination",
      "destinationRecipient",
      "amount",
      "wei",
      "user",
      "tradingUser",
      "toUser",
    ])
      expect([field, unknownAction([field])]).toEqual([field, "danger"]);
    for (const field of ["displayName", "weight", "username", "users", "note"])
      expect([field, unknownAction([field])]).toEqual([field, "warning"]);
    const primaryType = "HyperliquidTransaction:Payout";
    const payout = {
      domain: fixtures.usdSend!.data.domain,
      primaryType,
      types: {
        EIP712Domain: EIP712_DOMAIN,
        [primaryType]: [
          { name: "hyperliquidChain", type: "string" },
          { name: "to", type: "address" },
          { name: "usdc", type: "string" },
          { name: "nonce", type: "uint64" },
        ],
      },
      message: { hyperliquidChain: "Mainnet", to: OTHER, usdc: "1000", nonce: 1 },
    };
    expect(
      decode({ from: SIGNER, data: payout, signatureMethod: "eth_signTypedData_v4" }, ORIGIN)?.level,
    ).toBe("danger");
  });

  it("leaves every other signature to MetaMask", () => {
    const permit = {
      domain: { name: "USD Coin", version: "2", chainId: 42161, verifyingContract: OTHER },
      types: { Permit: [{ name: "owner", type: "address" }] },
      primaryType: "Permit",
      message: { owner: SIGNER },
    };
    expect(decode({ from: SIGNER, data: permit, signatureMethod: "eth_signTypedData_v4" })).toBeNull();
    expect(decode({ from: SIGNER, data: "0x68656c6c6f", signatureMethod: "personal_sign" })).toBeNull();
    expect(decode({ from: SIGNER, data: "{not json", signatureMethod: "eth_signTypedData_v4" })).toBeNull();
    expect(decode({ from: SIGNER, data: fixtures.usdSend!.data, signatureMethod: "eth_sign" })).toBeNull();
  });

  it("reads typed data passed as a JSON string", () => {
    const { from, data } = fixtures.usdSend!;
    const method = "eth_signTypedData_v4";
    expect(decode({ from, data: JSON.stringify(data), signatureMethod: method })).toEqual(
      decode({ from, data, signatureMethod: method }),
    );
  });

  it("rejects signed values in a form Hyperliquid's own apps never send", () => {
    const cases: [string, string, unknown][] = [
      ["usdClassTransferConsole", "toPerp", "true"],
      ["userPortfolioMargin", "enabled", "true"],
      ["linkStakingUserInitiate", "isFinalize", 0],
      ["tokenDelegate", "isUndelegate", 1],
      ["tokenDelegate", "wei", "0x12a05f200"],
      ["cDeposit", "wei", 1.5],
      ["cWithdraw", "wei", -1],
      ["approveAgentNamed", "agentAddress", "0x1234"],
      ["approveAgentNamed", "agentName", 7],
      ["approveAgentNamed", "nonce", "18446744073709551616"],
      ["sendToEvmWithData", "destinationChainId", 4294967296],
      ["sendToEvmWithData", "data", "a9059cbb"],
      ["sendToEvmWithData", "data", "0xa9059cb"],
      ["sendMultiSig", "multiSigActionHash", "0x20bc"],
      ["usdSend", "amount", 250.5],
      ["usdSend", "hyperliquidChain", undefined],
      ["l1Order", "connectionId", "0xa4ca"],
      ["l1Order", "source", 1],
    ];
    for (const [name, field, value] of cases) {
      const data = structuredClone(fixtures[name]!.data) as { message: Record<string, unknown> };
      if (value === undefined) delete data.message[field];
      else data.message[field] = value;
      const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN);
      expect([name, insight?.level, insight?.title, insight?.fields.slice(1)]).toEqual([
        name,
        "danger",
        "This request can't be read safely",
        [
          { label: "Field", text: field },
          { label: "Value sent", text: value === undefined ? "Missing" : JSON.stringify(value) },
        ],
      ]);
    }
  });

  it("names the action and the field it can't read", () => {
    const data = structuredClone(fixtures.usdClassTransferConsole!.data) as {
      message: Record<string, unknown>;
    };
    data.message.toPerp = "true";
    expect(decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN)).toEqual({
      title: "This request can't be read safely",
      body: "Its \"toPerp\" field is written in a form Hyperliquid's own apps don't use, so this Snap can't be sure what you would sign.",
      level: "danger",
      verdict: "Unexpected request",
      reason: "Reject it unless you know exactly why this site needs it.",
      fields: [
        { label: "Action", text: "USD class transfer" },
        { label: "Field", text: "toPerp" },
        { label: "Value sent", text: '"true"' },
      ],
      network: null,
    });
    const l1 = structuredClone(fixtures.l1Order!.data) as { message: Record<string, unknown> };
    l1.message.connectionId = `0x${"ab".repeat(100)}`;
    const insight = decode({ from: SIGNER, data: l1, signatureMethod: "eth_signTypedData_v4" }, ORIGIN)!;
    expect(insight.fields[0]).toEqual({ label: "Action", text: "Trading action (Agent)" });
    expect(insight.fields[2]!).toEqual({ label: "Value sent", text: `"0x${"ab".repeat(38)}…` });
  });

  it("accepts large integers written as decimal strings", () => {
    const data = structuredClone(fixtures.tokenDelegate!.data) as { message: Record<string, unknown> };
    data.message.wei = "18446744073709551615";
    const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN);
    expect(insight?.title).toBe("Delegate 184,467,440,737.09551615 HYPE");
  });

  it("reads amounts only as plain decimals and the network only as Mainnet or Testnet", () => {
    const read = (name: string, field: string, value: string) => {
      const data = structuredClone(fixtures[name]!.data) as { message: Record<string, unknown> };
      data.message[field] = value;
      const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN)!;
      return insight.title === "This request can't be read safely" ? insight.fields[1] : insight.title;
    };
    for (const name of ["usdSend", "spotSend", "withdraw", "sendAssetOther", "sendToEvmWithData"])
      for (const value of ["1,000", "", "1e3", "-5", ".5", "1.", " 1", "0x10"])
        expect([name, value, read(name, "amount", value)]).toEqual([
          name,
          value,
          { label: "Field", text: "amount" },
        ]);
    expect(read("usdSend", "amount", "99999999999999999999.123456789")).toBe(
      "Send 99,999,999,999,999,999,999.123456789 USDC",
    );
    expect(read("usdClassTransferConsole", "amount", `10 subaccount:${SUB_ACCOUNT}`)).toBe(
      "Move 10 USDC from perps to spot",
    );
    expect(read("usdClassTransferConsole", "amount", "10 subaccount:bob")).toEqual({
      label: "Field",
      text: "amount",
    });
    expect(read("usdClassTransferConsole", "amount", "10 subaccount:")).toEqual({
      label: "Field",
      text: "amount",
    });
    for (const value of ["Mainnet2", "mainnet", "Mainnet ", ""])
      expect(read("usdSend", "hyperliquidChain", value)).toEqual({
        label: "Field",
        text: "hyperliquidChain",
      });
  });

  it("flags requests that don't declare Hyperliquid's EIP712Domain", () => {
    const salted = [...(EIP712_DOMAIN as object[]), { name: "salt", type: "bytes32" }];
    for (const name of ["usdSend", "l1Order"])
      for (const domainType of [undefined, salted, (EIP712_DOMAIN as object[]).slice(0, 3)]) {
        const data = structuredClone(fixtures[name]!.data) as { types: Record<string, unknown> };
        if (domainType) data.types.EIP712Domain = domainType;
        else delete data.types.EIP712Domain;
        const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN);
        expect([name, insight?.level, insight?.title]).toEqual([
          name,
          "danger",
          "This request doesn't match Hyperliquid's format",
        ]);
      }
  });

  it("flags Hyperliquid's signing name with another domain version or contract", () => {
    for (const domain of [{ version: "2" }, { version: 1 }, { verifyingContract: OTHER }]) {
      const data = structuredClone(fixtures.usdSendSelf!.data) as { domain: Record<string, unknown> };
      Object.assign(data.domain, domain);
      const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN);
      expect(insight?.title).toBe("This request doesn't match Hyperliquid's format");
    }
  });

  it("flags multi-sig signer lists Hyperliquid can't read", () => {
    for (const signers of [
      "{not json",
      "5",
      '"x"',
      '{"authorizedUsers":["0x12"],"threshold":1}',
      `{"authorizedUsers":["${OTHER}"],"threshold":"1"}`,
      `{"authorizedUsers":["${OTHER}"],"threshold":0}`,
    ]) {
      const data = structuredClone(fixtures.convertToMultiSigUser!.data) as {
        message: Record<string, unknown>;
      };
      data.message.signers = signers;
      const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN);
      expect([insight?.level, insight?.title, insight?.fields]).toEqual([
        "danger",
        "This request doesn't match Hyperliquid's format",
        [{ label: "Signers", text: signers }],
      ]);
    }
  });

  it("flags a token whose name and ID belong to different Hyperliquid tokens", () => {
    const HYPE = "0x0d01dc56dcaaca66ad901c959b4011ec";
    const USDC = "0x6d1e7cde53ba9467b783cb7c530ce054";
    const check = (name: string, tokenValue: string, chain = "Mainnet") => {
      const data = structuredClone(fixtures[name]!.data) as { message: Record<string, unknown> };
      Object.assign(data.message, { token: tokenValue, hyperliquidChain: chain });
      const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN)!;
      const amountRow = insight.fields.find((f) => f.label === "Amount");
      return [insight.level, insight.verdict, insight.reason, insight.title, amountRow, insight.body];
    };
    const mismatch = (reason: string, title: string, quantity: string) => [
      "danger",
      "Token name doesn't match its ID",
      reason,
      title,
      { label: "Amount", text: quantity },
    ];
    expect(check("spotSend", `USDC:${HYPE}`).slice(0, 5)).toEqual(
      mismatch(
        "The request says USDC, but this ID belongs to HYPE. Reject it.",
        "Send 1,000 HYPE",
        "1,000 HYPE",
      ),
    );
    expect(check("spotSend", `USDC:${HYPE}`)[5]).toBe(
      "Moves 1,000 HYPE from this account's spot balance to the address below on Hyperliquid.",
    );
    expect(check("sendAssetOther", "HYPE:0x00000000000000000000000000000000").slice(0, 5)).toEqual(
      mismatch(
        "The request says HYPE, but this isn't the ID of Hyperliquid's HYPE. Reject it.",
        "Send 12.5 of an unknown token",
        "12.5 of an unknown token",
      ),
    );
    expect(check("sendAssetOwnDexes", `PURR:${USDC}`).slice(0, 5)).toEqual(
      mismatch(
        "The request says PURR, but this ID belongs to USDC. Reject it.",
        "Move 30 USDC from perps to spot",
        "30 USDC",
      ),
    );
    expect(check("sendToEvmWithData", `USDC:${HYPE.toUpperCase().replace("0X", "0x")}`).slice(0, 5)).toEqual(
      mismatch(
        "The request says USDC, but this ID belongs to HYPE. Reject it.",
        "Send 1 HYPE to Arbitrum One",
        "1 HYPE",
      ),
    );
    expect(check("spotSend", "PURR:0xc1fb593aeffbeb02f85e0308e9956a90", "Testnet").slice(0, 5)).toEqual(
      mismatch(
        "The request says PURR, but this isn't the ID of Hyperliquid's PURR. Reject it.",
        "Send 1,000 of an unknown token",
        "1,000 of an unknown token",
      ),
    );
    expect(check("spotSend", "PURR:0xc4bf3f870c0e9465323c0b6ed28096c2", "Testnet").slice(1, 4)).toEqual([
      "Sends funds to another address",
      "Check the whole address. Hyperliquid can't reverse a transfer.",
      "Send 1,000 PURR",
    ]);
    expect(check("spotSend", "FOO:0x11111111111111111111111111111111")[3]).toBe("Send 1,000 FOO");
    expect(check("sendAssetOwnDexes", "USDC")[1]).toBe("Stays in this account");
    expect(check("sendAssetOwnDexes", `USDC:${USDC}`)[1]).toBe("Stays in this account");
  });

  it("treats Object.prototype names as unknown, never as built-in lookups", () => {
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const primaryType = `HyperliquidTransaction:${key}`;
      const { domain, types, message } = fixtures.usdSend!.data as Record<string, Record<string, unknown>>;
      const data = {
        domain,
        types: { EIP712Domain: EIP712_DOMAIN, [primaryType]: types!["HyperliquidTransaction:UsdSend"] },
        primaryType,
        message,
      };
      const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN);
      expect([key, insight?.level, insight?.verdict]).toEqual([key, "danger", "Unknown action"]);
    }
    const data = structuredClone(fixtures.userSetAbstraction!.data) as { message: Record<string, unknown> };
    data.message.abstraction = "constructor";
    const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN);
    expect(insight?.title).toBe('Switch to "constructor" mode');
  });

  it("reads an Agent signature only under Hyperliquid's full L1 domain", () => {
    const l1 = (domain: Record<string, unknown>, agent?: { name: string; type: string }[]) => {
      const data = structuredClone(fixtures.l1Order!.data) as Record<string, Record<string, unknown>>;
      Object.assign(data.domain!, domain);
      if (agent) data.types!.Agent = agent;
      return decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN)?.title ?? null;
    };
    expect(l1({})).toBe("Sign a Hyperliquid trading action");
    expect(l1({ chainId: "0x539" })).toBe("Sign a Hyperliquid trading action");
    expect(l1({ chainId: "1337" })).toBe("Sign a Hyperliquid trading action");
    for (const domain of [{ chainId: 1 }, { chainId: 42161 }, { version: "2" }, { verifyingContract: OTHER }])
      expect(l1(domain)).toBeNull();
    expect(
      l1({}, [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
        { name: "extra", type: "string" },
      ]),
    ).toBe("This request doesn't match Hyperliquid's format");
  });

  it("treats an EVM send as going to the signer only for a hex address with no contract data", () => {
    const send = (changes: Record<string, unknown>) => {
      const data = structuredClone(fixtures.sendToEvmWithDataSelf!.data) as {
        message: Record<string, unknown>;
      };
      Object.assign(data.message, changes);
      const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN)!;
      return [insight.level, insight.verdict, insight.fields.find((f) => f.label === "Address format")];
    };
    expect(send({})).toEqual(["warning", "Leaves Hyperliquid", undefined]);
    expect(send({ destinationRecipient: SIGNER.toLowerCase() })).toEqual([
      "warning",
      "Leaves Hyperliquid",
      undefined,
    ]);
    expect(send({ addressEncoding: "base58" })).toEqual([
      "danger",
      "Sends funds to another address",
      { label: "Address format", text: "base58" },
    ]);
    expect(send({ data: "0x00" })).toEqual(["danger", "Sends funds to a contract call", undefined]);
    expect(send({ destinationRecipient: OTHER })).toEqual([
      "danger",
      "Sends funds to another address",
      undefined,
    ]);
  });

  it("reads a builder fee rate only as a plain percentage", () => {
    for (const rate of [".05%", "1e-1%", "0.1", "0.1 %", "ten%"]) {
      const data = structuredClone(fixtures.approveBuilderFeeLow!.data) as {
        message: Record<string, unknown>;
      };
      data.message.maxFeeRate = rate;
      const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN)!;
      expect([rate, insight.level, insight.verdict]).toEqual([rate, "warning", "Unreadable fee rate"]);
    }
  });

  it("treats a destination that isn't a full address as another address", () => {
    for (const destination of [
      "alice.hl",
      SIGNER.slice(2),
      `${SIGNER} `,
      "0x3DE927fcC729450313c8ac20162B28f61A2A4D9",
    ]) {
      const data = structuredClone(fixtures.usdSendSelf!.data) as { message: Record<string, unknown> };
      data.message.destination = destination;
      const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" }, ORIGIN)!;
      expect([insight.level, insight.verdict, insight.fields[0]]).toEqual([
        "danger",
        "Sends funds to another address",
        { label: "To", text: destination },
      ]);
    }
  });

  it("reads only the fields the signature covers", () => {
    const data = structuredClone(fixtures.usdSend!.data) as { message: Record<string, unknown> };
    data.message.note = "Refund to your own wallet";
    const insight = decode({ from: SIGNER, data, signatureMethod: "eth_signTypedData_v4" });
    expect(JSON.stringify(insight)).not.toContain("Refund");
  });
});

describe("format", () => {
  it("groups amounts and leaves anything else as signed", () => {
    expect(["1250.50", "000250.50", "0.000", "1000000", "1e3", ".5", "-1"].map(amount)).toEqual([
      "1,250.5",
      "250.5",
      "0",
      "1,000,000",
      "1e3",
      ".5",
      "-1",
    ]);
  });

  it("reads integer units with their decimals", () => {
    expect([units(5, 8), units("5000000000", 8), units(0, 8), units("0x1", 8), units(1.5, 8)]).toEqual([
      "0.00000005",
      "50",
      "0",
      null,
      null,
    ]);
    expect([integer("12"), integer(12), integer("0x1"), integer(-1), integer(2 ** 53)]).toEqual([
      12,
      12,
      null,
      null,
      null,
    ]);
  });

  it("writes dates and spans in UTC", () => {
    expect(date(0)).toBe("1 Jan 1970, 00:00 UTC");
    expect(date(1810641600000)).toBe("18 May 2027, 12:00 UTC");
    expect([days(DAY * 1.4), days(DAY * 179)]).toEqual(["1 day", "179 days"]);
  });

  it("checksums addresses the EIP-55 way", () => {
    expect(checksum("0x3de927fcc729450313c8ac20162b28f61a2a4d96")).toBe(SIGNER);
    expect(checksum("0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED")).toBe(
      "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    );
    expect(checksum("0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359")).toBe(
      "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    );
  });

  it("reads names the way they look on screen", () => {
    expect(skeleton("\uff28yper\u200b\u03bfdds")).toBe("hyperodds");
    expect(skeleton("\u04bbyp\u0435r\u043e\u0501\u0501\u0455")).toBe("hyperodds");
    expect(skeleton("Hyp\u00e9r\u2060odds\ufeff")).toBe("hyperodds");
    expect(skeleton("bot")).toBe("bot");
    expect(escaped("hyper\u200bodds \u{1f600}")).toBe("hyper[U+200B]odds [U+1F600]");
  });

  it("names tokens, balances, chains and fields", () => {
    expect(token("PURR:0xc1fb593aeffbeb02f85e0308e9956a90")).toEqual({
      name: "PURR",
      id: "0xc1fb593aeffbeb02f85e0308e9956a90",
    });
    expect(token("USDC")).toEqual({ name: "USDC", id: null });
    expect(["", "spot", "xyz"].map((d) => balance(d))).toEqual(["perps", "spot", "xyz perps"]);
    expect(["", "spot", "xyz"].map((d) => balance(d, true))).toEqual(["Perps", "Spot", "Perps on xyz"]);
    expect([chain(42161), chain(999), chain(5)]).toEqual(["Arbitrum One", "HyperEVM", "chain 5"]);
    expect([
      label("displayName"),
      label("sendToEvmWithData"),
      label("destinationChainId"),
      label("usdc"),
    ]).toEqual(["Display name", "Send to EVM with data", "Destination chain ID", "USDC"]);
  });
});

describe("explain", () => {
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("prints usage for --help and with no request", () => {
    for (const args of [["--help"], []]) {
      const { code, out } = explain(...args);
      expect(code).toBe(0);
      expect(out).toMatch(/^Usage: npm run explain -- <fixture \| file\.json \| list> \[options\]/);
      expect(out).toContain("--origin <site>   the site that asks (default: https://usehyperodds.com)");
      expect(out).toContain("--json");
    }
  });

  it("says in one line what's wrong with the arguments", () => {
    expect(explain("nosuchthing")).toEqual({
      code: 1,
      out: "",
      err: 'explain: no fixture or file named "nosuchthing". "npm run explain -- list" names the fixtures.',
    });
    expect(explain("usdSend", "--from", "0x123")).toEqual({
      code: 1,
      out: "",
      err: 'explain: --from must be an address, 0x and 40 hex digits; got "0x123"',
    });
    expect(explain("usdSend", "--bogus").err).toBe("explain: Unknown option '--bogus'. See --help.");
    expect(explain(file("broken.json", "{oops")).err).toMatch(/^explain: .*broken\.json isn't JSON: /);
  });

  it("reads every shape a site sends and says which site and signer it used", () => {
    const shapes = [
      [SIGNER, typedData],
      [SIGNER, JSON.stringify(typedData)],
      { method: "eth_signTypedData_v4", params: [SIGNER, JSON.stringify(typedData)] },
      { from: SIGNER, data: typedData },
      JSON.stringify(typedData),
    ];
    for (const [i, shape] of shapes.entries()) {
      const { code, out } = explain(file(`shape${i}.json`, shape), "--origin", "example.com");
      expect(code).toBe(0);
      const signer = i === 4 ? "not given, so every destination counts as another address" : SIGNER;
      expect(out.split("\n")[0]).toBe(`Request from https://example.com, signed by ${signer}`);
      expect(out).toContain("HIGH  Sends funds to another address");
    }
  });

  it("prints the site, signer and UI tree as JSON, and says when there's no panel", () => {
    const json = JSON.parse(explain("usdSend", "--json", "--origin", "https://usehyperodds.co/").out);
    expect([json.origin, json.from, json.severity, json.content.type]).toEqual([
      "https://usehyperodds.co",
      SIGNER,
      "critical",
      "Box",
    ]);
    const permit = {
      domain: { name: "USD Coin", version: "2", chainId: 1, verifyingContract: SIGNER },
      types: { Permit: [{ name: "owner", type: "address" }] },
      primaryType: "Permit",
      message: { owner: SIGNER },
    };
    expect(explain(file("permit.json", permit)).out).toContain("No panel. This isn't a Hyperliquid request");
  });
});

describe("package", () => {
  it("names the install page as its home and this repository as its source", () => {
    const pkg = JSON.parse(read("package.json"));
    expect([pkg.homepage, pkg.repository, pkg.bugs]).toEqual([
      "https://usehyperodds.com/metamask",
      { type: "git", url: "https://github.com/usehyperodds/hyperodds-plugins.git", directory: "snap" },
      { url: "https://github.com/usehyperodds/hyperodds-plugins/issues" },
    ]);
    expect(JSON.parse(read("snap.manifest.json")).repository).toEqual(pkg.repository);
  });

  it("asks MetaMask for the published version only, on the hosted page", () => {
    const page = read("install/index.html");
    expect(page).toContain('const SNAP_ID = "npm:@hyperodds/snap";');
    expect(page).toContain(`const VERSION = "${JSON.parse(read("package.json")).version}";`);
    expect(page).not.toContain("location.search");
  });
});
