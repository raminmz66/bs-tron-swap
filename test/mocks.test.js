const MockUSDT = artifacts.require('MockUSDT');
const MockRouter = artifacts.require('MockRouter');
const { deployOpts, fundRouterTrx } = require('./helpers');

const reverted = (err) => /INSUFFICIENT_OUTPUT_AMOUNT|REVERT|revert|failed/i.test(err.message || String(err));

contract('mocks', (accounts) => {
  let usdt;
  let router;

  before(async () => {
    const opts = deployOpts(accounts);
    usdt = await MockUSDT.new(opts);
    router = await MockRouter.new(opts);
    await fundRouterTrx(router, 10 * 1e6);
  });

  it('MockUSDT mints and transfers without returning a bool', async () => {
    await usdt.mint(accounts[0], '1000000');
    await usdt.transfer(accounts[1], '400000', { from: accounts[0] });
    assert.equal((await usdt.balanceOf(accounts[0])).toString(), '600000');
    assert.equal((await usdt.balanceOf(accounts[1])).toString(), '400000');
  });

  it('MockRouter delivers native TRX to the recipient and enforces slippage', async () => {
    const recipient = tronWeb.address.fromHex(accounts[2]);
    await usdt.mint(accounts[0], '1000000');
    await usdt.approve(router.address, '1000000', { from: accounts[0] });

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const beforeBal = await fetch('https://nile.trongrid.io/wallet/getaccount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: recipient, visible: true }),
    }).then((r) => r.json()).then((d) => d.balance || 0);

    await router.swapExactTokensForETH(
      '1000000',
      '1000000',
      [usdt.address, accounts[3]],
      accounts[2],
      deadline,
      { from: accounts[0] }
    );

    const afterBal = await fetch('https://nile.trongrid.io/wallet/getaccount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: recipient, visible: true }),
    }).then((r) => r.json()).then((d) => d.balance || 0);

    assert.equal(afterBal - beforeBal, 1000000, 'recipient should receive 1:1 TRX');

    await usdt.mint(accounts[0], '1000000');
    await usdt.approve(router.address, '1000000', { from: accounts[0] });
    const trxMid = await fetch('https://nile.trongrid.io/wallet/getaccount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: recipient, visible: true }),
    }).then((r) => r.json()).then((d) => d.balance || 0);
    try {
      await router.swapExactTokensForETH(
        '1000000',
        '2000000',
        [usdt.address, accounts[3]],
        accounts[2],
        deadline,
        { from: accounts[0] }
      );
      const trxEnd = await fetch('https://nile.trongrid.io/wallet/getaccount', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: recipient, visible: true }),
      }).then((r) => r.json()).then((d) => d.balance || 0);
      assert.equal(trxEnd - trxMid, 0, 'slippage must not deliver TRX');
    } catch (err) {
      assert(reverted(err), `expected slippage revert, got: ${err.message || err}`);
    }
  });
});
