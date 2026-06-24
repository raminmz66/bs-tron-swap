// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

// Deliberately mirrors real USDT (TetherToken): transfer/transferFrom/approve
// return NO boolean. This exercises SafeERC20's no-returndata code path.
contract MockUSDT {
    string public name = "Mock Tether";
    string public symbol = "USDT";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external {
        _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "USDT: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "USDT: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
