# Zero-TRX USDT→TRX Swap dApp — Architecture Specification

**Status:** Design locked through all major domains. Pre-implementation.
**Stack:** NestJS backend · React (mobile-first) frontend · TronWeb/RPC · custom Solidity (TVM) settlement contract.

---

## 1. Core Concept & Constraint

Users hold USDT but **0 TRX**, so they cannot pay Energy/Bandwidth to move their own funds. The product converts their USDT to TRX and delivers it, while covering the network cost and taking a fee.

**Verified hard constraint:** Tron's USDT contract (`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, "TetherToken," 2019) exposes only standard TRC-20 methods — **no `permit` / gasless approval**. It also has the legacy quirk where changing a non-zero allowance to another non-zero value can revert (must reset to zero first). Therefore a fully zero-pre-commitment flow is impossible; every viable design accepts a small bootstrap cost.

---

## 2. High-Level Architecture (LOCKED)

**Hybrid: custom on-chain settlement contract + NestJS orchestrator.**

- **Settlement contract (Solidity/TVM):** atomic `settle()` performing the entire swap in one transaction.
- **NestJS backend:** orchestrates flow, sponsors energy, computes fees/routes, manages keys.
- **TronWeb in backend** for all sensitive RPC. Frontend uses wallet provider only for the single user signature.

**NestJS modules:** `SwapModule`, `TronModule` (RPC wrapper), `EnergyModule` (rental + delegation), `PricingModule` (fee + route + economics), `WalletModule` (signer), `ReconciliationService`.

---

## 3. Bootstrap Solution — `approve()` for a 0-TRX user (LOCKED)

No `permit`, so: backend **delegates a small amount of Energy** (`DelegateResource`, ~32k energy) to the user's address so they can sign `approve()`. This is the only pre-commitment spend.

- User abandons before signing → **reclaim via `UnDelegateResource`**, loss ≈ 0 (bandwidth only).
- User signs then abandons → small approve-energy consumed (bounded, ~$0.50–1). User gains nothing usable (energy is non-transferable; this is griefing, not theft).

---

## 4. Energy Strategy (LOCKED)

- **Primary:** real-time Energy rental from a **crypto-payable, no-KYC marketplace** (server outside Iran; VPN acceptable; geo-restriction deprioritized). **Provider selection = open research item.**
- **Fallback:** modest self-staked Energy reserve (`FreezeBalanceV2`) for marketplace outages.
- **Two-tier timing (the risk shield):**
  - Tiny delegation for `approve()` — pre-commitment, mostly reclaimable.
  - **Large settlement-energy rental deferred until AFTER on-chain allowance is confirmed.** No large spend before commitment.
- Pre-flight energy estimate via `triggerConstantContract` to rent the correct amount.
- **Cost reality (researched):** target wallets are zero-USDT-balance → 131k energy tier (not 65k), plus DEX swap overhead. True per-swap energy ≈ **$3–6**, not the original $2.70 estimate. Floats with TRX price/congestion.

---

## 5. Settlement Contract (LOCKED)

**Single atomic `settle()` call:**
1. `transferFrom(user, contract, totalUSDT)` (exact approved amount).
2. Forward fee (USDT) directly to **cold treasury** in-call.
3. Swap remainder USDT→TRX via **SunSwap V2 router**, fixed path, `minAmountOut` guard + deadline.
4. Router auto-unwraps WTRX → **native TRX** to the user.
5. Any failure → whole tx reverts (no half-states, no stranded funds).

**Protections:** `nonReentrant` + checks-effects-interactions; immutable router & USDT addresses; on-chain `MIN_FEE_FLOOR` (~$2) and `MAX_FEE_BPS` (~8%); slippage hard ceiling 3%; `onlyOwner` pause. **Non-upgradeable** (small audit surface; exact single-use approvals make redeploy cheap — no orphaned allowances). **Mandatory professional audit before mainnet.**

---

## 6. Fee Model (LOCKED)

```
fee = max(MIN_FEE, FLOOR_COST + rate * amount)

E_measured = live per-swap energy cost (backend computes each tx: rent quote TRX × TRX/USD)
FLOOR_COST = E_measured × 1.25      # 25% safety buffer
P_min      = $2.00                  # minimum profit
MIN_FEE    = E_measured + P_min     # DYNAMIC floor (not a static $4)
rate       = 0.6% of swap amount    # volume-scaling term (config-tunable)
```

- Dynamic floor keeps profitability through TRX/energy volatility.
- Naturally reproduces "high % on small swaps, declining % on large" without hand-picked points.
- **Fee kept as USDT** in cold treasury (price-stable, gas-cheap, clean books).
- Separate **threshold-triggered batch rebalancer** converts USDT→TRX only to refill the operational reserve.
- Backend computes fee; **contract validates against MIN/MAX bounds**.
- Add SunSwap's **0.3% pool fee** to the user-facing quote (comes out of their swapped amount).
- **Minimum viable swap amount** enforced (reject swaps where fee/amount ratio is unreasonable).

---

## 7. DEX Integration (LOCKED)

- **SunSwap V2** router for execution (Uniswap-V2 semantics, predictable energy).
- **Backend computes optimal route + `minAmountOut` off-chain** (may use SunSwap Smart Router API for price discovery); contract executes a **fixed, known path** → deterministic energy, tight slippage control.
- **Default slippage 1%** (config-driven; volatility-adaptive 0.5–2% later); **3% hard ceiling on-chain**.

---

## 8. Execution State Machine (LOCKED)

`QUOTED → APPROVAL_PENDING → APPROVED → SETTLING → COMPLETED` (+ `EXPIRED`, `FAILED`).

1. **QUOTED** — connect wallet, read balance (free), compute quote. Zero cost.
2. **APPROVAL_PENDING** — user clicks Confirm → backend delegates approve-energy → user signs `approve()` (to contract, exact gross amount). Abandon = reclaim, ~0 loss.
3. **APPROVED** — allowance confirmed on-chain. **Auto-triggers settlement** (no second click).
4. **SETTLING** — **re-check user USDT balance**, then rent full settlement energy, then broadcast atomic `settle()`. Revert = bounded energy loss, funds safe.
5. **COMPLETED** — TRX confirmed; realized fee recorded.

- **Quote TTL 60–90s** prevents stale-price exploitation.
- One user signature total.

---

## 9. Approval Model (LOCKED)

- **Exact-amount, single-use** approvals (legible wallet prompt = the number the user typed; fee/swap split happens inside the contract).
- Consumed immediately → allowance returns to 0 → legacy non-zero→non-zero quirk never triggers in normal flow.
- **Read allowance before every approve.** Leftover non-zero allowance from an abandoned swap with a *different* amount → app **auto-handles reset-to-zero then re-approve** (with clear UI messaging); reuse leftover only on exact match. (Reset path = a second tiny delegation.)

---

## 10. Backend Persistence & Orchestration (LOCKED — MVP)

- **Postgres = source of truth.** `Swap` entity: state enum, amounts, quote snapshot, TTL, **all on-chain tx hashes (persisted before broadcast)**, timestamps.
- **MVP:** Postgres + idempotency + NestJS built-in scheduler. (BullMQ/Redis deferred to scaling; worker logic already structured as discrete resumable transitions.)
- **Non-negotiable from day one:** DB-backed state machine, idempotency key per swap, read-on-chain-truth-before-acting, startup + periodic `ReconciliationService`.
- Self-hostable; no third-party dependency.

---

## 11. Tron Connectivity (LOCKED — MVP)

- **`TronModule` abstraction** — semantic methods only; no raw TronWeb elsewhere.
- **Multi-endpoint failover client built now:** **TronGrid (free API key) primary** + **dRPC (crypto-payable) fallback**; auto-retry on 429/timeout/5xx.
- TronGrid limits: ~15 QPS, 100k req/day → failover + **exponential backoff polling (~3s, capped)** for confirmations.
- **Self-hosted full node = Phase 2** behind the same interface.
- Open item: confirm fallback provider's crypto payment at signup.

---

## 12. Frontend & UX (LOCKED — Mobile-First)

- **WalletConnect v2 primary** (mobile wallet apps), **TronLink** for desktop/extension; single `useWallet()` hook.
- **Backend builds unsigned `approve()`, frontend signs**; frontend broadcasts approve, backend broadcasts settlement.
- **Signing handshake:** frontend prompts for signature **only after** backend confirms energy delegation (so wallet sees energy is present — no scary "needs TRX" warning). Interstitial: "Setting up your gas-free transaction… ~5s".
- **State-driven single-action UI** mirroring backend states; status polling with backoff.
- **Prominent reassurance:** "No TRX needed — we cover the network fee."
- **Mobile deep-link round-trip** (web → wallet app → web) handled via resumable persisted state.

---

## 13. Security & Abuse Mitigation (LOCKED)

**#1 threat — energy-drain griefing** (attacker makes you spend energy with no completed swap):
- One active (non-terminal) swap per address + per-address cooldown.
- Delegate energy only after in-session commitment (never on load/connect).
- **Invisible-first proof-of-humanity** (Turnstile/hCaptcha invisible mode) before first delegation; visible challenge only on risk escalation.
- Minimum swap amount.
- Real-time energy-spent-vs-revenue **circuit breaker** + alerting; cold-key `onlyOwner` pause as nuclear option.
- Address-based limits weighted over IP (VPN-heavy users).

**Approve-then-move-balance front-run:** balance recheck before renting settlement energy (free abort); tiny auto-triggered approve→settle window.

**Contract:** reentrancy guard, fee/slippage bounds, immutable addresses, non-upgradeable, audit.

**API/dApp:** backend never trusts frontend amounts (recompute server-side); idempotency keys; quote TTL; rate limiting; HTTPS; short-lived session tokens; structured audit logging; phishing/clone-site defense (publicly verifiable contract address, official-domain comms).

---

## 14. Edge Cases (LOCKED) — all resolve via "reconcile to on-chain truth"

- **(a) Settlement confirmed on-chain, backend crashed before recording:** tx hash persisted *before* broadcast → reconciliation checks chain by hash → complete or safe-retry. Idempotent; never double-broadcast without checking chain.
- **(b) Swap reverts after energy rented:** atomic → funds safe; eat bounded energy; mark FAILED, offer retry; feed circuit-breaker metrics.
- **(c) Adverse TRX move within TTL:** TTL short + re-validate economics before energy rental → **honor quote even at small bounded loss**, hard-abort if loss > ~2× energy cost.
- **(d) User sends more USDT / odd interaction:** exact-amount pull + balance recheck + one-pending-swap rule handle it; no new mechanism.
- **(e) Stuck/unconfirmed settlement:** timeout-and-reconcile; Tron tx expiration makes dead txns definitively safe-to-replace; set sane expiration on broadcast.

---

## Key Roles / Keys (LOCKED)

- **Executor hot wallet** (Tier-2: encrypted secret loaded in-memory at boot via `ISigner`; migrate to self-hosted Vault later). Holds **operating float only** — all profit swept to cold treasury (capped blast radius).
- **Cold treasury key** (offline) — receives fees **and** doubles as contract owner / pause authority. (Emergency pause requires bringing cold key online — accepted; keep pause logic dead-simple.)

---

## Open Items / Pre-Launch Gates

1. **Energy rental provider** — select crypto-payable, no-KYC, API-driven marketplace. *(research)*
2. **RPC fallback** — confirm dRPC (or alt) crypto payment works at signup.
3. **Smart contract audit** — hard gate before mainnet with real funds.
4. Confirm SunSwap V2 router method auto-unwraps to native TRX (`...ForETH` family).
5. Tune `rate`, buffer, min-swap-amount against live cost data post-launch.
