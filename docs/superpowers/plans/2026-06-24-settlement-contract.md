# Settlement Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, test, and testnet-deploy the `SwapSettlement` Solidity/TVM contract that atomically pulls a user's USDT, forwards a fee to the treasury, swaps the remainder to native TRX via SunSwap V2, and delivers it to the user — in one transaction.

**Architecture:** A single non-upgradeable contract `SwapSettlement` inheriting OpenZeppelin `Ownable2Step`, `Pausable`, and `ReentrancyGuard`. It is the on-chain source of truth for the USDT fee split. Only a designated `executor` (the backend hot wallet) may call `settle()`. The contract is the first of three sub-projects (contract → backend → frontend); it defines the interface the backend will later call. Built and unit-tested locally against mock USDT/router contracts, then integration-tested on Nile testnet against the real SunSwap V2 router.

**Tech Stack:** Solidity `0.8.18`, TronBox (Truffle-style framework for TVM), OpenZeppelin Contracts `4.9.6`, Docker (`tronbox/tre` local node), Mocha/Chai (TronBox's built-in test runner), `dotenv` for key/config management.

**Source spec:** `docs/superpowers/specs/2026-06-19-settlement-contract-design.md`

## Global Constraints

These apply to every task. Exact values copied from the spec.

- **Solidity version: exactly `0.8.18`.** This targets the Paris EVM (no `PUSH0` opcode), which the TVM does not support. Do NOT use ≥0.8.20 unless `evmVersion: 'paris'` is also pinned.
- **OpenZeppelin Contracts: exactly `4.9.6`.** v5.x requires `^0.8.20` (PUSH0 problem). In 4.9.6, `Ownable`'s constructor takes NO argument (deployer becomes owner by default).
- **All USDT movements MUST use `SafeERC20`** (`safeTransfer`, `safeTransferFrom`, `forceApprove`). Never `require(token.transferFrom(...))` — Tether returns no bool.
- **Never hardcode private keys.** All keys and network-specific addresses come from environment variables via `dotenv`.
- **Fee model (example/default values):** `minFee = 4_000_000` (4 USDT, 6 decimals), `feeBps = 60` (0.6%), `maxFeeBps = 800` (8%), `minSwapAmount = 50_000_000` (50 USDT). Constraint: `minSwapAmount >= minFee × 10000 / maxFeeBps`.
- **Fee formula:** `feeUSDT = max(minFee, totalUSDT × feeBps / 10000)`, `swapUSDT = totalUSDT − feeUSDT`.
- **`maxFeeBps` enforced at setter time only** (in `setFeeBps`/`setMaxFeeBps`/constructor), never per-transaction inside `settle()`.
- **Units:** USDT in 6-decimal base units; TRX (`minTRXOut`, `trxOut`) in SUN (6-decimal base unit of TRX).
- **Non-upgradeable.** No proxy. Mandatory professional audit before mainnet (out of scope for this plan).
- **Known external addresses:**

  | | Mainnet | Nile testnet |
  |---|---|---|
  | SunSwap V2 Router | `TNJVzGqKBWkJxJB5XYSqGAwUTV15U24pPq` | `TMn1qrmYUMSTXo9babrJLzepKZoPC7M6Sy` |
  | WTRX | `TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR` | `TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a` |
  | USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | obtain from Nile faucet → `NILE_USDT_ADDRESS` env var |

---

### Task 1: Scaffold the TronBox project

**Files:**
- Create: `tronbox.js`
- Create: `.env.example`
- Create: `package.json` (via npm)
- Modify: `.gitignore`
- Create: `contracts/.gitkeep` (TronBox `init` provides `contracts/Migrations.sol`; keep it)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a compilable TronBox project. Solidity compiler pinned to `0.8.18`. Network definitions `development` (local TRE, `http://127.0.0.1:9090`), `nile` (`https://nile.trongrid.io`), `mainnet` (`https://api.trongrid.io`).

- [ ] **Step 1: Initialize the project and install dependencies**

```bash
cd /var/www/html/my-repos/bs-tron-swap
npm init -y
npm install --save-dev tronbox
npx tronbox init
npm install @openzeppelin/contracts@4.9.6
npm install --save-dev dotenv
```

`npx tronbox init` scaffolds `contracts/`, `migrations/`, `test/`, and a default config. If it refuses because the directory is non-empty, run `npx tronbox init --force` (it only overwrites TronBox's own scaffold files; our `docs/` are untouched).

- [ ] **Step 2: Write `tronbox.js`**

Replace the generated `tronbox.js` with:

```javascript
require('dotenv').config();

module.exports = {
  networks: {
    development: {
      privateKey: process.env.PRIVATE_KEY_DEV,
      userFeePercentage: 0,
      feeLimit: 1000 * 1e6,
      fullHost: 'http://127.0.0.1:9090',
      network_id: '*',
    },
    nile: {
      privateKey: process.env.PRIVATE_KEY_NILE,
      userFeePercentage: 100,
      feeLimit: 1000 * 1e6,
      fullHost: 'https://nile.trongrid.io',
      network_id: '3',
    },
    mainnet: {
      privateKey: process.env.PRIVATE_KEY_MAINNET,
      userFeePercentage: 100,
      feeLimit: 1000 * 1e6,
      fullHost: 'https://api.trongrid.io',
      network_id: '1',
    },
  },
  compilers: {
    solc: {
      version: '0.8.18',
      settings: {
        optimizer: { enabled: true, runs: 200 },
      },
    },
  },
};
```

- [ ] **Step 3: Write `.env.example`**

```bash
# Local TRE node — use one of the pre-funded private keys printed by the docker container
PRIVATE_KEY_DEV=

# Nile testnet — the key for an address funded from https://nileex.io/join/getJoinPage
PRIVATE_KEY_NILE=
# USDT TRC-20 address on Nile (obtain test USDT from the faucet, then read its contract address)
NILE_USDT_ADDRESS=
# Cold-key (owner/treasury) and backend hot-wallet (executor) addresses for Nile deploy
NILE_OWNER_ADDRESS=
NILE_EXECUTOR_ADDRESS=

# Mainnet — DO NOT commit. Cold key stays offline; this is only set transiently at deploy time.
PRIVATE_KEY_MAINNET=
MAINNET_OWNER_ADDRESS=
MAINNET_EXECUTOR_ADDRESS=
```

- [ ] **Step 4: Update `.gitignore`**

Append these lines (do not remove existing entries):

```
node_modules/
build/
.env
```

- [ ] **Step 5: Compile to verify the toolchain works**

Run: `npx tronbox compile`
Expected: compiles `Migrations.sol` with solc `0.8.18`, writes artifacts to `build/contracts/`, no errors.

- [ ] **Step 6: Commit**

```bash
git add tronbox.js .env.example .gitignore package.json package-lock.json contracts/ migrations/
git commit -m "chore: scaffold TronBox project (solc 0.8.18, OZ 4.9.6)"
```

---

### Task 2: Test infrastructure — router interface and mock contracts

**Files:**
- Create: `contracts/interfaces/ISunswapV2Router.sol`
- Create: `contracts/mocks/MockUSDT.sol`
- Create: `contracts/mocks/MockRouter.sol`
- Test: `test/mocks.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `ISunswapV2Router.swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) returns (uint256[] memory amounts)`
  - `MockUSDT`: Tether-like token returning NO bool. Methods: `mint(address,uint256)`, `transfer(address,uint256)`, `transferFrom(address,address,uint256)`, `approve(address,uint256)`, `balanceOf(address) view returns (uint256)`, `allowance(address,address) view returns (uint256)`, `decimals() view returns (uint8)` (=6).
  - `MockRouter`: implements `ISunswapV2Router`. `setRate(uint256 numerator,uint256 denominator)` controls output; pulls `path[0]` tokens from caller via `transferFrom`, enforces `amountOut >= amountOutMin`, sends native TRX to `to`. Has `receive() external payable`. Default rate 1:1.

- [ ] **Step 1: Write the router interface**

`contracts/interfaces/ISunswapV2Router.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

interface ISunswapV2Router {
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}
```

- [ ] **Step 2: Write `MockUSDT` (mimics Tether's non-standard ABI — no bool return)**

`contracts/mocks/MockUSDT.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

// Deliberately mirrors real USDT (TetherToken): transfer/transferFrom/approve
// return NO boolean. This exercises SafeERC20's no-returndata code path.
contract MockUSDT {
    string public name = "Mock Tether";
    string public symbol = "USDT";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external {
        _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "USDT: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "USDT: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
```

- [ ] **Step 3: Write `MockRouter`**

`contracts/mocks/MockRouter.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../interfaces/ISunswapV2Router.sol";

interface IMockToken {
    function transferFrom(address from, address to, uint256 amount) external;
}

// Minimal SunSwap V2 router stand-in. Pulls input token from the caller,
// enforces the slippage floor, and delivers native TRX to `to`.
// Must be funded with TRX before use (see test before() hook).
contract MockRouter is ISunswapV2Router {
    uint256 public rateNumerator = 1;   // out = in * num / den
    uint256 public rateDenominator = 1;

    receive() external payable {}

    function setRate(uint256 numerator, uint256 denominator) external {
        require(denominator != 0, "MockRouter: zero denominator");
        rateNumerator = numerator;
        rateDenominator = denominator;
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "MockRouter: EXPIRED");
        IMockToken(path[0]).transferFrom(msg.sender, address(this), amountIn);

        uint256 amountOut = (amountIn * rateNumerator) / rateDenominator;
        require(amountOut >= amountOutMin, "MockRouter: INSUFFICIENT_OUTPUT_AMOUNT");

        (bool ok, ) = payable(to).call{value: amountOut}("");
        require(ok, "MockRouter: TRX transfer failed");

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;
        return amounts;
    }
}
```

- [ ] **Step 4: Write a sanity test for the mocks**

`test/mocks.test.js`:

```javascript
const MockUSDT = artifacts.require('MockUSDT');
const MockRouter = artifacts.require('MockRouter');

contract('mocks', (accounts) => {
  it('MockUSDT mints and transfers without returning a bool', async () => {
    const usdt = await MockUSDT.new();
    await usdt.mint(accounts[0], '1000000');
    await usdt.transfer(accounts[1], '400000', { from: accounts[0] });
    assert.equal((await usdt.balanceOf(accounts[0])).toString(), '600000');
    assert.equal((await usdt.balanceOf(accounts[1])).toString(), '400000');
  });

  it('MockRouter delivers native TRX to the recipient and enforces slippage', async () => {
    const usdt = await MockUSDT.new();
    const router = await MockRouter.new();
    // fund the router with 100 TRX so it can pay out
    await tronWeb.trx.sendTransaction(router.address, 100 * 1e6);

    await usdt.mint(accounts[0], '1000000');
    await usdt.approve(router.address, '1000000', { from: accounts[0] });

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const before = await tronWeb.trx.getBalance(accounts[2]);
    await router.swapExactTokensForETH('1000000', '1000000', [usdt.address, accounts[3]], accounts[2], deadline, { from: accounts[0] });
    const after = await tronWeb.trx.getBalance(accounts[2]);
    assert.equal(after - before, 1000000, 'recipient should receive 1:1 TRX');

    // slippage: demand more than the 1:1 rate produces → revert
    await usdt.approve(router.address, '1000000', { from: accounts[0] });
    try {
      await router.swapExactTokensForETH('1000000', '2000000', [usdt.address, accounts[3]], accounts[2], deadline, { from: accounts[0] });
      assert.fail('expected slippage revert');
    } catch (err) {
      assert(/INSUFFICIENT_OUTPUT_AMOUNT|REVERT|revert/i.test(err.message || String(err)));
    }
  });
});
```

- [ ] **Step 5: Start the local node and run the test**

In a separate terminal, start the local TRE node (leave it running for all subsequent test tasks):

```bash
docker run -it -p 9090:9090 --rm --name tron tronbox/tre
```

The container prints ~10 pre-funded accounts with their private keys. Copy the first private key into `.env` as `PRIVATE_KEY_DEV`. Then:

```bash
npx tronbox test ./test/mocks.test.js --network development
```

Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add contracts/interfaces/ contracts/mocks/ test/mocks.test.js
git commit -m "test: add router interface and mock USDT/router for unit tests"
```

---

### Task 3: `SwapSettlement` skeleton + fee logic (`quoteSettle`)

**Files:**
- Create: `contracts/SwapSettlement.sol`
- Test: `test/quoteSettle.test.js`

**Interfaces:**
- Consumes: `ISunswapV2Router` (Task 2)
- Produces:
  - Constructor `(address _usdt, address _router, address _wtrx, address _owner, address _executor, uint256 _minFee, uint256 _feeBps, uint256 _maxFeeBps, uint256 _minSwapAmount)`
  - Public state: `USDT`, `ROUTER`, `WTRX` (immutable), `executor`, `minFee`, `feeBps`, `maxFeeBps`, `minSwapAmount`, `usedSwapIds(bytes32) view returns (bool)`
  - `quoteSettle(uint256 totalUSDT) external view returns (uint256 feeUSDT, uint256 swapUSDT)`
  - Inherited: `owner()`, `pendingOwner()`, `paused()`
  - `modifier onlyExecutor`
  - Internal `_computeFee(uint256) returns (uint256 feeUSDT, uint256 swapUSDT)`

- [ ] **Step 1: Write the compilable skeleton (storage + constructor + modifier, no business methods yet)**

`contracts/SwapSettlement.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./interfaces/ISunswapV2Router.sol";

contract SwapSettlement is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS_DENOMINATOR = 10000;

    address public immutable USDT;
    address public immutable ROUTER;
    address public immutable WTRX;

    address public executor;
    uint256 public minFee;
    uint256 public feeBps;
    uint256 public maxFeeBps;
    uint256 public minSwapAmount;

    mapping(bytes32 => bool) public usedSwapIds;

    event Settled(bytes32 indexed swapId, address indexed user, uint256 totalUSDT, uint256 feeUSDT, uint256 trxOut);
    event ExecutorChanged(address indexed newExecutor);
    event FeeParamsUpdated(uint256 minFee, uint256 feeBps, uint256 maxFeeBps, uint256 minSwapAmount);

    modifier onlyExecutor() {
        require(msg.sender == executor, "SwapSettlement: not executor");
        _;
    }

    constructor(
        address _usdt,
        address _router,
        address _wtrx,
        address _owner,
        address _executor,
        uint256 _minFee,
        uint256 _feeBps,
        uint256 _maxFeeBps,
        uint256 _minSwapAmount
    ) {
        require(_usdt != address(0) && _router != address(0) && _wtrx != address(0), "SwapSettlement: zero address");
        require(_owner != address(0) && _executor != address(0), "SwapSettlement: zero address");
        require(_maxFeeBps <= BPS_DENOMINATOR, "SwapSettlement: maxFeeBps too high");
        require(_feeBps <= _maxFeeBps, "SwapSettlement: feeBps over max");

        USDT = _usdt;
        ROUTER = _router;
        WTRX = _wtrx;
        executor = _executor;
        minFee = _minFee;
        feeBps = _feeBps;
        maxFeeBps = _maxFeeBps;
        minSwapAmount = _minSwapAmount;

        _transferOwnership(_owner); // override Ownable's default (deployer) with the cold key
    }
}
```

- [ ] **Step 2: Compile to verify the skeleton builds**

Run: `npx tronbox compile`
Expected: `SwapSettlement.sol` compiles with no errors (OZ imports resolve from `node_modules`).

- [ ] **Step 3: Write the failing test for `quoteSettle`**

`test/quoteSettle.test.js`:

```javascript
const SwapSettlement = artifacts.require('SwapSettlement');
const MockUSDT = artifacts.require('MockUSDT');
const MockRouter = artifacts.require('MockRouter');

// constructor fee params used across tests
const MIN_FEE = '4000000';      // 4 USDT
const FEE_BPS = '60';           // 0.6%
const MAX_FEE_BPS = '800';      // 8%
const MIN_SWAP = '50000000';    // 50 USDT

async function deploy(accounts) {
  const usdt = await MockUSDT.new();
  const router = await MockRouter.new();
  const wtrx = accounts[9]; // any non-zero address stands in for WTRX in unit tests
  const settlement = await SwapSettlement.new(
    usdt.address, router.address, wtrx,
    accounts[1],            // owner (cold key / treasury)
    accounts[0],            // executor (backend hot wallet)
    MIN_FEE, FEE_BPS, MAX_FEE_BPS, MIN_SWAP
  );
  return { usdt, router, settlement };
}

contract('SwapSettlement.quoteSettle', (accounts) => {
  it('applies the percentage rate when it exceeds the floor', async () => {
    const { settlement } = await deploy(accounts);
    // 1000 USDT * 0.6% = 6 USDT fee
    const q = await settlement.quoteSettle('1000000000');
    assert.equal(q.feeUSDT.toString(), '6000000');
    assert.equal(q.swapUSDT.toString(), '994000000');
  });

  it('applies the minimum fee floor on small swaps', async () => {
    const { settlement } = await deploy(accounts);
    // 100 USDT * 0.6% = 0.6 USDT, below 4 USDT floor → fee = 4 USDT
    const q = await settlement.quoteSettle('100000000');
    assert.equal(q.feeUSDT.toString(), '4000000');
    assert.equal(q.swapUSDT.toString(), '96000000');
  });

  it('exposes constructor-set state', async () => {
    const { settlement, usdt, router } = await deploy(accounts);
    assert.equal((await settlement.minFee()).toString(), MIN_FEE);
    assert.equal((await settlement.feeBps()).toString(), FEE_BPS);
    assert.equal((await settlement.maxFeeBps()).toString(), MAX_FEE_BPS);
    assert.equal((await settlement.minSwapAmount()).toString(), MIN_SWAP);
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

Run: `npx tronbox test ./test/quoteSettle.test.js --network development`
Expected: FAIL — `settlement.quoteSettle is not a function` (method not yet implemented).

- [ ] **Step 5: Implement `_computeFee` and `quoteSettle`**

Add these methods inside `SwapSettlement` (after the constructor):

```solidity
    function _computeFee(uint256 totalUSDT) internal view returns (uint256 feeUSDT, uint256 swapUSDT) {
        uint256 pctFee = (totalUSDT * feeBps) / BPS_DENOMINATOR;
        feeUSDT = pctFee > minFee ? pctFee : minFee;
        require(feeUSDT < totalUSDT, "SwapSettlement: fee >= total");
        swapUSDT = totalUSDT - feeUSDT;
    }

    function quoteSettle(uint256 totalUSDT) external view returns (uint256 feeUSDT, uint256 swapUSDT) {
        return _computeFee(totalUSDT);
    }
```

- [ ] **Step 6: Run the test to confirm it passes**

Run: `npx tronbox test ./test/quoteSettle.test.js --network development`
Expected: all three tests PASS.

- [ ] **Step 7: Commit**

```bash
git add contracts/SwapSettlement.sol test/quoteSettle.test.js
git commit -m "feat: SwapSettlement skeleton with on-chain fee split (quoteSettle)"
```

---

### Task 4: `settle()` happy path

**Files:**
- Modify: `contracts/SwapSettlement.sol`
- Test: `test/settle.test.js`

**Interfaces:**
- Consumes: `_computeFee` (Task 3), `MockUSDT`, `MockRouter` (Task 2)
- Produces: `settle(bytes32 swapId, address user, uint256 totalUSDT, uint256 minTRXOut, uint256 deadline) external returns (uint256 trxOut)` — `onlyExecutor whenNotPaused nonReentrant`. Pulls `totalUSDT` from `user` via `safeTransferFrom`, sends `feeUSDT` to `owner()` via `safeTransfer`, `forceApprove`s the router for `swapUSDT`, swaps `[USDT, WTRX]` delivering TRX to `user`, marks `usedSwapIds[swapId]`, emits `Settled`.

- [ ] **Step 1: Write the failing happy-path test**

`test/settle.test.js`:

```javascript
const SwapSettlement = artifacts.require('SwapSettlement');
const MockUSDT = artifacts.require('MockUSDT');
const MockRouter = artifacts.require('MockRouter');

const MIN_FEE = '4000000';
const FEE_BPS = '60';
const MAX_FEE_BPS = '800';
const MIN_SWAP = '50000000';

// accounts: [0]=executor, [1]=owner/treasury, [2]=user, [9]=wtrx placeholder
async function deployWired(accounts) {
  const usdt = await MockUSDT.new();
  const router = await MockRouter.new();
  const settlement = await SwapSettlement.new(
    usdt.address, router.address, accounts[9],
    accounts[1], accounts[0],
    MIN_FEE, FEE_BPS, MAX_FEE_BPS, MIN_SWAP
  );
  await tronWeb.trx.sendTransaction(router.address, 1000 * 1e6); // fund router with TRX
  return { usdt, router, settlement };
}

function swapId(n) {
  // 32-byte hex id
  return '0x' + n.toString(16).padStart(64, '0');
}

contract('SwapSettlement.settle (happy path)', (accounts) => {
  const [executor, owner, user] = accounts;

  it('pulls USDT, pays fee to owner, swaps remainder, delivers TRX, marks swapId', async () => {
    const { usdt, router, settlement } = await deployWired(accounts);
    const total = '1000000000'; // 1000 USDT
    // expected: fee = 6 USDT, swap = 994 USDT, TRX out = 994 USDT-units (1:1 mock rate)

    await usdt.mint(user, total);
    await usdt.approve(settlement.address, total, { from: user });

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const userTrxBefore = await tronWeb.trx.getBalance(user);

    await settlement.settle(swapId(1), user, total, '994000000', deadline, { from: executor });

    // USDT accounting
    assert.equal((await usdt.balanceOf(user)).toString(), '0', 'user USDT fully pulled');
    assert.equal((await usdt.balanceOf(owner)).toString(), '6000000', 'owner received fee');
    assert.equal((await usdt.balanceOf(router.address)).toString(), '994000000', 'router received swap amount');

    // TRX delivered to user (user sent no tx, so delta is exactly the payout)
    const userTrxAfter = await tronWeb.trx.getBalance(user);
    assert.equal(userTrxAfter - userTrxBefore, 994000000, 'user received TRX');

    // idempotency marker set
    assert.equal(await settlement.usedSwapIds(swapId(1)), true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npx tronbox test ./test/settle.test.js --network development`
Expected: FAIL — `settlement.settle is not a function`.

- [ ] **Step 3: Implement `settle()`**

Add inside `SwapSettlement` (after `quoteSettle`):

```solidity
    function settle(
        bytes32 swapId,
        address user,
        uint256 totalUSDT,
        uint256 minTRXOut,
        uint256 deadline
    ) external onlyExecutor whenNotPaused nonReentrant returns (uint256 trxOut) {
        require(!usedSwapIds[swapId], "SwapSettlement: swapId used");
        usedSwapIds[swapId] = true;

        require(totalUSDT >= minSwapAmount, "SwapSettlement: below min swap");

        (uint256 feeUSDT, uint256 swapUSDT) = _computeFee(totalUSDT);

        IERC20(USDT).safeTransferFrom(user, address(this), totalUSDT);
        IERC20(USDT).safeTransfer(owner(), feeUSDT);
        IERC20(USDT).forceApprove(ROUTER, swapUSDT);

        address[] memory path = new address[](2);
        path[0] = USDT;
        path[1] = WTRX;

        uint256[] memory amounts = ISunswapV2Router(ROUTER).swapExactTokensForETH(
            swapUSDT,
            minTRXOut,
            path,
            user,
            deadline
        );
        trxOut = amounts[amounts.length - 1];

        emit Settled(swapId, user, totalUSDT, feeUSDT, trxOut);
    }
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx tronbox test ./test/settle.test.js --network development`
Expected: PASS. (This test also proves `SafeERC20` works against `MockUSDT`'s non-bool-returning ABI, since every USDT move goes through the safe wrappers.)

- [ ] **Step 5: Commit**

```bash
git add contracts/SwapSettlement.sol test/settle.test.js
git commit -m "feat: implement atomic settle() happy path"
```

---

### Task 5: `settle()` guards and revert behavior

**Files:**
- Modify: `contracts/SwapSettlement.sol` (adds `pause`/`unpause` wrappers; the guards themselves already exist on `settle`)
- Test: `test/settle-guards.test.js`

**Interfaces:**
- Consumes: `settle` (Task 4), `pause`/`unpause` (added here if not present), `MockRouter.setRate`
- Produces: verified revert semantics for idempotency, below-minimum, non-executor caller, paused state, slippage, and insufficient-balance. Adds `pause()`/`unpause()` if Task 6 hasn't run yet (see note).

> **Note on ordering:** `settle` uses the `whenNotPaused` modifier, which needs `pause()`/`unpause()` wrappers to be testable. If executing tasks in order, add the two wrappers below as Step 1 here; Task 6 will then only ADD the fee/executor/ownership setters. If they already exist, skip Step 1.

- [ ] **Step 1: Add `pause`/`unpause` wrappers (if not already present)**

Add inside `SwapSettlement`:

```solidity
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
```

- [ ] **Step 2: Write the guard tests (failing where behavior is missing)**

`test/settle-guards.test.js`:

```javascript
const SwapSettlement = artifacts.require('SwapSettlement');
const MockUSDT = artifacts.require('MockUSDT');
const MockRouter = artifacts.require('MockRouter');

const MIN_FEE = '4000000';
const FEE_BPS = '60';
const MAX_FEE_BPS = '800';
const MIN_SWAP = '50000000';

async function deployWired(accounts) {
  const usdt = await MockUSDT.new();
  const router = await MockRouter.new();
  const settlement = await SwapSettlement.new(
    usdt.address, router.address, accounts[9],
    accounts[1], accounts[0],
    MIN_FEE, FEE_BPS, MAX_FEE_BPS, MIN_SWAP
  );
  await tronWeb.trx.sendTransaction(router.address, 1000 * 1e6);
  return { usdt, router, settlement };
}

const id = (n) => '0x' + n.toString(16).padStart(64, '0');
const reverted = (err) => /REVERT|revert|failed/i.test(err.message || String(err));

contract('SwapSettlement.settle (guards)', (accounts) => {
  const [executor, owner, user, stranger] = accounts;
  const deadline = () => Math.floor(Date.now() / 1000) + 3600;

  async function fundAndApprove(usdt, settlement, amount) {
    await usdt.mint(user, amount);
    await usdt.approve(settlement.address, amount, { from: user });
  }

  it('reverts a reused swapId', async () => {
    const { usdt, settlement } = await deployWired(accounts);
    await fundAndApprove(usdt, settlement, '100000000');
    await settlement.settle(id(1), user, '100000000', '0', deadline(), { from: executor });
    await usdt.mint(user, '100000000');
    await usdt.approve(settlement.address, '100000000', { from: user });
    try {
      await settlement.settle(id(1), user, '100000000', '0', deadline(), { from: executor });
      assert.fail('expected reused-swapId revert');
    } catch (err) { assert(reverted(err)); }
  });

  it('reverts below the minimum swap amount', async () => {
    const { usdt, settlement } = await deployWired(accounts);
    await fundAndApprove(usdt, settlement, '10000000'); // 10 USDT < 50 USDT min
    try {
      await settlement.settle(id(2), user, '10000000', '0', deadline(), { from: executor });
      assert.fail('expected below-min revert');
    } catch (err) { assert(reverted(err)); }
  });

  it('reverts when called by a non-executor', async () => {
    const { usdt, settlement } = await deployWired(accounts);
    await fundAndApprove(usdt, settlement, '100000000');
    try {
      await settlement.settle(id(3), user, '100000000', '0', deadline(), { from: stranger });
      assert.fail('expected onlyExecutor revert');
    } catch (err) { assert(reverted(err)); }
  });

  it('reverts when paused, succeeds after unpause', async () => {
    const { usdt, settlement } = await deployWired(accounts);
    await settlement.pause({ from: owner });
    await fundAndApprove(usdt, settlement, '100000000');
    try {
      await settlement.settle(id(4), user, '100000000', '0', deadline(), { from: executor });
      assert.fail('expected whenNotPaused revert');
    } catch (err) { assert(reverted(err)); }
    await settlement.unpause({ from: owner });
    await settlement.settle(id(4), user, '100000000', '0', deadline(), { from: executor });
    assert.equal(await settlement.usedSwapIds(id(4)), true);
  });

  it('reverts on slippage (router output below minTRXOut)', async () => {
    const { usdt, router, settlement } = await deployWired(accounts);
    await router.setRate('1', '2'); // output = half of input
    await fundAndApprove(usdt, settlement, '100000000');
    // swapUSDT = 96 USDT, output = 48 USDT-units, demand 96 → revert
    try {
      await settlement.settle(id(5), user, '100000000', '96000000', deadline(), { from: executor });
      assert.fail('expected slippage revert');
    } catch (err) { assert(reverted(err)); }
    // whole tx reverted: user keeps USDT, swapId NOT consumed
    assert.equal((await usdt.balanceOf(user)).toString(), '100000000');
    assert.equal(await settlement.usedSwapIds(id(5)), false);
  });

  it('reverts when the user has not approved enough USDT', async () => {
    const { usdt, settlement } = await deployWired(accounts);
    await usdt.mint(user, '100000000');
    await usdt.approve(settlement.address, '1', { from: user }); // far too little
    try {
      await settlement.settle(id(6), user, '100000000', '0', deadline(), { from: executor });
      assert.fail('expected allowance revert');
    } catch (err) { assert(reverted(err)); }
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx tronbox test ./test/settle-guards.test.js --network development`
Expected: all six tests PASS. The slippage test confirms the spec's key guarantee — on revert the user keeps their USDT and the `swapId` is freed for retry.

- [ ] **Step 4: Commit**

```bash
git add contracts/SwapSettlement.sol test/settle-guards.test.js
git commit -m "feat: pause wrappers + test settle() guards (idempotency, min, executor, pause, slippage, allowance)"
```

---

### Task 6: Admin functions — fee setters, executor rotation, two-step ownership

**Files:**
- Modify: `contracts/SwapSettlement.sol`
- Test: `test/admin.test.js`

**Interfaces:**
- Consumes: constructor + state (Task 3), `quoteSettle` (Task 3)
- Produces:
  - `setMinFee(uint256)`, `setFeeBps(uint256)`, `setMaxFeeBps(uint256)`, `setMinSwapAmount(uint256)` — all `onlyOwner`, each emits `FeeParamsUpdated`. `setFeeBps` reverts if `> maxFeeBps`; `setMaxFeeBps` reverts if `< feeBps` or `> 10000`.
  - `setExecutor(address)` — `onlyOwner`, non-zero, emits `ExecutorChanged`.
  - Two-step ownership via inherited `Ownable2Step`: `transferOwnership(address)` (onlyOwner, sets `pendingOwner`), `acceptOwnership()` (only pendingOwner).

- [ ] **Step 1: Write the failing admin tests**

`test/admin.test.js`:

```javascript
const SwapSettlement = artifacts.require('SwapSettlement');
const MockUSDT = artifacts.require('MockUSDT');
const MockRouter = artifacts.require('MockRouter');

const MIN_FEE = '4000000';
const FEE_BPS = '60';
const MAX_FEE_BPS = '800';
const MIN_SWAP = '50000000';

async function deploy(accounts) {
  const usdt = await MockUSDT.new();
  const router = await MockRouter.new();
  return SwapSettlement.new(
    usdt.address, router.address, accounts[9],
    accounts[1], accounts[0],
    MIN_FEE, FEE_BPS, MAX_FEE_BPS, MIN_SWAP
  );
}
const reverted = (err) => /REVERT|revert|failed/i.test(err.message || String(err));

contract('SwapSettlement.admin', (accounts) => {
  const [executor, owner, , , newExecutor, newOwner] = accounts;

  it('owner can raise minFee and it shows in quoteSettle', async () => {
    const s = await deploy(accounts);
    await s.setMinFee('8000000', { from: owner }); // 8 USDT floor
    const q = await s.quoteSettle('100000000');    // 0.6% of 100 = 0.6 < 8 → 8
    assert.equal(q.feeUSDT.toString(), '8000000');
  });

  it('non-owner cannot change fee params', async () => {
    const s = await deploy(accounts);
    try { await s.setMinFee('8000000', { from: executor }); assert.fail('expected onlyOwner revert'); }
    catch (err) { assert(reverted(err)); }
  });

  it('setFeeBps rejects a rate above maxFeeBps', async () => {
    const s = await deploy(accounts);
    try { await s.setFeeBps('801', { from: owner }); assert.fail('expected over-max revert'); }
    catch (err) { assert(reverted(err)); }
    await s.setFeeBps('100', { from: owner }); // 1% ≤ 8% ok
    assert.equal((await s.feeBps()).toString(), '100');
  });

  it('setMaxFeeBps rejects a ceiling below current feeBps', async () => {
    const s = await deploy(accounts);
    try { await s.setMaxFeeBps('59', { from: owner }); assert.fail('expected below-feeBps revert'); }
    catch (err) { assert(reverted(err)); }
  });

  it('rotates the executor', async () => {
    const s = await deploy(accounts);
    await s.setExecutor(newExecutor, { from: owner });
    assert.equal(tronWeb.address.fromHex(await s.executor()), tronWeb.address.fromHex(newExecutor));
  });

  it('two-step ownership: transfer does not grant control until accepted', async () => {
    const s = await deploy(accounts);
    await s.transferOwnership(newOwner, { from: owner });
    // pending set, but old owner still in control
    assert.equal(tronWeb.address.fromHex(await s.pendingOwner()), tronWeb.address.fromHex(newOwner));
    assert.equal(tronWeb.address.fromHex(await s.owner()), tronWeb.address.fromHex(owner));
    // a non-pending account cannot accept
    try { await s.acceptOwnership({ from: executor }); assert.fail('expected non-pending revert'); }
    catch (err) { assert(reverted(err)); }
    // pending owner accepts → control transfers
    await s.acceptOwnership({ from: newOwner });
    assert.equal(tronWeb.address.fromHex(await s.owner()), tronWeb.address.fromHex(newOwner));
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx tronbox test ./test/admin.test.js --network development`
Expected: FAIL — `setMinFee`/`setExecutor` not functions (ownership tests may already pass via inherited `Ownable2Step`).

- [ ] **Step 3: Implement the setters**

Add inside `SwapSettlement` (after `unpause`):

```solidity
    function setMinFee(uint256 _minFee) external onlyOwner {
        minFee = _minFee;
        emit FeeParamsUpdated(minFee, feeBps, maxFeeBps, minSwapAmount);
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= maxFeeBps, "SwapSettlement: feeBps over max");
        feeBps = _feeBps;
        emit FeeParamsUpdated(minFee, feeBps, maxFeeBps, minSwapAmount);
    }

    function setMaxFeeBps(uint256 _maxFeeBps) external onlyOwner {
        require(_maxFeeBps <= BPS_DENOMINATOR, "SwapSettlement: maxFeeBps too high");
        require(_maxFeeBps >= feeBps, "SwapSettlement: max below feeBps");
        maxFeeBps = _maxFeeBps;
        emit FeeParamsUpdated(minFee, feeBps, maxFeeBps, minSwapAmount);
    }

    function setMinSwapAmount(uint256 _minSwapAmount) external onlyOwner {
        minSwapAmount = _minSwapAmount;
        emit FeeParamsUpdated(minFee, feeBps, maxFeeBps, minSwapAmount);
    }

    function setExecutor(address _executor) external onlyOwner {
        require(_executor != address(0), "SwapSettlement: zero address");
        executor = _executor;
        emit ExecutorChanged(_executor);
    }
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx tronbox test ./test/admin.test.js --network development`
Expected: all six tests PASS.

- [ ] **Step 5: Run the full suite**

Run: `npx tronbox test --network development`
Expected: every test from Tasks 2–6 PASSES.

- [ ] **Step 6: Commit**

```bash
git add contracts/SwapSettlement.sol test/admin.test.js
git commit -m "feat: admin setters (fee params, executor rotation) with bounds"
```

---

### Task 7: Network-aware migration + local deploy verification

**Files:**
- Create: `migrations/2_deploy_settlement.js`
- Test: manual deploy against the local TRE node

**Interfaces:**
- Consumes: `SwapSettlement`, `MockUSDT`, `MockRouter` constructors
- Produces: a migration that, on `development`, deploys mocks + a wired `SwapSettlement`; on `nile`/`mainnet`, deploys only `SwapSettlement` against real addresses from env vars.

- [ ] **Step 1: Write the migration**

`migrations/2_deploy_settlement.js`:

```javascript
const SwapSettlement = artifacts.require('SwapSettlement');
const MockUSDT = artifacts.require('MockUSDT');
const MockRouter = artifacts.require('MockRouter');

// Fee defaults (override per-network via env if desired)
const MIN_FEE = '4000000';
const FEE_BPS = '60';
const MAX_FEE_BPS = '800';
const MIN_SWAP = '50000000';

const DEPLOY_OPTS = { fee_limit: 1.5e9, userFeePercentage: 100, originEnergyLimit: 1e8 };

module.exports = async function (deployer, network, accounts) {
  if (network === 'development') {
    await deployer.deploy(MockUSDT);
    const usdt = await MockUSDT.deployed();
    await deployer.deploy(MockRouter);
    const router = await MockRouter.deployed();
    await deployer.deploy(
      SwapSettlement,
      usdt.address, router.address, accounts[9],
      accounts[1],  // owner
      accounts[0],  // executor
      MIN_FEE, FEE_BPS, MAX_FEE_BPS, MIN_SWAP,
      DEPLOY_OPTS
    );
    return;
  }

  // nile / mainnet: real addresses from env
  const prefix = network.toUpperCase(); // NILE_ or MAINNET_
  const usdt = process.env[`${prefix}_USDT_ADDRESS`];
  const router = network === 'nile'
    ? 'TMn1qrmYUMSTXo9babrJLzepKZoPC7M6Sy'
    : 'TNJVzGqKBWkJxJB5XYSqGAwUTV15U24pPq';
  const wtrx = network === 'nile'
    ? 'TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a'
    : 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR';
  const owner = process.env[`${prefix}_OWNER_ADDRESS`];
  const executor = process.env[`${prefix}_EXECUTOR_ADDRESS`];

  if (!usdt || !owner || !executor) {
    throw new Error(`Missing env for ${network}: set ${prefix}_USDT_ADDRESS, ${prefix}_OWNER_ADDRESS, ${prefix}_EXECUTOR_ADDRESS`);
  }

  await deployer.deploy(
    SwapSettlement,
    usdt, router, wtrx, owner, executor,
    MIN_FEE, FEE_BPS, MAX_FEE_BPS, MIN_SWAP,
    DEPLOY_OPTS
  );
};
```

- [ ] **Step 2: Deploy to the local node**

Run: `npx tronbox migrate --reset --network development`
Expected: deploys `Migrations`, `MockUSDT`, `MockRouter`, and `SwapSettlement` with no errors; prints the `SwapSettlement` contract address.

- [ ] **Step 3: Sanity-check the deployed contract**

Run: `npx tronbox console --network development`
In the console:

```javascript
const s = await SwapSettlement.deployed();
(await s.minFee()).toString();        // '4000000'
(await s.owner());                    // base58 of accounts[1]
const q = await s.quoteSettle('1000000000'); q.feeUSDT.toString(); // '6000000'
```

Expected: values match. Type `.exit` to leave.

- [ ] **Step 4: Commit**

```bash
git add migrations/2_deploy_settlement.js
git commit -m "feat: network-aware deploy migration (mocks on dev, real addrs on nile/mainnet)"
```

---

### Task 8: Nile testnet integration test + deployment runbook

**Files:**
- Create: `test/integration.nile.js`
- Create: `docs/contract-deployment-runbook.md`

**Interfaces:**
- Consumes: deployed `SwapSettlement` on Nile, real SunSwap V2 router, real Nile USDT
- Produces: a one-shot integration test confirming `swapExactTokensForETH` auto-unwraps WTRX→native TRX against the real router; a written runbook for deploying to Nile and (eventually) mainnet.

> **Prerequisite:** Fund a Nile address from https://nileex.io/join/getJoinPage (also dispenses test USDT). Set `PRIVATE_KEY_NILE`, `NILE_USDT_ADDRESS`, `NILE_OWNER_ADDRESS`, `NILE_EXECUTOR_ADDRESS` in `.env`. For the integration test, set `NILE_EXECUTOR_ADDRESS` to the address controlled by `PRIVATE_KEY_NILE` (so the test can call `settle`), and ensure that address holds test USDT and a little TRX for energy.

- [ ] **Step 1: Deploy to Nile**

Run: `npx tronbox migrate --reset --network nile`
Expected: deploys `SwapSettlement` against the real router/WTRX and your Nile USDT; prints the contract address. Record it.

- [ ] **Step 2: Write the integration test**

`test/integration.nile.js` (run only against `--network nile`):

```javascript
const SwapSettlement = artifacts.require('SwapSettlement');

// Minimal IERC20 surface for the real USDT
const USDT_ABI = [
  { constant: false, inputs: [{ name: '_spender', type: 'address' }, { name: '_value', type: 'uint256' }], name: 'approve', outputs: [], type: 'function' },
  { constant: true, inputs: [{ name: '_owner', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], type: 'function' },
];

const id = (n) => '0x' + n.toString(16).padStart(64, '0');

contract('SwapSettlement integration (Nile)', (accounts) => {
  it('swaps real USDT to native TRX via SunSwap V2 in one tx', async () => {
    const s = await SwapSettlement.deployed();
    const me = tronWeb.defaultAddress.base58; // executor + user are the same funded account here
    const usdt = await tronWeb.contract(USDT_ABI, process.env.NILE_USDT_ADDRESS);

    const total = '60000000'; // 60 USDT (≥ 50 min)
    await usdt.approve(s.address, total).send({ feeLimit: 100e6 });

    const trxBefore = await tronWeb.trx.getBalance(me);
    const deadline = Math.floor(Date.now() / 1000) + 600;

    // minTRXOut = 0 for the smoke test; real backend computes a slippage-guarded value
    await s.settle(id(Date.now()), me, total, '0', deadline, { feeLimit: 300e6 });

    const trxAfter = await tronWeb.trx.getBalance(me);
    // received native TRX minus energy spent should still be net positive vs. just the fee
    assert(trxAfter > trxBefore - 300e6, 'native TRX delivered (auto-unwrapped from WTRX)');
    console.log('TRX delta (SUN):', trxAfter - trxBefore);
  });
});
```

- [ ] **Step 3: Run the integration test against Nile**

Run: `npx tronbox test ./test/integration.nile.js --network nile`
Expected: PASS — confirms the real SunSwap V2 router accepts the `[USDT, WTRX]` path and delivers native TRX (auto-unwrap) in a single `settle()` call. Note the logged TRX delta and the energy consumed (visible on https://nile.tronscan.org for the tx) — this validates the backend's future energy estimates.

- [ ] **Step 4: Write the deployment runbook**

`docs/contract-deployment-runbook.md`:

```markdown
# SwapSettlement — Deployment Runbook

## Prerequisites
- Node.js + project deps installed (`npm install`)
- `.env` populated (never commit it)

## Local (TRE) testing
1. `docker run -it -p 9090:9090 --rm --name tron tronbox/tre`
2. Copy a printed private key → `.env` `PRIVATE_KEY_DEV`
3. `npx tronbox test --network development`

## Nile testnet
1. Fund an address at https://nileex.io/join/getJoinPage (TRX + test USDT)
2. Set `PRIVATE_KEY_NILE`, `NILE_USDT_ADDRESS`, `NILE_OWNER_ADDRESS`, `NILE_EXECUTOR_ADDRESS`
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
```

- [ ] **Step 5: Update the project roadmap**

In `docs/ROADMAP.md`, set the contract sub-project's "Build + unit tests" and "Nile testnet integration tests" rows to ✅, and update "Where we are right now" to point at Sub-project 2 (Backend). Commit it.

- [ ] **Step 6: Commit**

```bash
git add test/integration.nile.js docs/contract-deployment-runbook.md docs/ROADMAP.md
git commit -m "test: Nile integration test + deployment runbook; update roadmap"
```

---

## Notes for the implementer

- **Keep the local TRE node running** in a dedicated terminal throughout Tasks 2–7. With `--rm` it cannot be restarted; if it dies, start a fresh container and re-copy a private key into `.env`.
- **Address comparisons in tests:** TronBox returns addresses as hex; account globals are base58. Normalize both sides with `tronWeb.address.fromHex(...)` before asserting equality (see Task 6).
- **Reverts on TVM** surface as thrown JS errors; assert with the `reverted()` helper rather than a specific message — TVM does not reliably propagate `require` strings.
- **`tronWeb` is injected** as a global in the TronBox test environment; use it for `getBalance`, `sendTransaction`, and address conversion.
- **Do not commit `.env`.** Only `.env.example` is tracked.
