require('dotenv').config();

const nileKeys = [
  process.env.PRIVATE_KEY_NILE_0,
  process.env.PRIVATE_KEY_NILE_1,
  process.env.PRIVATE_KEY_NILE_2,
  process.env.PRIVATE_KEY_NILE_3,
  process.env.PRIVATE_KEY_NILE_4,
  process.env.PRIVATE_KEY_NILE_5,
].filter(Boolean);

module.exports = {
  networks: {
    nile: {
      privateKey: nileKeys,
      userFeePercentage: 100,
      feeLimit: 1000 * 1e6,
      fullHost: 'https://nile.trongrid.io',
      network_id: '3',
    },
    mainnet: {
      privateKey: process.env.PRIVATE_KEY_MAINNET,
      userFeePercentage: 100,
      feeLimit: 1000 * 1e6,
      fullHost: 'https://api.trongrid.io',
      network_id: '1',
    },
  },
  compilers: {
    solc: {
      version: '0.8.18',
      settings: {
        optimizer: { enabled: true, runs: 200 },
      },
    },
  },
};
