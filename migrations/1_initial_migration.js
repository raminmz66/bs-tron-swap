const Migrations = artifacts.require('Migrations.sol');

module.exports = async function (deployer, network) {
  // Nile unit tests deploy via Contract.new(); skip boilerplate to save bandwidth.
  // Real deploys (Task 7+) set NILE_USDT_ADDRESS and use migrate --reset explicitly.
  if (network === 'nile' && !process.env.NILE_USDT_ADDRESS) {
    console.log('[1_initial_migration] skipped on nile — unit-test mode');
    return;
  }
  await deployer.deploy(Migrations);
};
