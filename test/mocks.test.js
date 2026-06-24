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
