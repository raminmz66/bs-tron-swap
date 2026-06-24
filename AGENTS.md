# Agent Context — Zero-TRX USDT→TRX Swap dApp

Standing context for any AI agent (Claude Code, Cursor, etc.) working in this repo.
Read this first. It carries the durable facts that the per-task plans assume.

## Project shape

Three sub-projects, built in dependency order — **contract → backend → frontend**.
Each runs its own cycle: brainstorm → spec → plan → build (TDD) → verify. Only one
is in flight at a time; each depends on the interface defined by the prior one.

Source of truth (always current):
- `docs/ROADMAP.md` — status board + handoff protocol
- `docs/superpowers/specs/` — design spec per sub-project
- `docs/superpowers/plans/` — implementation plan per sub-project
- `docs/zero-trx-swap-architecture.md` — locked system architecture

## Workflow (token-efficient handoff)

Claude Code (Opus 4.8) does brainstorm → spec → plan. Cursor AUTO executes plans.
Git is the bus. Pull before starting, push when finishing, never edit concurrently.
Record plan deviations in commit messages. See `docs/ROADMAP.md` § Handoff protocol.

## Contract sub-project — execution facts

These are the constraints the contract plan depends on. Do not change them.

### Testing: Nile testnet only — NO local node
- Tests run against the public Nile testnet: `npx tronbox test --network nile`.
- Do NOT start Docker or any local TRON node. The `tronbox/tre` image is arm64-only;
  this host is amd64, and under QEMU it is unusably slow (~5.6s/RPC call) and its
  account-seeding fails.
- The `nile` network's `privateKey` is an ARRAY of pre-funded keys → these become
  `accounts[0..5]` in tests (a public testnet has no pre-unlocked accounts).
- **The faucet step requires a human** (captcha). Generate accounts, then STOP and
  ask the user to fund `accounts[0]` at https://nileex.io/join/getJoinPage before
  running any test.
- `MockUSDT.mint` is permissionless, so unit tests need no real faucet USDT — only
  the integration test (Task 8) uses real Nile USDT.
- Expect ~3s per transaction; slow test runs are normal, not a hang.

### Version pins (do not "upgrade")
- Solidity **0.8.18** — avoids the `PUSH0` opcode the TVM rejects (≥0.8.20 emits it).
- OpenZeppelin Contracts **4.9.6** — v5 requires ^0.8.20 (PUSH0 problem).
- All USDT transfers/approvals go through **SafeERC20** (Tether returns no bool).

### After execution
Record the deployed Nile contract address + final ABI in `docs/deployments.md` so the
backend sub-project can reference them.

## Backend / frontend sub-projects
Not yet specced. When they start, their execution facts (stack, env vars, endpoints)
get added here and to their own spec/plan files.

## Conventions
- Keep `docs/ROADMAP.md` status current — tick each task/step as it completes and
  commit the roadmap alongside the work.
- Never commit `.env` (it holds private keys, even if testnet-only). `.env.example`
  and `scripts/` are tracked.
- Commit messages end with the Co-Authored-By trailer for the authoring model.
