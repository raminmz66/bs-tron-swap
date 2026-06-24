// Nile deploys burn TRX/energy; reuse instances via before() hooks where tests allow.
const { TronWeb } = require('tronweb');
const DEPLOY_OPTS = { feeLimit: 3000e6 };
const TRONGRID = 'https://nile.trongrid.io';

/** Pay deploys from accounts[5] — executor [0] signs settle() txs. */
function deployOpts(accounts) {
  return { ...DEPLOY_OPTS, from: accounts[5] };
}

const MIN_FEE = '4000000';
const FEE_BPS = '60';
const MAX_FEE_BPS = '800';
const MIN_SWAP = '50000000';
const WTRX = 'TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function routerBase58(router) {
  return tronWeb.address.fromHex(router.address);
}

async function trxBalanceSun(address) {
  const base58 = tronWeb.address.fromHex(address);
  const d = await fetch(`${TRONGRID}/wallet/getaccount`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: base58, visible: true }),
  }).then((r) => r.json());
  return d.balance || 0;
}

/** Stranger [3] funds mock router — owner [1] is often low after prior runs. */
async function fundRouterTrx(router, sun, payerKey = process.env.PRIVATE_KEY_NILE_3) {
  const tw = new TronWeb({
    fullHost: TRONGRID,
    privateKey: payerKey,
  });
  const fundTx = await tw.trx.sendTransaction(routerBase58(router), sun);
  assert(fundTx.result, `router fund failed: ${JSON.stringify(fundTx)}`);
}

function extractTxId(val) {
  if (!val) return null;
  if (typeof val === 'string' && /^[0-9a-f]{64}$/i.test(val)) return val;
  if (val.txid) return val.txid;
  if (val.tx) return val.tx;
  if (val.transaction && val.transaction.txID) return val.transaction.txID;
  return null;
}

async function waitForTxInfo(txid, retries = 15, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    const info = await fetch(`${TRONGRID}/wallet/gettransactioninfobyid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: txid }),
    }).then((r) => r.json());
    if (info && info.id) return info;
    await sleep(delayMs);
  }
  throw new Error(`timeout waiting for tx ${txid}`);
}

function txReverted(info) {
  if (!info || !info.id) return false;
  if (info.receipt && info.receipt.result === 'REVERT') return true;
  return info.result === 'FAILED';
}

function txSucceeded(info) {
  return info && info.receipt && info.receipt.result === 'SUCCESS';
}

/** TronBox often resolves with a txid even when the on-chain call reverts. */
async function expectRevert(promise, label) {
  try {
    const val = await promise;
    const txid = extractTxId(val);
    if (!txid) assert.fail(label || 'expected revert');
    const info = await waitForTxInfo(txid);
    if (txSucceeded(info)) assert.fail(label || 'expected revert');
    if (!txReverted(info)) {
      assert.fail(`unexpected tx result: ${JSON.stringify(info.receipt || info.result)}`);
    }
  } catch (err) {
    const s = String((err && (err.message || err.reason)) || err);
    if (/expected revert|assert\.fail|unexpected tx result/i.test(s)) throw err;
  }
}

/** Wait until a TronBox call's tx is confirmed on-chain (success or throw on revert). */
async function confirmTx(promise) {
  const val = await promise;
  const txid = extractTxId(val);
  if (!txid) return val;
  const info = await waitForTxInfo(txid);
  if (txReverted(info)) {
    throw new Error(info.resMessage || 'transaction reverted');
  }
  return val;
}

/** Poll until a swapId is marked used (TronBox may return before state is final). */
async function waitSwapIdUsed(settlement, swapId, attempts = 25, delayMs = 2000) {
  for (let i = 0; i < attempts; i++) {
    if (await settlement.usedSwapIds(swapId)) return;
    await sleep(delayMs);
  }
  assert.fail(`swapId not marked after settle: ${swapId}`);
}

/** Poll until allowance matches (approve txs can lag on Nile). */
async function waitAllowance(usdt, owner, spender, expected, attempts = 15, delayMs = 2000) {
  for (let i = 0; i < attempts; i++) {
    if ((await usdt.allowance(owner, spender)).toString() === expected) return;
    await sleep(delayMs);
  }
  assert.fail(`allowance not ${expected} for ${spender}`);
}

function reverted(err) {
  if (err == null) return false;
  const s = String((err && (err.message || err.reason)) || err);
  if (/expected revert|assert\.fail/i.test(s)) return false;
  return true;
}

module.exports = {
  DEPLOY_OPTS,
  deployOpts,
  MIN_FEE,
  FEE_BPS,
  MAX_FEE_BPS,
  MIN_SWAP,
  WTRX,
  routerBase58,
  trxBalanceSun,
  fundRouterTrx,
  reverted,
  expectRevert,
  confirmTx,
  waitSwapIdUsed,
  waitAllowance,
};
