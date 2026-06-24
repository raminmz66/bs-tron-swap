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
  const wtrx = 'TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a';
  const settlement = await SwapSettlement.new(
    usdt.address,
    router.address,
    wtrx,
    accounts[1],
    accounts[0],
    MIN_FEE,
    FEE_BPS,
    MAX_FEE_BPS,
    MIN_SWAP
  );
  return { usdt, router, settlement };
}

contract('SwapSettlement.quoteSettle', (accounts) => {
  it('applies the percentage rate when it exceeds the floor', async () => {
    const { settlement } = await deploy(accounts);
    const q = await settlement.quoteSettle('1000000000');
    assert.equal(q.feeUSDT.toString(), '6000000');
    assert.equal(q.swapUSDT.toString(), '994000000');
  });

  it('applies the minimum fee floor on small swaps', async () => {
    const { settlement } = await deploy(accounts);
    const q = await settlement.quoteSettle('100000000');
    assert.equal(q.feeUSDT.toString(), '4000000');
    assert.equal(q.swapUSDT.toString(), '96000000');
  });

  it('exposes constructor-set state', async () => {
    const { settlement } = await deploy(accounts);
    assert.equal((await settlement.minFee()).toString(), MIN_FEE);
    assert.equal((await settlement.feeBps()).toString(), FEE_BPS);
    assert.equal((await settlement.maxFeeBps()).toString(), MAX_FEE_BPS);
    assert.equal((await settlement.minSwapAmount()).toString(), MIN_SWAP);
  });
});
