const SwapSettlement = artifacts.require('SwapSettlement');
const MockUSDT = artifacts.require('MockUSDT');
const MockRouter = artifacts.require('MockRouter');
const { deployOpts, MIN_FEE, FEE_BPS, MAX_FEE_BPS, MIN_SWAP, WTRX, fundRouterTrx, expectRevert, waitSwapIdUsed, waitAllowance } = require('./helpers');

const id = (n) => '0x' + n.toString(16).padStart(64, '0');

contract('SwapSettlement.settle (guards)', (accounts) => {
  const [executor, owner, user, stranger] = accounts;
  const deadline = () => Math.floor(Date.now() / 1000) + 3600;
  let usdt;
  let router;
  let settlement;

  before(async () => {
    const opts = deployOpts(accounts);
    usdt = await MockUSDT.new(opts);
    router = await MockRouter.new(opts);
    settlement = await SwapSettlement.new(
      usdt.address,
      router.address,
      WTRX,
      accounts[1],
      accounts[0],
      MIN_FEE,
      FEE_BPS,
      MAX_FEE_BPS,
      MIN_SWAP,
      opts
    );
    await fundRouterTrx(router, 500 * 1e6);
  });

  async function fundAndApprove(amount) {
    await usdt.mint(user, amount);
    await usdt.approve(settlement.address, amount, { from: user });
  }

  it('reverts a reused swapId', async () => {
    await fundAndApprove('100000000');
    await settlement.settle(id(1), user, '100000000', '0', deadline(), { from: executor });
    await waitSwapIdUsed(settlement, id(1));
    await usdt.mint(user, '100000000');
    await usdt.approve(settlement.address, '100000000', { from: user });
    await expectRevert(
      settlement.settle(id(1), user, '100000000', '0', deadline(), { from: executor }),
      'expected reused-swapId revert'
    );
  });

  it('reverts below the minimum swap amount', async () => {
    await fundAndApprove('10000000');
    await expectRevert(
      settlement.settle(id(2), user, '10000000', '0', deadline(), { from: executor }),
      'expected below-min revert'
    );
  });

  it('reverts when called by a non-executor', async () => {
    await fundAndApprove('100000000');
    await expectRevert(
      settlement.settle(id(3), user, '100000000', '0', deadline(), { from: stranger }),
      'expected onlyExecutor revert'
    );
  });

  it('reverts when paused, succeeds after unpause', async () => {
    await settlement.pause({ from: owner });
    await fundAndApprove('100000000');
    await expectRevert(
      settlement.settle(id(4), user, '100000000', '0', deadline(), { from: executor }),
      'expected whenNotPaused revert'
    );
    await settlement.unpause({ from: owner });
    await settlement.settle(id(4), user, '100000000', '0', deadline(), { from: executor });
    await waitSwapIdUsed(settlement, id(4));
    assert.equal(await settlement.usedSwapIds(id(4)), true);
  });

  it('reverts when the user has not approved enough USDT', async () => {
    await usdt.mint(user, '100000000');
    await usdt.approve(settlement.address, '1', { from: user });
    await waitAllowance(usdt, user, settlement.address, '1');
    await expectRevert(
      settlement.settle(id(6), user, '100000000', '0', deadline(), { from: executor }),
      'expected allowance revert'
    );
  });

  it('reverts on slippage (router output below minTRXOut)', async () => {
    await router.setRate('1', '2');
    await fundAndApprove('100000000');
    const balBefore = (await usdt.balanceOf(user)).toString();
    await expectRevert(
      settlement.settle(id(5), user, '100000000', '96000000', deadline(), { from: executor }),
      'expected slippage revert'
    );
    assert.equal((await usdt.balanceOf(user)).toString(), balBefore);
    assert.equal(await settlement.usedSwapIds(id(5)), false);
  });
});
