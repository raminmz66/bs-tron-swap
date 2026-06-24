# Contract deployments

Source of truth for deployed `SwapSettlement` instances. Backend sub-project should read Nile address + ABI from here.

ABI artifact (compiled): `build/contracts/SwapSettlement.json`

## Nile testnet

| Field | Value |
|-------|-------|
| Network | Nile (`https://nile.trongrid.io`) |
| **SwapSettlement** | `TTjrcNN6Gin39ooFTTrzcCSHRWmGjusiFD` |
| Explorer | https://nile.tronscan.org/#/contract/TTjrcNN6Gin39ooFTTrzcCSHRWmGjusiFD |
| USDT (test) | `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf` |
| SunSwap V2 Router | `TMn1qrmYUMSTXo9babrJLzepKZoPC7M6Sy` |
| WTRX | `TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a` |
| Owner (treasury) | `TW75PdVmXeYkT9Ybt6MFK5JwiUx2TDT7CG` |
| Executor | `TFgijReBH6oDMy3bbyYRUXvU8zUK7pbkCg` |
| Deployed | 2026-06-24 |
| Integration test | ✅ `npm run test:integration` — 60 USDT → native TRX via SunSwap V2 |

Constructor params: `minFee=4_000_000`, `feeBps=60`, `maxFeeBps=800`, `minSwapAmount=50_000_000`.

## Mainnet

Not deployed. **Professional audit required before mainnet** (see architecture doc).
