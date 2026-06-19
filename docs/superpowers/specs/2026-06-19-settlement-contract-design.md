# Settlement Contract Design Spec
**Date:** 2026-06-19
**Status:** Approved
**Scope:** Solidity/TVM `SwapSettlement` contract only. Backend (NestJS) and frontend (React) are separate sub-projects.

---

## 1. Context

This contract is the on-chain settlement layer for the Zero-TRX USDT→TRX swap dApp. Users hold USDT but zero TRX, so they cannot pay network fees themselves. The backend sponsors their fees and orchestrates the flow; this contract performs the atomic swap in a single transaction.

Full system architecture: `docs/zero-trx-swap-architecture.md`

---

## 2. Toolchain

- **TronBox** — Tron's official Truffle-based framework. Native TVM support, local development node via Docker, direct integration with Nile testnet.
- **Language:** Solidity (TVM-compatible subset)
- **Local node:** TronBox Quickstart (Docker) for unit tests — fully offline, instant block times
- **Testnet:** Nile — for integration tests against real SunSwap V2 and real block times

---

## 3. External Dependencies (Locked)

| Dependency | Mainnet Address | Nile Testnet Address |
|---|---|---|
| SunSwap V2 Router | `TNJVzGqKBWkJxJB5XYSqGAwUTV15U24pPq` | `TMn1qrmYUMSTXo9babrJLzepKZoPC7M6Sy` |
| WTRX | `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` | `TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a` |
| USDT (TetherToken) | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | To be confirmed from Nile faucet docs before testnet deploy |

**SunSwap V2 swap method:** `swapExactTokensForETH(amountIn, amountOutMin, path, to, deadline)` — "ETH" means TRX on Tron. WTRX unwrapping is automatic and atomic within the call. The last element of `path` must always be the WTRX address.

---

## 4. Storage Layout

### Immutable (set at constructor, never change)
```
address public immutable USDT    // TRC-20 USDT contract
address public immutable ROUTER  // SunSwap V2 router
address public immutable WTRX    // Wrapped TRX (for swap path)
```

Changing any of these requires redeploying the contract. This is intentional and cheap — exact-amount single-use approvals mean no orphaned allowances on redeploy.

### Owner-updatable state
```
address public owner          // Cold key: receives fees + controls all admin functions
address public pendingOwner   // Two-step ownership transfer target (must accept)
address public executor       // Backend hot wallet: only address allowed to call settle()
uint public minFee            // Minimum fee in USDT (6 decimals), e.g. 4_000_000 = 4 USDT
uint public feeBps            // Percentage rate in basis points, e.g. 60 = 0.6%
uint public maxFeeBps         // Hard fee ceiling in basis points, e.g. 800 = 8%
uint public minSwapAmount     // Minimum total USDT input accepted
bool public paused            // Emergency stop flag

mapping(bytes32 => bool) public usedSwapIds   // Idempotency: each swapId settled at most once
```

**Key design decision:** `owner` and treasury are the same address (the cold key). Fees are sent directly to `owner`. If separation is ever needed, redeploy.

**Units:** USDT amounts are in 6-decimal base units (`1_000_000` = 1 USDT). TRX amounts (`minTRXOut`, `trxOut`) are in SUN, the 6-decimal base unit of TRX (`1_000_000` SUN = 1 TRX).

---

## 5. Fee Formula

```
fee = max(minFee, totalUSDT × feeBps / 10000)
```

The contract computes this on-chain from its stored parameters. The backend does not pass a fee amount — it passes only `totalUSDT`, and the contract is the single source of truth for the fee.

`maxFeeBps` is enforced **only at setter time**: `setFeeBps()` reverts if the new rate would exceed `maxFeeBps`. The percentage component of the fee is therefore always bounded by `maxFeeBps`. There is **no per-transaction fee-ceiling check inside `settle()`** — that was rejected because it would revert small swaps where the `minFee` floor legitimately dominates.

**Per-transaction user protection** is provided by `minTRXOut`: if the effective fee were ever too high, the swapped amount (and thus TRX out) would be too low, and the swap reverts on the `minTRXOut` guard. `minSwapAmount` governs the economics of small swaps.

**Operational constraint:** When updating fee parameters, the owner should ensure `minSwapAmount >= minFee × 10000 / maxFeeBps`. This guarantees that every accepted swap is large enough for the `minFee` floor to stay within `maxFeeBps` as an effective rate. Violating this means small swaps could yield an effective fee percentage above `maxFeeBps` — allowed by the contract, but should be intentional.

---

## 6. Functions

### `settle(bytes32 swapId, address user, uint totalUSDT, uint minTRXOut, uint deadline)`
**Access:** `onlyExecutor`, `whenNotPaused`, `nonReentrant`

Execution steps:
1. Validate `usedSwapIds[swapId] == false` (idempotency), then set it `true`
2. Validate `totalUSDT >= minSwapAmount`
3. Compute `feeUSDT = max(minFee, totalUSDT × feeBps / 10000)`
4. `safeTransferFrom(user, address(this), totalUSDT)` — pull full amount from user (SafeERC20 wrapper)
5. `safeTransfer(owner, feeUSDT)` — send fee to treasury
6. Approve router to spend `swapUSDT = totalUSDT - feeUSDT` (SafeERC20 forceApprove)
7. Call `router.swapExactTokensForETH(swapUSDT, minTRXOut, [USDT, WTRX], user, deadline)`, capturing `trxOut = amounts[last]`
8. Emit `Settled(swapId, user, totalUSDT, feeUSDT, trxOut)`

Steps 4–7 are atomic. Any failure reverts the entire transaction — user keeps their USDT, and `swapId` is freed (the revert undoes step 1) so the backend can safely retry with the same `swapId`.

**USDT non-standard return values:** Tether's contract does not reliably return a bool on `transfer`/`transferFrom`. All USDT movements MUST use a SafeERC20-style wrapper (e.g. OpenZeppelin `SafeERC20` / `forceApprove`) rather than `require(token.transferFrom(...))`. This is a required implementation detail and a dedicated test case.

**Router approval:** Because `swapExactTokensForETH` consumes exactly `swapUSDT`, the contract's allowance to the router returns to zero after each swap, so USDT's legacy non-zero→non-zero approval quirk never triggers. `forceApprove` is used defensively to handle any residual dust.

**Recipient constraint:** `user` must be an externally-owned account (a normal wallet). The router delivers native TRX to `user`; an EOA can always receive it. (A contract recipient without a payable fallback would cause the swap to revert.)

### `quoteSettle(uint totalUSDT) → (uint feeUSDT, uint swapUSDT)`
**Access:** Public view (free, no transaction)

Returns the USDT fee and the post-fee USDT amount that will be swapped, for a given input. The backend calls this when building the quote so the displayed fee matches what the contract will actually charge.

**Division of labor (explicit):** The contract is the source of truth for the **USDT split only** (fee vs. swap amount). It does **not** price TRX. The backend computes the expected **TRX output**, applies SunSwap's 0.3% pool fee, derives `minTRXOut` (slippage-protected) via the SunSwap Smart Router API off-chain, and shows the user the final TRX figure. The contract then enforces that `minTRXOut` on-chain via the router during `settle()`.

### Admin functions (all `onlyOwner`)
| Function | Effect |
|---|---|
| `setMinFee(uint)` | Update floor fee (when energy costs shift) |
| `setFeeBps(uint)` | Update percentage rate; reverts if new value exceeds `maxFeeBps` |
| `setMaxFeeBps(uint)` | Update fee ceiling; reverts if current `feeBps` would exceed new ceiling |
| `setMinSwapAmount(uint)` | Update minimum input |
| `setExecutor(address)` | Rotate backend hot wallet (e.g. after server compromise) |
| `transferOwnership(address)` | **Step 1 of 2:** nominate a new owner (`pendingOwner`). Does not transfer control yet. |
| `acceptOwnership()` | **Step 2 of 2:** called by `pendingOwner` to take control. Guards against a typo'd address permanently bricking the contract. |
| `pause()` / `unpause()` | Emergency stop / resume |

`transferOwnership` is two-step (OpenZeppelin `Ownable2Step` pattern): the nominated address must call `acceptOwnership()` before it gains control. `acceptOwnership()` is the one admin function NOT gated by `onlyOwner` — it is gated by `msg.sender == pendingOwner`.

### Events
```
Settled(bytes32 indexed swapId, address indexed user, uint totalUSDT, uint feeUSDT, uint trxOut)
Paused(address by)
Unpaused(address by)
ExecutorChanged(address newExecutor)
OwnershipTransferStarted(address oldOwner, address pendingOwner)
OwnershipTransferred(address oldOwner, address newOwner)
FeeParamsUpdated(uint minFee, uint feeBps, uint maxFeeBps, uint minSwapAmount)
```

---

## 7. Data Flow

```
User                    Backend                 Contract              SunSwap V2
 |                         |                       |                      |
 | 1. clicks Confirm        |                       |                      |
 |------------------------>|                       |                      |
 |                         | 2. delegates energy   |                      |
 |                         |    to user (approve)  |                      |
 |                         |                       |                      |
 | 3. signs approve()      |                       |                      |
 |   (exact USDT amount)   |                       |                      |
 |------------------------>|                       |                      |
 |                         | 4. confirms allowance |                      |
 |                         |    on-chain           |                      |
 |                         | 5. rechecks user      |                      |
 |                         |    USDT balance       |                      |
 |                         | 6. rents settlement   |                      |
 |                         |    energy             |                      |
 |                         | 7. calls settle(swapId)|                     |
 |                         |---------------------->|                      |
 |                         |                       | 8. pulls USDT        |
 |                         |                       |    from user         |
 |                         |                       | 9. sends fee to      |
 |                         |                       |    owner (cold key)  |
 |                         |                       | 10. calls swap       |
 |                         |                       |-------------------->|
 | 11. receives native TRX |                       |                      |
 |<----------------------------------------------------(auto-unwrapped)  |
 |                         | 12. sees Settled      |                      |
 |                         |     event → DONE      |                      |
```

The contract never holds funds between calls. USDT comes in and is fully disbursed (fee + swap) within the same transaction.

---

## 8. Error Handling

### Before `settle()` is called
| Scenario | Outcome | Cost |
|---|---|---|
| Quote TTL expires | Backend aborts | None |
| User moves USDT after approving | Backend rechecks balance, aborts before renting energy | None |
| Energy marketplace down | Backend falls back to self-staked reserve; if empty, aborts | None |

### Inside `settle()` — all revert atomically
| Scenario | Outcome |
|---|---|
| `swapId` already used | Revert (idempotency guard — prevents double-settlement) |
| `totalUSDT < minSwapAmount` | Revert, no state change |
| `safeTransferFrom` fails (user moved funds) | Revert, user keeps USDT |
| SunSwap slippage exceeds `minTRXOut` | Revert, user keeps USDT |
| Reentrancy attempt | Blocked by guard, revert |

In every revert: user's USDT is safe, and the `swapId` is freed (the revert undoes the idempotency marker), so the backend may retry with the same `swapId`. Backend absorbs the energy cost (bounded ~$3–6 per failed settlement).

### After `settle()` — backend failure
- Tx hash is persisted to Postgres **before** broadcast
- On restart, `ReconciliationService` looks up hash on-chain and marks swap `COMPLETED` or `FAILED`
- Never double-broadcasts without first confirming chain state

### Emergency
- Circuit breaker alerts on energy-drain anomalies
- Owner calls `pause()` from Ledger hardware wallet → all `settle()` calls revert instantly
- No funds ever sit in the contract, so pause has no side effects on in-flight swaps

---

## 9. Security Properties

Built on OpenZeppelin contracts (`SafeERC20`, `ReentrancyGuard`, `Ownable2Step`, `Pausable`) — audited, standard implementations rather than hand-rolled equivalents.

| Property | Mechanism |
|---|---|
| Only backend can trigger settlement | `onlyExecutor` modifier on `settle()` |
| No double-settlement | `usedSwapIds` idempotency mapping |
| No reentrancy | OpenZeppelin `ReentrancyGuard` |
| Fee rate can't exceed ceiling | `maxFeeBps` enforced at `setFeeBps()` setter time |
| Safe USDT handling | OpenZeppelin `SafeERC20` (handles Tether's non-standard returns) |
| Router and USDT addresses can't change | `immutable` keyword |
| No bricked ownership | Two-step `Ownable2Step` transfer |
| Emergency stop | `pause()` / `whenNotPaused` |
| Non-upgradeable | No proxy pattern; direct deployment |
| Slippage protection | `minTRXOut` parameter + SunSwap router enforcement |

**Mandatory gate:** Professional smart contract audit before mainnet deployment with real funds.

---

## 10. Testing Plan

### Layer 1: Local unit tests (TronBox + Quickstart node)
Offline, runs in seconds. Uses a mock SunSwap router.

- `settle()` happy path — correct USDT pulled, correct fee to owner, correct TRX out
- Fee formula — at `minFee` floor, at `feeBps` rate, in between
- `setFeeBps()` rejects a rate above `maxFeeBps`; `setMaxFeeBps()` rejects a ceiling below current `feeBps`
- `minSwapAmount` enforcement — below minimum reverts
- **Idempotency** — second `settle()` with a used `swapId` reverts; after a reverted settle, the same `swapId` can be retried successfully
- **SafeERC20 / non-standard USDT** — test against a mock USDT that returns no bool (mimics Tether); `settle()` still succeeds and reverts correctly on failure
- `onlyExecutor` — non-executor calling `settle()` reverts
- `onlyOwner` — non-owner calling any admin function reverts
- Pause — `settle()` reverts when paused, succeeds when unpaused
- Slippage revert — mock router returns less than `minTRXOut`, full tx reverts
- `quoteSettle()` — correct output for boundary and mid-range inputs
- `setExecutor()` — new executor can call `settle()`, old one cannot
- **Two-step ownership** — `transferOwnership()` alone does not grant control; only after `acceptOwnership()` by `pendingOwner`; a non-pending address cannot accept
- Fee params update — `setMinFee`, `setFeeBps`, `setMaxFeeBps` reflected in next `quoteSettle()`

### Layer 2: Nile testnet integration tests
Against real SunSwap V2 router and real USDT on Nile.

- Full `settle()` end-to-end — real allowance flow, real swap, real TRX delivered
- Confirms `swapExactTokensForETH` auto-unwraps WTRX to native TRX
- Real energy consumption measurement — validates backend energy estimates
- Slippage guard under real market conditions

### Out of scope for this contract
- Energy delegation logic (NestJS backend)
- Frontend signing flow (React frontend)
- Security audit (separate engagement, mainnet gate)

---

## 11. Constructor Parameters

```
constructor(
    address _usdt,
    address _router,
    address _wtrx,
    address _owner,
    address _executor,
    uint _minFee,
    uint _feeBps,
    uint _maxFeeBps,
    uint _minSwapAmount
)
```

Deployed once per environment (local / Nile / mainnet) with environment-specific addresses.

---

## Open Items Resolved by This Spec

| Item | Resolution |
|---|---|
| SunSwap V2 auto-unwrap method | Confirmed: `swapExactTokensForETH`. WTRX unwrap is automatic and atomic. |
| Toolchain | TronBox |
| Fee computation location | On-chain (contract computes the USDT split from stored params) |
| Access control on `settle()` | `onlyExecutor` — backend hot wallet only |
| Owner vs treasury | Same address (cold key). Single address controls pause + receives fees. |
| Fee params mutability | Owner-updatable via setter functions |
| Fee ceiling enforcement | Setter-time only (`setFeeBps` ≤ `maxFeeBps`); no per-tx check. `minTRXOut` is the per-tx user guard. |
| USDT non-standard returns | SafeERC20 wrapper required for all USDT movements |
| On-chain idempotency | `bytes32 swapId` param + `usedSwapIds` mapping; emitted in `Settled` |
| TRX pricing responsibility | Backend (off-chain, SunSwap API) computes TRX out + `minTRXOut`; contract enforces `minTRXOut` |
| Ownership transfer safety | Two-step (`Ownable2Step`) |
