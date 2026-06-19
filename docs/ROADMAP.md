# Project Roadmap — Zero-TRX USDT→TRX Swap dApp

**Purpose:** Single source of truth for *what order we build in* and *where we are*. Update the Status column as each step completes.

Full system design: [`zero-trx-swap-architecture.md`](./zero-trx-swap-architecture.md)

---

## The build cycle (applies to every sub-project)

```
Brainstorm  →  Spec  →  Plan  →  Build (TDD)  →  Verify
(discuss)      (doc)     (steps)  (code+tests)    (works?)
```

Each sub-project runs this full cycle independently. We do NOT build them in parallel — each depends on the interface defined by the one before it.

---

## Sub-projects, in dependency order

### 1. Settlement Contract (Solidity / TVM, TronBox)
The on-chain `settle()` logic. Defines the interface the backend calls.

| Step | Status |
|---|---|
| Brainstorm | ✅ Done |
| Spec (`docs/superpowers/specs/2026-06-19-settlement-contract-design.md`) | ✅ Written — ⏳ awaiting user review |
| Plan | ⬜ Not started |
| Build + unit tests (TronBox) | ⬜ Not started |
| Nile testnet integration tests | ⬜ Not started |

### 2. Backend (NestJS)
Orchestrator: energy rental, fee math, state machine, Postgres, RPC, reconciliation. Calls the contract; exposes the API the frontend consumes. Stack details (queue lib, RPC client, energy provider) get decided at the start of its brainstorm.

| Step | Status |
|---|---|
| Brainstorm | ⬜ Not started |
| Spec | ⬜ Not started |
| Plan | ⬜ Not started |
| Build + tests | ⬜ Not started |

### 3. Frontend (React, mobile-first)
Wallet connect, the single signing step, status screens. **This is where UI mockups and the UI spec live** — discussed during this sub-project's brainstorm, sketched as throwaway HTML, then captured in a UI spec before coding.

| Step | Status |
|---|---|
| Brainstorm (UI flow + decisions) | ⬜ Not started |
| Mockups / sketches | ⬜ Not started |
| Spec (incl. UI-SPEC) | ⬜ Not started |
| Plan | ⬜ Not started |
| Build + tests | ⬜ Not started |

---

## Cross-cutting gates (after all three are built)

| Gate | Status |
|---|---|
| Integration — wire all three together, end-to-end test | ⬜ Not started |
| **Smart contract audit (HARD GATE before real funds)** | ⬜ Not started |
| Mainnet deployment | ⬜ Not started |

---

## Where we are right now

**Sub-project 1 (Contract) → Spec step → awaiting user review.**

Immediate next steps:
1. User reviews the contract spec
2. `writing-plans` skill → contract implementation plan
3. TDD build of contract + tests
4. Nile testnet verification
5. → then repeat the cycle for Sub-project 2 (Backend)

---

## Open items carried from architecture doc (not yet resolved)

These are pre-launch research/decision items tracked in the architecture doc §"Open Items / Pre-Launch Gates". Resolve before the relevant sub-project:

1. Energy rental provider selection — *backend sub-project*
2. RPC fallback (dRPC) crypto payment confirmation — *backend sub-project*
3. Smart contract audit — *pre-mainnet gate*
4. ✅ SunSwap V2 auto-unwrap method — *resolved in contract spec*
5. Tune fee `rate`, buffer, min-swap-amount against live data — *post-launch*
