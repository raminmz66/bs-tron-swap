// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "./interfaces/ISunswapV2Router.sol";

contract SwapSettlement is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS_DENOMINATOR = 10000;

    address public immutable USDT;
    address public immutable ROUTER;
    address public immutable WTRX;

    address public executor;
    uint256 public minFee;
    uint256 public feeBps;
    uint256 public maxFeeBps;
    uint256 public minSwapAmount;

    mapping(bytes32 => bool) public usedSwapIds;

    event Settled(bytes32 indexed swapId, address indexed user, uint256 totalUSDT, uint256 feeUSDT, uint256 trxOut);
    event ExecutorChanged(address indexed newExecutor);
    event FeeParamsUpdated(uint256 minFee, uint256 feeBps, uint256 maxFeeBps, uint256 minSwapAmount);

    modifier onlyExecutor() {
        require(msg.sender == executor, "SwapSettlement: not executor");
        _;
    }

    constructor(
        address _usdt,
        address _router,
        address _wtrx,
        address _owner,
        address _executor,
        uint256 _minFee,
        uint256 _feeBps,
        uint256 _maxFeeBps,
        uint256 _minSwapAmount
    ) {
        require(_usdt != address(0) && _router != address(0) && _wtrx != address(0), "SwapSettlement: zero address");
        require(_owner != address(0) && _executor != address(0), "SwapSettlement: zero address");
        require(_maxFeeBps <= BPS_DENOMINATOR, "SwapSettlement: maxFeeBps too high");
        require(_feeBps <= _maxFeeBps, "SwapSettlement: feeBps over max");

        USDT = _usdt;
        ROUTER = _router;
        WTRX = _wtrx;
        executor = _executor;
        minFee = _minFee;
        feeBps = _feeBps;
        maxFeeBps = _maxFeeBps;
        minSwapAmount = _minSwapAmount;

        _transferOwnership(_owner);
    }

    function _computeFee(uint256 totalUSDT) internal view returns (uint256 feeUSDT, uint256 swapUSDT) {
        uint256 pctFee = (totalUSDT * feeBps) / BPS_DENOMINATOR;
        feeUSDT = pctFee > minFee ? pctFee : minFee;
        require(feeUSDT < totalUSDT, "SwapSettlement: fee >= total");
        swapUSDT = totalUSDT - feeUSDT;
    }

    function quoteSettle(uint256 totalUSDT) external view returns (uint256 feeUSDT, uint256 swapUSDT) {
        return _computeFee(totalUSDT);
    }
}
