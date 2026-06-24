const { TronWeb } = require('tronweb');

(async () => {
  const tronWeb = new TronWeb({ fullHost: 'https://nile.trongrid.io' });
  console.log('# Paste these into .env:');
  for (let i = 0; i < 6; i++) {
    const acc = await tronWeb.createAccount();
    console.log(`PRIVATE_KEY_NILE_${i}=${acc.privateKey.toLowerCase()}   # ${acc.address.base58}`);
  }
})();
