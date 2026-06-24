const SwapSettlement = artifacts.require('SwapSettlement');
const MockUSDT = artifacts.require('MockUSDT');
const MockRouter = artifacts.require('MockRouter');
const { deployOpts, MIN_FEE, FEE_BPS, MAX_FEE_BPS, MIN_SWAP, WTRX, fundRouterTrx, trxBalanceSun } = require('./helpers');

async function deployWired(accounts) {
  const opts = deployOpts(accounts);
  const usdt = await MockUSDT.new(opts);
  const router = await MockRouter.new(opts);
  const settlement = await SwapSettlement.new(
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
  await fundRouterTrx(router, 995 * 1e6);
  return { usdt, router, settlement };
}

function swapId(n) {
  return '0x' + n.toString(16).padStart(64, '0');
}

contract('SwapSettlement.settle (happy path)', (accounts) => {
  const [executor, owner, user] = accounts;

  it('pulls USDT, pays fee to owner, swaps remainder, delivers TRX, marks swapId', async () => {
    const { usdt, router, settlement } = await deployWired(accounts);
    const total = '1000000000';

    await usdt.mint(user, total);
    await usdt.approve(settlement.address, total, { from: user });

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const userTrxBefore = await trxBalanceSun(user);

    await settlement.settle(swapId(1), user, total, '994000000', deadline, { from: executor });

    const treasury = await settlement.owner();
    assert.equal((await usdt.balanceOf(user)).toString(), '0');
    assert.equal((await usdt.balanceOf(treasury)).toString(), '6000000');
    assert.equal((await usdt.balanceOf(router.address)).toString(), '994000000');

    const userTrxAfter = await trxBalanceSun(user);
    assert.equal(userTrxAfter - userTrxBefore, 994000000);

    assert.equal(await settlement.usedSwapIds(swapId(1)), true);
  });
});
