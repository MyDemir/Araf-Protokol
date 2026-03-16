// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockERC20 (Araf Testnet Faucet)
 * @dev Mock ERC20 (USDT / USDC) for local Hardhat and Testnet testing.
 * Includes a 4-hour faucet with a strict 1000 token limit.
 */
contract MockERC20 is ERC20 {
    uint8 private _dec;
    
    // Anti-Spam: Her cüzdanın son para basma (mint) zamanını tutar
    mapping(address => uint256) public lastMintTime;

    constructor(string memory name, string memory symbol, uint8 decimals_)
        ERC20(name, symbol)
    {
        _dec = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    /**
     * @notice Testnet Faucet (Musluk)
     * Her cüzdan 4 saatte bir sadece 1000 token basabilir.
     */
    function mint() external {
        // 1. Kural: 4 saatlik bekleme süresi dolmuş mu?
        require(
            block.timestamp >= lastMintTime[msg.sender] + 4 hours, 
            "MockERC20: You can only mint 1000 tokens every 4 hours"
        );

        // 2. Kural: Zamanlayıcıyı sıfırla
        lastMintTime[msg.sender] = block.timestamp;

        // 3. Kural: Sabit 1000 adet token hesapla (Küsüratlar dahil)
        uint256 mintAmount = 1000 * 10**decimals();

        // 4. Tokenları bas ve gönder
        _mint(msg.sender, mintAmount);
    }
}
