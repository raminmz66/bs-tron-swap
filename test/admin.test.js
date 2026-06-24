const SwapSettlement = artifacts.require('SwapSettlement');
const MockUSDT = artifacts.require('MockUSDT');
const MockRouter = artifacts.require('MockRouter');
const { deployOpts, MIN_FEE, FEE_BPS, MAX_FEE_BPS, MIN_SWAP, WTRX, expectRevert } = require('./helpers');

async function deploy(accounts) {
  const opts = deployOpts(accounts);
  const usdt = await MockUSDT.new(opts);
  const router = await MockRouter.new(opts);
  return SwapSettlement.new(
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
}

contract('SwapSettlement.admin', (accounts) => {
  const [executor, owner, , , newExecutor, newOwner] = accounts;
  let s;

  before(async () => {
    s = await deploy(accounts);
  });

  it('owner can raise minFee and it shows in quoteSettle', async () => {
    await s.setMinFee('8000000', { from: owner });
    const q = await s.quoteSettle('100000000');
    assert.equal(q.feeUSDT.toString(), '8000000');
  });

  it('non-owner cannot change fee params', async () => {
    await expectRevert(s.setMinFee('9000000', { from: executor }), 'expected onlyOwner revert');
  });

  it('setFeeBps rejects a rate above maxFeeBps', async () => {
    await expectRevert(s.setFeeBps('801', { from: owner }), 'expected over-max revert');
    await s.setFeeBps('100', { from: owner });
    assert.equal((await s.feeBps()).toString(), '100');
  });

  it('setMaxFeeBps rejects a ceiling below current feeBps', async () => {
    await expectRevert(s.setMaxFeeBps('59', { from: owner }), 'expected below-feeBps revert');
  });

  it('rotates the executor', async () => {
    await s.setExecutor(newExecutor, { from: owner });
    assert.equal(tronWeb.address.fromHex(await s.executor()), tronWeb.address.fromHex(newExecutor));
  });

  it('two-step ownership: transfer does not grant control until accepted', async () => {
    await s.transferOwnership(newOwner, { from: owner });
    assert.equal(tronWeb.address.fromHex(await s.pendingOwner()), tronWeb.address.fromHex(newOwner));
    assert.equal(tronWeb.address.fromHex(await s.owner()), tronWeb.address.fromHex(owner));
    await expectRevert(s.acceptOwnership({ from: executor }), 'expected non-pending revert');
    await s.acceptOwnership({ from: newOwner });
    assert.equal(tronWeb.address.fromHex(await s.owner()), tronWeb.address.fromHex(newOwner));
  });
});
