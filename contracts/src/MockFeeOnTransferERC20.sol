// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockFeeOnTransferERC20
 * @notice Test-only ERC20 that charges a transferFrom fee to simulate deflationary tokens.
 * @dev Security tests use this token to ensure escrow deposits require exact in-amounts.
 */
contract MockFeeOnTransferERC20 is ERC20, Ownable {
    uint8 private immutable _decimals;
    uint16 public immutable feeBps;
    address public immutable feeCollector;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint16 feeBps_,
        address feeCollector_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        require(feeBps_ < 10_000, "fee too high");
        require(feeCollector_ != address(0), "collector=0");
        _decimals = decimals_;
        feeBps = feeBps_;
        feeCollector = feeCollector_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _spendAllowance(from, _msgSender(), amount);

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 netAmount = amount - fee;

        _transfer(from, to, netAmount);
        if (fee > 0) {
            _transfer(from, feeCollector, fee);
        }
        return true;
    }
}
