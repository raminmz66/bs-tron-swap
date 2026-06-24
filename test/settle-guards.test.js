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
    usdt.address,
    router.address,
    'TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a',
    accounts[1],
    accounts[0],
    MIN_FEE,
    FEE_BPS,
    MAX_FEE_BPS,
    MIN_SWAP
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
    } catch (err) {
      assert(reverted(err));
    }
  });

  it('reverts below the minimum swap amount', async () => {
    const { usdt, settlement } = await deployWired(accounts);
    await fundAndApprove(usdt, settlement, '10000000');
    try {
      await settlement.settle(id(2), user, '10000000', '0', deadline(), { from: executor });
      assert.fail('expected below-min revert');
    } catch (err) {
      assert(reverted(err));
    }
  });

  it('reverts when called by a non-executor', async () => {
    const { usdt, settlement } = await deployWired(accounts);
    await fundAndApprove(usdt, settlement, '100000000');
    try {
      await settlement.settle(id(3), user, '100000000', '0', deadline(), { from: stranger });
      assert.fail('expected onlyExecutor revert');
    } catch (err) {
      assert(reverted(err));
    }
  });

  it('reverts when paused, succeeds after unpause', async () => {
    const { usdt, settlement } = await deployWired(accounts);
    await settlement.pause({ from: owner });
    await fundAndApprove(usdt, settlement, '100000000');
    try {
      await settlement.settle(id(4), user, '100000000', '0', deadline(), { from: executor });
      assert.fail('expected whenNotPaused revert');
    } catch (err) {
      assert(reverted(err));
    }
    await settlement.unpause({ from: owner });
    await settlement.settle(id(4), user, '100000000', '0', deadline(), { from: executor });
    assert.equal(await settlement.usedSwapIds(id(4)), true);
  });

  it('reverts on slippage (router output below minTRXOut)', async () => {
    const { usdt, router, settlement } = await deployWired(accounts);
    await router.setRate('1', '2');
    await fundAndApprove(usdt, settlement, '100000000');
    try {
      await settlement.settle(id(5), user, '100000000', '96000000', deadline(), { from: executor });
      assert.fail('expected slippage revert');
    } catch (err) {
      assert(reverted(err));
    }
    assert.equal((await usdt.balanceOf(user)).toString(), '100000000');
    assert.equal(await settlement.usedSwapIds(id(5)), false);
  });

  it('reverts when the user has not approved enough USDT', async () => {
    const { usdt, settlement } = await deployWired(accounts);
    await usdt.mint(user, '100000000');
    await usdt.approve(settlement.address, '1', { from: user });
    try {
      await settlement.settle(id(6), user, '100000000', '0', deadline(), { from: executor });
      assert.fail('expected allowance revert');
    } catch (err) {
      assert(reverted(err));
    }
  });
});
