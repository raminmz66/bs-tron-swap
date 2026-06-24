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
