// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRevenueVaultHandshake {
    function noteEscrowRevenueIntent(address token, uint256 amount, uint8 kind, uint256 tradeId) external;
    function onArafRevenue(address token, uint256 amount, uint8 kind, uint256 tradeId) external;
}

/**
 * @notice TEST ONLY. Vault'un escrow'u rolünü oynar: intent → transfer → hook'u escrow'daki gibi TEK işlemde yapar.
 *         Vault handshake'i transient storage kullandığından (G2) bu adımlar ayrı tx'lerde çalışmaz.
 * @notice TEST ONLY. Plays the vault's escrow: intent → transfer → hook in ONE transaction, like ArafEscrow.
 */
contract MockRevenueEscrow {
    function pushRevenue(
        address vault,
        address token,
        uint256 amount,
        uint256 transferAmount,
        uint8 kind,
        uint256 tradeId
    ) external {
        IRevenueVaultHandshake(vault).noteEscrowRevenueIntent(token, amount, kind, tradeId);
        if (transferAmount > 0) IERC20(token).transfer(vault, transferAmount);
        IRevenueVaultHandshake(vault).onArafRevenue(token, amount, kind, tradeId);
    }

    function noteOnly(address vault, address token, uint256 amount, uint8 kind, uint256 tradeId) external {
        IRevenueVaultHandshake(vault).noteEscrowRevenueIntent(token, amount, kind, tradeId);
    }

    function hookOnly(address vault, address token, uint256 amount, uint8 kind, uint256 tradeId) external {
        IRevenueVaultHandshake(vault).onArafRevenue(token, amount, kind, tradeId);
    }
}
