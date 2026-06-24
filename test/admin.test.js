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
  return SwapSettlement.new(
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
}

const reverted = (err) => /REVERT|revert|failed/i.test(err.message || String(err));

contract('SwapSettlement.admin', (accounts) => {
  const [executor, owner, , , newExecutor, newOwner] = accounts;

  it('owner can raise minFee and it shows in quoteSettle', async () => {
    const s = await deploy(accounts);
    await s.setMinFee('8000000', { from: owner });
    const q = await s.quoteSettle('100000000');
    assert.equal(q.feeUSDT.toString(), '8000000');
  });

  it('non-owner cannot change fee params', async () => {
    const s = await deploy(accounts);
    try {
      await s.setMinFee('8000000', { from: executor });
      assert.fail('expected onlyOwner revert');
    } catch (err) {
      assert(reverted(err));
    }
  });

  it('setFeeBps rejects a rate above maxFeeBps', async () => {
    const s = await deploy(accounts);
    try {
      await s.setFeeBps('801', { from: owner });
      assert.fail('expected over-max revert');
    } catch (err) {
      assert(reverted(err));
    }
    await s.setFeeBps('100', { from: owner });
    assert.equal((await s.feeBps()).toString(), '100');
  });

  it('setMaxFeeBps rejects a ceiling below current feeBps', async () => {
    const s = await deploy(accounts);
    try {
      await s.setMaxFeeBps('59', { from: owner });
      assert.fail('expected below-feeBps revert');
    } catch (err) {
      assert(reverted(err));
    }
  });

  it('rotates the executor', async () => {
    const s = await deploy(accounts);
    await s.setExecutor(newExecutor, { from: owner });
    assert.equal(tronWeb.address.fromHex(await s.executor()), tronWeb.address.fromHex(newExecutor));
  });

  it('two-step ownership: transfer does not grant control until accepted', async () => {
    const s = await deploy(accounts);
    await s.transferOwnership(newOwner, { from: owner });
    assert.equal(tronWeb.address.fromHex(await s.pendingOwner()), tronWeb.address.fromHex(newOwner));
    assert.equal(tronWeb.address.fromHex(await s.owner()), tronWeb.address.fromHex(owner));
    try {
      await s.acceptOwnership({ from: executor });
      assert.fail('expected non-pending revert');
    } catch (err) {
      assert(reverted(err));
    }
    await s.acceptOwnership({ from: newOwner });
    assert.equal(tronWeb.address.fromHex(await s.owner()), tronWeb.address.fromHex(newOwner));
  });
});
