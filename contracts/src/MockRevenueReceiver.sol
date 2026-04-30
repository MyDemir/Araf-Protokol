// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

contract MockRevenueReceiver {
    address public lastToken;
    uint256 public lastAmount;
    uint8 public lastKind;
    uint256 public lastTradeId;
    uint256 public callCount;

    function onArafRevenue(
        address token,
        uint256 amount,
        uint8 kind,
        uint256 tradeId
    ) external {
        lastToken = token;
        lastAmount = amount;
        lastKind = kind;
        lastTradeId = tradeId;
        callCount += 1;
    }
}
