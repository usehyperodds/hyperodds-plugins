// The EIP-712 field lists Hyperliquid verifies against, from hyperliquid/utils/signing.py in the
// official Python SDK and the exchange endpoint docs. A request whose fields differ is one
// Hyperliquid would reject, however it is labelled.

const fields = (spec: string) => spec.split(" ").map((f) => f.split(":") as [string, string]);

export const USER_SIGNED: Record<string, [string, string][]> = {
  ApproveAgent: fields("hyperliquidChain:string agentAddress:address agentName:string nonce:uint64"),
  ApproveBuilderFee: fields("hyperliquidChain:string maxFeeRate:string builder:address nonce:uint64"),
  UsdSend: fields("hyperliquidChain:string destination:string amount:string time:uint64"),
  SpotSend: fields("hyperliquidChain:string destination:string token:string amount:string time:uint64"),
  Withdraw: fields("hyperliquidChain:string destination:string amount:string time:uint64"),
  UsdClassTransfer: fields("hyperliquidChain:string amount:string toPerp:bool nonce:uint64"),
  SendAsset: fields(
    "hyperliquidChain:string destination:string sourceDex:string destinationDex:string token:string amount:string fromSubAccount:string nonce:uint64",
  ),
  SendToEvmWithData: fields(
    "hyperliquidChain:string token:string amount:string sourceDex:string destinationRecipient:string addressEncoding:string destinationChainId:uint32 gasLimit:uint64 data:bytes nonce:uint64",
  ),
  TokenDelegate: fields(
    "hyperliquidChain:string validator:address wei:uint64 isUndelegate:bool nonce:uint64",
  ),
  CDeposit: fields("hyperliquidChain:string wei:uint64 nonce:uint64"),
  CWithdraw: fields("hyperliquidChain:string wei:uint64 nonce:uint64"),
  ConvertToMultiSigUser: fields("hyperliquidChain:string signers:string nonce:uint64"),
  SendMultiSig: fields("hyperliquidChain:string multiSigActionHash:bytes32 nonce:uint64"),
  UserDexAbstraction: fields("hyperliquidChain:string user:address enabled:bool nonce:uint64"),
  UserSetAbstraction: fields("hyperliquidChain:string user:address abstraction:string nonce:uint64"),
  UserPortfolioMargin: fields("hyperliquidChain:string user:address enabled:bool nonce:uint64"),
  LinkStakingUser: fields("hyperliquidChain:string user:address isFinalize:bool nonce:uint64"),
  StakingLinkDisableTradingUser: fields("hyperliquidChain:string tradingUser:address nonce:uint64"),
};

// Multi-sig signers sign the same actions with these two fields after hyperliquidChain.
export const MULTI_SIG_FIELDS: [string, string][] = [
  ["payloadMultiSigUser", "address"],
  ["outerSigner", "address"],
];

export const L1_AGENT: [string, string][] = [
  ["source", "string"],
  ["connectionId", "bytes32"],
];

// Token IDs from Hyperliquid's spotMeta, so a request can't pass one token's ID off under another's name.
export const TOKENS: Record<string, Record<string, string>> = {
  Mainnet: {
    USDC: "0x6d1e7cde53ba9467b783cb7c530ce054",
    PURR: "0xc1fb593aeffbeb02f85e0308e9956a90",
    HYPE: "0x0d01dc56dcaaca66ad901c959b4011ec",
  },
  Testnet: {
    USDC: "0xeb62eee3685fc4c43992febcd9e75443",
    PURR: "0xc4bf3f870c0e9465323c0b6ed28096c2",
    HYPE: "0x7317beb7cceed72ef0b346074cc8e7ab",
  },
};
