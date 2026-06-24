// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import "../interfaces/ISunswapV2Router.sol";

interface IMockToken {
    function transferFrom(address from, address to, uint256 amount) external;
}

// Minimal SunSwap V2 router stand-in. Pulls input token from the caller,
// enforces the slippage floor, and delivers native TRX to `to`.
// Must be funded with TRX before use (see test before() hook).
contract MockRouter is ISunswapV2Router {
    uint256 public rateNumerator = 1;   // out = in * num / den
    uint256 public rateDenominator = 1;

    receive() external payable {}

    function setRate(uint256 numerator, uint256 denominator) external {
        require(denominator != 0, "MockRouter: zero denominator");
        rateNumerator = numerator;
        rateDenominator = denominator;
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override returns (uint256[] memory amounts) {
        require(deadline >= block.timestamp, "MockRouter: EXPIRED");
        IMockToken(path[0]).transferFrom(msg.sender, address(this), amountIn);

        uint256 amountOut = (amountIn * rateNumerator) / rateDenominator;
        require(amountOut >= amountOutMin, "MockRouter: INSUFFICIENT_OUTPUT_AMOUNT");

        (bool ok, ) = payable(to).call{value: amountOut}("");
        require(ok, "MockRouter: TRX transfer failed");

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountOut;
        return amounts;
    }
}
