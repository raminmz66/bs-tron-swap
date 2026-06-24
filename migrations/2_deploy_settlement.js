const SwapSettlement = artifacts.require('SwapSettlement');

const MIN_FEE = '4000000';
const FEE_BPS = '60';
const MAX_FEE_BPS = '800';
const MIN_SWAP = '50000000';

const ROUTER = {
  nile: 'TMn1qrmYUMSTXo9babrJLzepKZoPC7M6Sy',
  mainnet: 'TNJVzGqKBWkJxJB5XYSqGAwUTV15U24pPq',
};
const WTRX = {
  nile: 'TYsbWxNnyTgsZaTFaue9hqpxkU3Fkco94a',
  mainnet: 'TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR',
};
const DEPLOY_OPTS = { feeLimit: 3000e6 };

module.exports = async function (deployer, network) {
  const prefix = network.toUpperCase(); // NILE_ / MAINNET_
  const usdt = process.env[`${prefix}_USDT_ADDRESS`];
  const owner = process.env[`${prefix}_OWNER_ADDRESS`];
  const executor = process.env[`${prefix}_EXECUTOR_ADDRESS`];
  const router = ROUTER[network];

  // No-op unless fully configured. Unit-test runs leave these unset so the
  // migration deploys nothing and tests use .new() mocks instead.
  if (!router || !usdt || !owner || !executor) {
    console.log(`[2_deploy_settlement] skipped on "${network}" — set ${prefix}_USDT_ADDRESS, ${prefix}_OWNER_ADDRESS, ${prefix}_EXECUTOR_ADDRESS to deploy a real instance`);
    return;
  }

  await deployer.deploy(
    SwapSettlement,
    usdt, router, WTRX[network], owner, executor,
    MIN_FEE, FEE_BPS, MAX_FEE_BPS, MIN_SWAP,
    DEPLOY_OPTS
  );
};
