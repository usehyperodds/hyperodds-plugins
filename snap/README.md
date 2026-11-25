# Hyperodds Signature Insights for MetaMask

See what a Hyperliquid signature allows before you sign it.

When a site asks MetaMask to sign a Hyperliquid request, this Snap adds a short panel to the
request: what the signature lets the site or key do, how long that lasts, the amounts and
addresses involved, and a risk level.

## What it explains

| Request                                                            | The panel shows                                                                                           | Risk level                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| API wallet approval (`ApproveAgent`)                               | The key, its name, when it expires and how long is left, which API wallet it replaces                     | Check; High when the name has hidden or lookalike characters, or is named after Hyperodds and doesn't come from usehyperodds.com |
| Builder fee approval (`ApproveBuilderFee`)                         | The builder and the most it can charge per order                                                          | Low; Check at 0.1% and above                                                                                                     |
| USDC and token sends (`UsdSend`, `SpotSend`, `SendAsset`)          | Recipient, amount, token and its full ID, which balances it moves between                                 | High when the funds leave the account, or when the token's name and ID don't match                                               |
| Withdrawals to Arbitrum (`Withdraw`)                               | Recipient and amount                                                                                      | High when it goes to another address; Check to a multi-sig's own address                                                         |
| Transfers out with contract data (`SendToEvmWithData`)             | Recipient, chain, amount, source balance, size of the call data                                           | High; Check to your own address with no call data                                                                                |
| Perps and spot moves, staking, delegation                          | Amount and balances                                                                                       | Low                                                                                                                              |
| Account modes (portfolio margin, unified account)                  | What changes and for how long                                                                             | Check                                                                                                                            |
| Staking links (`LinkStakingUser`)                                  | The other account; once linked, the staking account can take the trading account's funds                  | High when this account asks to link; Check when it confirms                                                                      |
| Locking a linked trading account (`StakingLinkDisableTradingUser`) | The trading account that gets locked, and that its funds move to the signing staking account after a year | High                                                                                                                             |
| Turning an account into a multi-sig                                | Every signer and how many must sign                                                                       | High                                                                                                                             |
| A signer's approval for a multi-sig action                         | The action as above, plus the multi-sig account                                                           | As for the action                                                                                                                |
| Trading actions signed directly (the `Agent` signature)            | The full action hash: Hyperliquid hashes orders, so no wallet can read them                               | High                                                                                                                             |
| Actions the Snap doesn't know yet                                  | Every signed field                                                                                        | High when any field is an address, or its name contains the word destination, recipient, amount, wei or user; Check otherwise    |

Low shows a blue banner, Check an amber one and High a red one. High requests also carry
MetaMask's critical flag for Snap insights. MetaMask 13.57 adds no extra step for it; the red
banner is what you see.

Requests from other apps and other chains are left alone. A request that carries Hyperliquid's
signing name with fields Hyperliquid doesn't use is flagged, since Hyperliquid would reject it. So is
one whose values are written in a form Hyperliquid's own apps never send, such as `"true"` for a
yes/no field or `1e3` for an amount: MetaMask would sign a value the panel can't vouch for, so the
panel names the field instead.

## Install

From any site, with MetaMask installed:

```js
await window.ethereum.request({
  method: "wallet_requestSnaps",
  params: { "npm:@hyperodds/snap": {} },
});
```

MetaMask shows what the Snap may do and asks you to confirm. `install/index.html` in this
folder is a ready install page with an "Add to MetaMask" button; it finds MetaMask through
EIP-6963 and shows whether the Snap is already on. Host it with `preview.png` beside it. On
usehyperodds.com it uses the site's own IBM Plex Mono files under `/assets/fonts/`. The page asks
for one exact version (`VERSION` in its script); raise it with each release.

## Privacy

Everything is decoded inside MetaMask. The Snap has no network access and stores nothing. MetaMask
asks you to allow two things: showing a panel on signature requests, and seeing which site sent each
one. The site matters for one check: an API wallet named after Hyperodds is flagged unless the
request comes from usehyperodds.com.

## Limits

- It never blocks a request. You decide in MetaMask whether to sign.
- Orders, cancels and other trading actions are signed as a hash. The panel says so and shows the
  hash; nothing can show what is inside. MetaMask also refuses these requests unless the wallet is
  on a network with chain ID 1337, so the panel only appears in that case.
- The Snap is not listed in the MetaMask Snaps directory.

## Develop

Node.js 22 or later.

```sh
npm ci
npm test            # builds the bundle, then runs the snaps-jest suite
npm run typecheck
npm start           # serves the Snap at http://localhost:8080 for MetaMask Flask
npm run explain -- usdSend         # the panel for a fixture, run in MetaMask's Snaps simulator
npm run explain -- request.json    # the panel for any request you saved
npm run explain -- approveAgentConsole --origin usehyperodds.co   # as another site sends it
npm run explain -- usdSend --json  # the severity and MetaMask's UI tree
```

`explain` takes a fixture name or a file holding typed data (an object or a JSON string), the
`eth_signTypedData_v4` params `[from, typedData]`, a JSON-RPC request or `{from, data}`. It says
which site and signer it used: the site is `https://usehyperodds.com` unless `--origin` names
another, the signer the one in the request unless `--from` gives one. `--help` lists the options.

To try a local build in MetaMask Flask, run `npm start` and request
`local:http://localhost:8080` with `wallet_requestSnaps` from any page.

`fixtures/payloads.json` holds the signature requests the tests use, built and signed with the
official Hyperliquid Python SDK (`fixtures/generate.py`). `fixtures/console.json` holds the same
approvals as the Hyperodds console sends them to MetaMask.

The Snaps SDK is pinned to 12.1.0, the platform MetaMask 13.57 runs, and it ships inside
`dist/bundle.js`, so the package has no runtime dependencies. `overrides` holds
`@metamask/snaps-simulation` at 4.3.2 for the same reason: 4.3.3 moves the test simulator to Snaps
SDK 13, a newer platform than MetaMask ships.

## License

[MIT](LICENSE). Hyperliquid and MetaMask are named to describe compatibility; Hyperodds is not
affiliated with either.
