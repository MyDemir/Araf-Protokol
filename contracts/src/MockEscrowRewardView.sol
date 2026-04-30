// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "./ArafRewards.sol";

contract MockEscrowRewardView is IArafEscrowRewardView {
    mapping(uint256 => RewardableTradeView) private _trades;

    function setRewardableTrade(
        uint256 tradeId,
        RewardableTradeView calldata t
    ) external {
        _trades[tradeId] = t;
    }

    function getRewardableTrade(uint256 tradeId)
        external
        view
        override
        returns (RewardableTradeView memory)
    {
        return _trades[tradeId];
    }
}
