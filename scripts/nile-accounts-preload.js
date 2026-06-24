// Preload before TronBox CLI requires TronWrap (tronbox.js passes privateKeys for accounts[0..5]).
const Module = require('module');
const tronWrapPath = require.resolve('tronbox/build/components/TronWrap');

function patchTronWrap(TronWrap) {
  if (!TronWrap || TronWrap.__nileAccountsPatched) return TronWrap;

  const originalInit = TronWrap;
  function patchedInit(options, extraOptions) {
    if (!options) {
      return originalInit(options, extraOptions);
    }
    const keys = options.privateKeys;
    const opts =
      Array.isArray(keys) && keys.length > 0
        ? { ...options, privateKey: keys[0] }
        : options;
    const tw = originalInit(opts, extraOptions);
    if (Array.isArray(keys) && keys.length > 0 && !(extraOptions && extraOptions.evm)) {
      tw._accounts = keys.map((pk) =>
        tw.address.fromPrivateKey(String(pk).replace(/^0x/, ''))
      );
    }
    return tw;
  }

  Object.assign(patchedInit, {
    config: TronWrap.config,
    constants: TronWrap.constants,
    logErrorAndExit: TronWrap.logErrorAndExit,
    dlog: TronWrap.dlog,
    sleep: TronWrap.sleep,
    TronWeb: TronWrap.TronWeb,
    __nileAccountsPatched: true,
  });

  require.cache[tronWrapPath].exports = patchedInit;
  return patchedInit;
}

const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(id) {
  const result = originalRequire.apply(this, arguments);
  try {
    const resolved = Module._resolveFilename(id, this);
    if (resolved === tronWrapPath) {
      return patchTronWrap(require.cache[tronWrapPath].exports);
    }
  } catch (_) {
    // ignore unresolvable ids
  }
  return result;
};

if (require.cache[tronWrapPath]) {
  patchTronWrap(require.cache[tronWrapPath].exports);
}
