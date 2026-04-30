// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

contract MockRevenueReceiverReverter {
    function onArafRevenue(
        address,
        uint256,
        uint8,
        uint256
    ) external pure {
        revert("HOOK_REVERT");
    }
}
