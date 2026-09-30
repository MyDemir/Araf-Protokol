// [TR] Vault intent handshake'i transient storage kullanır (G2); intent + transfer + hook aynı tx'te olmalıdır.
//      Testlerde vault'un escrow'u MockRevenueEscrow'dur ve bu yardımcı üç adımı tek çağrıda yapar.
// [EN] The vault handshake uses transient storage (G2); tests drive it through MockRevenueEscrow in one tx.
const { ethers } = require("hardhat");

async function deployRevenueEscrow() {
  const m = await (await ethers.getContractFactory("MockRevenueEscrow")).deploy();
  await m.waitForDeployment();
  return m;
}

// token: mintable MockERC20 (owner = default signer). transferAmount defaults to amount.
async function pushRevenue(vault, token, amount, kind = 0, tradeId = 1, transferAmount = amount) {
  const escrowAddr = await vault.escrow();
  const pusher = await ethers.getContractAt("MockRevenueEscrow", escrowAddr);
  if (transferAmount > 0n) await token.mint(escrowAddr, transferAmount);
  return pusher.pushRevenue(await vault.getAddress(), await token.getAddress(), amount, transferAmount, kind, tradeId);
}

module.exports = { deployRevenueEscrow, pushRevenue };
