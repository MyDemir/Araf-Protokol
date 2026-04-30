// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockERC20.sol";

contract MockERC20FalseTransfer is MockERC20 {
    constructor(string memory name, string memory symbol, uint8 decimals_)
        MockERC20(name, symbol, decimals_)
    {}

    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }
}
