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
    const userTrxBefore = await tronWeb.trx.getBalance(user);

    await settlement.settle(swapId(1), user, total, '994000000', deadline, { from: executor });

    assert.equal((await usdt.balanceOf(user)).toString(), '0');
    assert.equal((await usdt.balanceOf(owner)).toString(), '6000000');
    assert.equal((await usdt.balanceOf(router.address)).toString(), '994000000');

    const userTrxAfter = await tronWeb.trx.getBalance(user);
    assert.equal(userTrxAfter - userTrxBefore, 994000000);

    assert.equal(await settlement.usedSwapIds(swapId(1)), true);
  });
});
