require('dotenv').config();
const { TronWeb } = require('tronweb');

(async () => {
  const keys = [0,1,2,3,4,5].map((i) => process.env[`PRIVATE_KEY_NILE_${i}`]);
  if (keys.some((k) => !k)) throw new Error('Set PRIVATE_KEY_NILE_0..5 in .env first');

  const tronWeb = new TronWeb({ fullHost: 'https://nile.trongrid.io', privateKey: keys[0] });
  const from = tronWeb.address.fromPrivateKey(keys[0]);
  const PER_ACCOUNT = 300 * 1e6; // 300 TRX each → accounts 1..5

  for (let i = 1; i < keys.length; i++) {
    const to = tronWeb.address.fromPrivateKey(keys[i]);
    const tx = await tronWeb.trx.sendTransaction(to, PER_ACCOUNT);
    console.log(`funded accounts[${i}] ${to}: ${tx.result}`);
  }
  console.log('from (accounts[0]) balance SUN:', await tronWeb.trx.getBalance(from));
})();
