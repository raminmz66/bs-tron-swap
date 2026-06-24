// Register all Nile privateKeys for TronBox signing on public testnet.
// TronBox only auto-loads privateKeys[] on local nodes; patch TronWrap once on disk.
const fs = require('fs');
const path = require('path');

const tronWrapPath = path.join(
  __dirname,
  '../node_modules/tronbox/build/components/TronWrap/index.js'
);

const NEEDLE = 'privateKeyByAccount[defaultAddress]=getPrivateKey();';
const INJECT =
  NEEDLE +
  'if(options.privateKeys&&options.privateKeys.length>0){options.privateKeys.forEach(function(pk){var clean=String(pk).replace(/^0x/,"");var a=tronWrap.address.fromPrivateKey(clean);privateKeyByAccount[a]=clean;try{privateKeyByAccount[tronWrap.address.toHex(a)]=clean}catch(e){}});tronWrap._accounts=options.privateKeys.map(function(pk){return tronWrap.address.fromPrivateKey(String(pk).replace(/^0x/,""))});tronWrap._accountsRequested=true;}';

if (fs.existsSync(tronWrapPath)) {
  const src = fs.readFileSync(tronWrapPath, 'utf8');
  if (!src.includes('options.privateKeys&&options.privateKeys.length>0')) {
    fs.writeFileSync(tronWrapPath, src.replace(NEEDLE, INJECT));
  }
}
