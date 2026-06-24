const SwapSettlement = artifacts.require('SwapSettlement');
const MockUSDT = artifacts.require('MockUSDT');
const MockRouter = artifacts.require('MockRouter');
const { deployOpts, MIN_FEE, FEE_BPS, MAX_FEE_BPS, MIN_SWAP, WTRX } = require('./helpers');

contract('SwapSettlement.quoteSettle', (accounts) => {
  let settlement;

  before(async () => {
    const opts = deployOpts(accounts);
    const usdt = await MockUSDT.new(opts);
    const router = await MockRouter.new(opts);
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
  });

  it('applies the percentage rate when it exceeds the floor', async () => {
    const q = await settlement.quoteSettle('1000000000');
    assert.equal(q.feeUSDT.toString(), '6000000');
    assert.equal(q.swapUSDT.toString(), '994000000');
  });

  it('applies the minimum fee floor on small swaps', async () => {
    const q = await settlement.quoteSettle('100000000');
    assert.equal(q.feeUSDT.toString(), '4000000');
    assert.equal(q.swapUSDT.toString(), '96000000');
  });

  it('exposes constructor-set state', async () => {
    assert.equal((await settlement.minFee()).toString(), MIN_FEE);
    assert.equal((await settlement.feeBps()).toString(), FEE_BPS);
    assert.equal((await settlement.maxFeeBps()).toString(), MAX_FEE_BPS);
    assert.equal((await settlement.minSwapAmount()).toString(), MIN_SWAP);
  });
});
