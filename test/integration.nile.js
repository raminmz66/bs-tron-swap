const SwapSettlement = artifacts.require('SwapSettlement');
const { TronWeb } = require('tronweb');
const { trxBalanceSun } = require('./helpers');

const TRONGRID = 'https://nile.trongrid.io';

// Minimal IERC20 surface for the real USDT
const USDT_ABI = [
  {
    constant: false,
    inputs: [
      { name: '_spender', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

const id = (n) => '0x' + n.toString(16).padStart(64, '0');

const integrationReady =
  process.env.NILE_USDT_ADDRESS &&
  process.env.NILE_OWNER_ADDRESS &&
  process.env.NILE_EXECUTOR_ADDRESS &&
  process.env.PRIVATE_KEY_NILE_0;

contract('SwapSettlement integration (Nile)', (accounts) => {
  before(function () {
    if (!integrationReady) this.skip();
  });

  it('swaps real USDT to native TRX via SunSwap V2 in one tx', async () => {
    const s = await SwapSettlement.deployed();
    const [executor] = accounts;
    const user = executor;

    const tw = new TronWeb({
      fullHost: TRONGRID,
      privateKey: process.env.PRIVATE_KEY_NILE_0,
    });
    const settlementBase58 = tronWeb.address.fromHex(s.address);
    const usdt = await tw.contract(USDT_ABI, process.env.NILE_USDT_ADDRESS);

    const total = '60000000'; // 60 USDT (≥ 50 min)
    await usdt.approve(settlementBase58, total).send({ feeLimit: 100e6 });

    const trxBefore = await trxBalanceSun(user);
    const deadline = Math.floor(Date.now() / 1000) + 600;

    // minTRXOut = 0 for the smoke test; real backend computes a slippage-guarded value
    await s.settle(id(Date.now()), user, total, '0', deadline, { from: executor, feeLimit: 3000e6 });

    const trxAfter = await trxBalanceSun(user);
    assert(trxAfter > trxBefore - 3000e6, 'native TRX delivered (auto-unwrapped from WTRX)');
    console.log('TRX delta (SUN):', trxAfter - trxBefore);
  });
});
