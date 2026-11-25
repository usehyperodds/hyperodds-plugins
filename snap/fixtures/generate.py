"""Writes payloads.json: the EIP-712 requests a wallet receives for each Hyperliquid action.

Every payload is built and signed with the official Hyperliquid Python SDK
(hyperliquid-python-sdk 0.24.0), then recovered to the signer to prove it is a valid request.
Actions the SDK has no helper for (cDeposit, cWithdraw, sendToEvmWithData, linkStakingUser,
stakingLinkDisableTradingUser, userPortfolioMargin) use the SDK's user_signed_payload with the
field lists from Hyperliquid's API docs.

    python3 -m venv .venv && .venv/bin/pip install hyperliquid-python-sdk==0.24.0
    .venv/bin/python fixtures/generate.py
"""

import copy
import json
import pathlib

from eth_account import Account
from eth_account.messages import encode_typed_data
from eth_utils import keccak, to_hex

from hyperliquid.utils import signing as s

SIGNER = Account.from_key(keccak(b"hyperodds snap fixture signer"))
OTHER = Account.from_key(keccak(b"hyperodds snap fixture recipient")).address
SUB_ACCOUNT = Account.from_key(keccak(b"hyperodds snap fixture sub-account")).address
AGENT = Account.from_key(keccak(b"hyperodds snap fixture agent")).address
SPOOF_AGENT = Account.from_key(keccak(b"hyperodds snap fixture spoofed agent")).address
VALIDATOR = Account.from_key(keccak(b"hyperodds snap fixture validator")).address
MULTI_SIG = Account.from_key(keccak(b"hyperodds snap fixture multi-sig")).address
CO_SIGNER = Account.from_key(keccak(b"hyperodds snap fixture co-signer")).address
OTHER_BUILDER = "0x8c967E73E7B15087c42A10D344cFf4c96D877f1D"  # the SDK's example builder
HYPERODDS_BUILDER = "0xd31d379ba70a5b1a0689cfaa748beeeeac9846e9"  # meta.config on api.usehyperodds.com

NONCE = 1795176000000  # 20 Nov 2026 12:00 UTC
DAY = 86_400_000
ARBITRUM = "0xa4b1"  # what the Hyperodds console and Hyperliquid's app sign on

C_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "wei", "type": "uint64"},
    {"name": "nonce", "type": "uint64"},
]
SEND_TO_EVM_WITH_DATA_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "token", "type": "string"},
    {"name": "amount", "type": "string"},
    {"name": "sourceDex", "type": "string"},
    {"name": "destinationRecipient", "type": "string"},
    {"name": "addressEncoding", "type": "string"},
    {"name": "destinationChainId", "type": "uint32"},
    {"name": "gasLimit", "type": "uint64"},
    {"name": "data", "type": "bytes"},
    {"name": "nonce", "type": "uint64"},
]
LINK_STAKING_USER_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "user", "type": "address"},
    {"name": "isFinalize", "type": "bool"},
    {"name": "nonce", "type": "uint64"},
]
STAKING_LINK_DISABLE_TRADING_USER_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "tradingUser", "type": "address"},
    {"name": "nonce", "type": "uint64"},
]
USER_PORTFOLIO_MARGIN_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "user", "type": "address"},
    {"name": "enabled", "type": "bool"},
    {"name": "nonce", "type": "uint64"},
]
APPROVE_AGENT_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "agentAddress", "type": "address"},
    {"name": "agentName", "type": "string"},
    {"name": "nonce", "type": "uint64"},
]
APPROVE_BUILDER_FEE_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "maxFeeRate", "type": "string"},
    {"name": "builder", "type": "address"},
    {"name": "nonce", "type": "uint64"},
]

out = {}


def jsonable(value):
    if isinstance(value, (bytes, bytearray)):
        return to_hex(value)
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [jsonable(v) for v in value]
    return value


def record(name, note, data):
    signature = s.sign_inner(SIGNER, data)
    recovered = Account.recover_message(
        encode_typed_data(full_message=data),
        vrs=[signature["v"], signature["r"], signature["s"]],
    )
    assert recovered == SIGNER.address, name
    out[name] = {"note": note, "from": SIGNER.address, "data": jsonable(data), "signature": signature}


def user_signed(name, note, action, types, primary_type, mainnet=True, chain_id="0x66eee"):
    action = copy.deepcopy(action)
    action["signatureChainId"] = chain_id
    action["hyperliquidChain"] = "Mainnet" if mainnet else "Testnet"
    record(name, note, s.user_signed_payload(primary_type, types, action))


user_signed(
    "approveAgentConsole",
    "The Hyperodds console's API wallet approval: name hyperodds, 179 days, on Arbitrum One",
    {
        "type": "approveAgent",
        "agentAddress": AGENT,
        "agentName": f"hyperodds valid_until {NONCE + 179 * DAY}",
        "nonce": NONCE,
    },
    APPROVE_AGENT_TYPES,
    "HyperliquidTransaction:ApproveAgent",
    chain_id=ARBITRUM,
)
user_signed(
    "approveAgentSpoofedName",
    "A phishing site's API wallet approval named after Hyperodds, in other letter case, on Arbitrum One",
    {
        "type": "approveAgent",
        "agentAddress": SPOOF_AGENT,
        "agentName": f"HyperOdds valid_until {NONCE + 179 * DAY}",
        "nonce": NONCE,
    },
    APPROVE_AGENT_TYPES,
    "HyperliquidTransaction:ApproveAgent",
    chain_id=ARBITRUM,
)
user_signed(
    "approveAgentUnnamed",
    "Exchange.approve_agent() with no name",
    {"type": "approveAgent", "agentAddress": AGENT, "agentName": "", "nonce": NONCE},
    APPROVE_AGENT_TYPES,
    "HyperliquidTransaction:ApproveAgent",
)
user_signed(
    "approveAgentNamed",
    "Exchange.approve_agent('bot'): a named API wallet with no expiry",
    {"type": "approveAgent", "agentAddress": AGENT, "agentName": "bot", "nonce": NONCE},
    APPROVE_AGENT_TYPES,
    "HyperliquidTransaction:ApproveAgent",
)
user_signed(
    "approveBuilderFeeHyperodds",
    "The Hyperodds console's builder fee approval: 0.1% (100 tenths of a basis point) on Arbitrum One",
    {"type": "approveBuilderFee", "maxFeeRate": "0.1%", "builder": HYPERODDS_BUILDER, "nonce": NONCE},
    APPROVE_BUILDER_FEE_TYPES,
    "HyperliquidTransaction:ApproveBuilderFee",
    chain_id=ARBITRUM,
)
user_signed(
    "approveBuilderFeeLow",
    "The SDK's builder fee example: 0.001%",
    {"type": "approveBuilderFee", "maxFeeRate": "0.001%", "builder": OTHER_BUILDER, "nonce": NONCE},
    APPROVE_BUILDER_FEE_TYPES,
    "HyperliquidTransaction:ApproveBuilderFee",
)
user_signed(
    "approveBuilderFeeSpotCap",
    "A 1% builder fee approval, the spot cap",
    {"type": "approveBuilderFee", "maxFeeRate": "1%", "builder": OTHER_BUILDER, "nonce": NONCE},
    APPROVE_BUILDER_FEE_TYPES,
    "HyperliquidTransaction:ApproveBuilderFee",
)
user_signed(
    "approveBuilderFeeAboveCap",
    "A 2% builder fee approval, above Hyperliquid's 1% cap",
    {"type": "approveBuilderFee", "maxFeeRate": "2%", "builder": OTHER_BUILDER, "nonce": NONCE},
    APPROVE_BUILDER_FEE_TYPES,
    "HyperliquidTransaction:ApproveBuilderFee",
)
user_signed(
    "approveBuilderFeeZero",
    "A 0% builder fee approval",
    {"type": "approveBuilderFee", "maxFeeRate": "0%", "builder": OTHER_BUILDER, "nonce": NONCE},
    APPROVE_BUILDER_FEE_TYPES,
    "HyperliquidTransaction:ApproveBuilderFee",
)
user_signed(
    "usdSend",
    "Exchange.usd_transfer(250.5, other)",
    {"destination": OTHER, "amount": "250.5", "time": NONCE, "type": "usdSend"},
    s.USD_SEND_SIGN_TYPES,
    "HyperliquidTransaction:UsdSend",
)
user_signed(
    "usdSendSelf",
    "Exchange.usd_transfer(5, own address)",
    {"destination": SIGNER.address.lower(), "amount": "5", "time": NONCE, "type": "usdSend"},
    s.USD_SEND_SIGN_TYPES,
    "HyperliquidTransaction:UsdSend",
)
user_signed(
    "spotSend",
    "Exchange.spot_transfer(1000, other, PURR)",
    {
        "destination": OTHER,
        "amount": "1000",
        "token": "PURR:0xc1fb593aeffbeb02f85e0308e9956a90",
        "time": NONCE,
        "type": "spotSend",
    },
    s.SPOT_TRANSFER_SIGN_TYPES,
    "HyperliquidTransaction:SpotSend",
)
user_signed(
    "withdraw",
    "Exchange.withdraw_from_bridge(1200, other)",
    {"destination": OTHER, "amount": "1200", "time": NONCE, "type": "withdraw3"},
    s.WITHDRAW_SIGN_TYPES,
    "HyperliquidTransaction:Withdraw",
)
user_signed(
    "withdrawSelf",
    "Exchange.withdraw_from_bridge(40, own address) on testnet",
    {"destination": SIGNER.address, "amount": "40", "time": NONCE, "type": "withdraw3"},
    s.WITHDRAW_SIGN_TYPES,
    "HyperliquidTransaction:Withdraw",
    mainnet=False,
)
user_signed(
    "usdClassTransferConsole",
    "The Hyperodds console moving 25 USDC from perps to spot before an outcome order",
    {"type": "usdClassTransfer", "amount": "25", "toPerp": False, "nonce": NONCE},
    s.USD_CLASS_TRANSFER_SIGN_TYPES,
    "HyperliquidTransaction:UsdClassTransfer",
    chain_id=ARBITRUM,
)
user_signed(
    "usdClassTransferSubAccount",
    "Exchange.usd_class_transfer(10, to_perp=True) with a vault address set",
    {
        "type": "usdClassTransfer",
        "amount": f"10 subaccount:{SUB_ACCOUNT.lower()}",
        "toPerp": True,
        "nonce": NONCE,
    },
    s.USD_CLASS_TRANSFER_SIGN_TYPES,
    "HyperliquidTransaction:UsdClassTransfer",
)
user_signed(
    "sendAssetOwnDexes",
    "Exchange.send_asset(own, '', 'spot', 'USDC', 30): perps to spot on the same account",
    {
        "type": "sendAsset",
        "destination": SIGNER.address,
        "sourceDex": "",
        "destinationDex": "spot",
        "token": "USDC",
        "amount": "30",
        "fromSubAccount": "",
        "nonce": NONCE,
    },
    s.SEND_ASSET_SIGN_TYPES,
    "HyperliquidTransaction:SendAsset",
)
user_signed(
    "sendAssetOther",
    "Exchange.send_asset(other, 'spot', 'spot', HYPE, 12.5)",
    {
        "type": "sendAsset",
        "destination": OTHER,
        "sourceDex": "spot",
        "destinationDex": "spot",
        "token": "HYPE:0x0d01dc56dcaaca66ad901c959b4011ec",
        "amount": "12.5",
        "fromSubAccount": "",
        "nonce": NONCE,
    },
    s.SEND_ASSET_SIGN_TYPES,
    "HyperliquidTransaction:SendAsset",
)
user_signed(
    "sendAssetFromSubAccount",
    "Exchange.send_asset(own, '', 'xyz', 'USDC', 100) with a vault address set",
    {
        "type": "sendAsset",
        "destination": SIGNER.address,
        "sourceDex": "",
        "destinationDex": "xyz",
        "token": "USDC",
        "amount": "100",
        "fromSubAccount": SUB_ACCOUNT,
        "nonce": NONCE,
    },
    s.SEND_ASSET_SIGN_TYPES,
    "HyperliquidTransaction:SendAsset",
)
user_signed(
    "sendToEvmWithData",
    "sendToEvmWithData with the API docs fields: 1 USDC to a contract on Arbitrum One with call data",
    {
        "type": "sendToEvmWithData",
        "token": "USDC",
        "amount": "1",
        "sourceDex": "spot",
        "destinationRecipient": OTHER,
        "addressEncoding": "hex",
        "destinationChainId": 42161,
        "gasLimit": 200000,
        "data": bytes.fromhex("a9059cbb"),
        "nonce": NONCE,
    },
    SEND_TO_EVM_WITH_DATA_TYPES,
    "HyperliquidTransaction:SendToEvmWithData",
)
user_signed(
    "sendToEvmWithDataSelf",
    "sendToEvmWithData: 1 USDC to the signer's own address on Arbitrum One, no call data",
    {
        "type": "sendToEvmWithData",
        "token": "USDC",
        "amount": "1",
        "sourceDex": "spot",
        "destinationRecipient": SIGNER.address,
        "addressEncoding": "hex",
        "destinationChainId": 42161,
        "gasLimit": 200000,
        "data": b"",
        "nonce": NONCE,
    },
    SEND_TO_EVM_WITH_DATA_TYPES,
    "HyperliquidTransaction:SendToEvmWithData",
)
user_signed(
    "tokenDelegate",
    "Exchange.token_delegate(validator, 50 HYPE, is_undelegate=False)",
    {"validator": VALIDATOR, "wei": 50 * 10**8, "isUndelegate": False, "nonce": NONCE, "type": "tokenDelegate"},
    s.TOKEN_DELEGATE_TYPES,
    "HyperliquidTransaction:TokenDelegate",
)
user_signed(
    "tokenUndelegate",
    "Exchange.token_delegate(validator, 0.5 HYPE, is_undelegate=True)",
    {"validator": VALIDATOR, "wei": 5 * 10**7, "isUndelegate": True, "nonce": NONCE, "type": "tokenDelegate"},
    s.TOKEN_DELEGATE_TYPES,
    "HyperliquidTransaction:TokenDelegate",
)
user_signed(
    "cDeposit",
    "cDeposit: 75 HYPE from spot into staking",
    {"type": "cDeposit", "wei": 75 * 10**8, "nonce": NONCE},
    C_TYPES,
    "HyperliquidTransaction:CDeposit",
)
user_signed(
    "cWithdraw",
    "cWithdraw: 20 HYPE from staking to spot",
    {"type": "cWithdraw", "wei": 20 * 10**8, "nonce": NONCE},
    C_TYPES,
    "HyperliquidTransaction:CWithdraw",
)
user_signed(
    "convertToMultiSigUser",
    "Exchange.convert_to_multi_sig_user([own, co-signer], 2)",
    {
        "type": "convertToMultiSigUser",
        "signers": json.dumps({"authorizedUsers": sorted([SIGNER.address, CO_SIGNER]), "threshold": 2}),
        "nonce": NONCE,
    },
    s.CONVERT_TO_MULTI_SIG_USER_SIGN_TYPES,
    "HyperliquidTransaction:ConvertToMultiSigUser",
)
user_signed(
    "convertToMultiSigUserRevert",
    "Exchange.convert_to_multi_sig_user with no signers: back to a normal account",
    {"type": "convertToMultiSigUser", "signers": json.dumps(None), "nonce": NONCE},
    s.CONVERT_TO_MULTI_SIG_USER_SIGN_TYPES,
    "HyperliquidTransaction:ConvertToMultiSigUser",
)
user_signed(
    "userDexAbstraction",
    "Exchange.user_dex_abstraction(own, True)",
    {"type": "userDexAbstraction", "user": SIGNER.address.lower(), "enabled": True, "nonce": NONCE},
    s.USER_DEX_ABSTRACTION_SIGN_TYPES,
    "HyperliquidTransaction:UserDexAbstraction",
)
user_signed(
    "userSetAbstraction",
    "Exchange.user_set_abstraction(own, 'portfolioMargin')",
    {"type": "userSetAbstraction", "user": SIGNER.address.lower(), "abstraction": "portfolioMargin", "nonce": NONCE},
    s.USER_SET_ABSTRACTION_SIGN_TYPES,
    "HyperliquidTransaction:UserSetAbstraction",
)
user_signed(
    "userSetAbstractionUnified",
    "Exchange.user_set_abstraction(own, 'unifiedAccount')",
    {"type": "userSetAbstraction", "user": SIGNER.address.lower(), "abstraction": "unifiedAccount", "nonce": NONCE},
    s.USER_SET_ABSTRACTION_SIGN_TYPES,
    "HyperliquidTransaction:UserSetAbstraction",
)
user_signed(
    "userSetAbstractionDisabled",
    "Exchange.user_set_abstraction(own, 'disabled')",
    {"type": "userSetAbstraction", "user": SIGNER.address.lower(), "abstraction": "disabled", "nonce": NONCE},
    s.USER_SET_ABSTRACTION_SIGN_TYPES,
    "HyperliquidTransaction:UserSetAbstraction",
)
user_signed(
    "userPortfolioMargin",
    "userPortfolioMargin: turn portfolio margin on",
    {"type": "userPortfolioMargin", "user": SIGNER.address.lower(), "enabled": True, "nonce": NONCE},
    USER_PORTFOLIO_MARGIN_TYPES,
    "HyperliquidTransaction:UserPortfolioMargin",
)
user_signed(
    "linkStakingUser",
    "linkStakingUser: the staking account finalizes a link to a trading account",
    {"type": "linkStakingUser", "user": OTHER, "isFinalize": True, "nonce": NONCE},
    LINK_STAKING_USER_TYPES,
    "HyperliquidTransaction:LinkStakingUser",
)
user_signed(
    "linkStakingUserInitiate",
    "linkStakingUser: the trading account asks to link to a staking account",
    {"type": "linkStakingUser", "user": OTHER, "isFinalize": False, "nonce": NONCE},
    LINK_STAKING_USER_TYPES,
    "HyperliquidTransaction:LinkStakingUser",
)
user_signed(
    "stakingLinkDisableTradingUser",
    "stakingLinkDisableTradingUser: permanently disable a linked trading account",
    {"type": "stakingLinkDisableTradingUser", "tradingUser": OTHER, "nonce": NONCE},
    STAKING_LINK_DISABLE_TRADING_USER_TYPES,
    "HyperliquidTransaction:StakingLinkDisableTradingUser",
)

def multi_sig(name, note, action, types, primary_type):
    action = {"type": action.pop("type"), "signatureChainId": "0x66eee", "hyperliquidChain": "Mainnet", **action}
    action = s.add_multi_sig_fields(action, MULTI_SIG, SIGNER.address)
    record(name, note, s.user_signed_payload(primary_type, s.add_multi_sig_types(types), action))


multi_sig(
    "multiSigSendAsset",
    "sign_multi_sig_user_signed_action_payload for sendAsset: one signer's approval for a multi-sig send",
    {
        "type": "sendAsset",
        "destination": OTHER,
        "sourceDex": "",
        "destinationDex": "",
        "token": "USDC",
        "amount": "100.0",
        "fromSubAccount": "",
        "nonce": NONCE,
    },
    s.SEND_ASSET_SIGN_TYPES,
    "HyperliquidTransaction:SendAsset",
)
multi_sig(
    "multiSigWithdraw",
    "One signer's approval for a multi-sig withdrawal to the multi-sig address itself",
    {"type": "withdraw3", "destination": MULTI_SIG.lower(), "amount": "10", "time": NONCE},
    s.WITHDRAW_SIGN_TYPES,
    "HyperliquidTransaction:Withdraw",
)
multi_sig(
    "multiSigSendToEvmWithData",
    "One signer's approval for a multi-sig sendToEvmWithData to the multi-sig address, no call data",
    {
        "type": "sendToEvmWithData",
        "token": "USDC",
        "amount": "1",
        "sourceDex": "spot",
        "destinationRecipient": MULTI_SIG.lower(),
        "addressEncoding": "hex",
        "destinationChainId": 42161,
        "gasLimit": 200000,
        "data": b"",
        "nonce": NONCE,
    },
    SEND_TO_EVM_WITH_DATA_TYPES,
    "HyperliquidTransaction:SendToEvmWithData",
)

order = s.order_wires_to_order_action(
    [
        s.order_request_to_order_wire(
            {
                "coin": "#36000",
                "is_buy": True,
                "sz": 100,
                "limit_px": 0.81,
                "order_type": {"limit": {"tif": "Ioc"}},
                "reduce_only": False,
            },
            100036000,
        )
    ],
    {"b": HYPERODDS_BUILDER, "f": 100},
)
record(
    "l1Order",
    "sign_l1_action for an outcome order carrying the Hyperodds builder code (the console signs these with its API wallet)",
    s.l1_payload(s.construct_phantom_agent(s.action_hash(order, None, NONCE, None), True)),
)
record(
    "l1Testnet",
    "sign_l1_action for a cancel on testnet",
    s.l1_payload(
        s.construct_phantom_agent(
            s.action_hash({"type": "cancel", "cancels": [{"a": 100036000, "o": 1}]}, None, NONCE, None), False
        )
    ),
)

multi_sig_order = copy.deepcopy(order)
del multi_sig_order["type"]
envelope = {"multiSigActionHash": s.action_hash(multi_sig_order, None, NONCE, None), "nonce": NONCE}
envelope["signatureChainId"] = "0x66eee"
envelope["hyperliquidChain"] = "Mainnet"
record(
    "sendMultiSig",
    "sign_multi_sig_action: the outer signer submitting a multi-sig order",
    s.user_signed_payload("HyperliquidTransaction:SendMultiSig", s.MULTI_SIG_ENVELOPE_SIGN_TYPES, envelope),
)

path = pathlib.Path(__file__).with_name("payloads.json")
path.write_text(json.dumps(out, indent=2) + "\n")
print(f"{len(out)} payloads, signer {SIGNER.address}")
