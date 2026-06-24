# SwapSettlement — Deployment Runbook

## Prerequisites
- Node.js + project deps installed (`npm install`)
- `.env` populated (never commit it)
- No local node is used — the TRE Docker image is arm64-only and this is an amd64 host. All testing is on Nile.

## Test account setup (one-time)
1. `node scripts/gen-accounts.js` → paste the six `PRIVATE_KEY_NILE_0..5` into `.env`
2. Fund `accounts[0]` at https://nileex.io/join/getJoinPage (TRX + test USDT)
3. `node scripts/fund-accounts.js` → fans TRX to `accounts[1..5]`

## Run the test suite (Nile)
- Full suite: `npx tronbox test --network nile`
- Single file during iteration: `npx tronbox test ./test/settle.test.js --network nile`

## Nile real-instance deploy + integration test
1. Read the faucet's dispensed test-USDT contract address → `NILE_USDT_ADDRESS`
2. Set `NILE_OWNER_ADDRESS` and `NILE_EXECUTOR_ADDRESS` to `accounts[0]`'s base58 address
3. `npx tronbox migrate --reset --network nile`
4. `npx tronbox test ./test/integration.nile.js --network nile`
5. Verify the contract on https://nile.tronscan.org

## Mainnet (ONLY after professional audit)
1. **Audit gate:** do not proceed without a passed professional audit.
2. Owner = cold key (Ledger). Executor = backend hot wallet.
3. Set `MAINNET_OWNER_ADDRESS`, `MAINNET_EXECUTOR_ADDRESS`; provide `PRIVATE_KEY_MAINNET` transiently (a throwaway deploy key, NOT the cold key — the migration assigns ownership to `MAINNET_OWNER_ADDRESS` via the constructor).
4. `npx tronbox migrate --network mainnet`
5. Verify source on https://tronscan.org; publish the contract address through official channels.
6. Confirm `owner()` == cold key and `executor()` == backend wallet before going live.
