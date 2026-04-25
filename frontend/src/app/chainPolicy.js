// [TR] Frontend zincir/faucet politikası tek authority noktası.
// [EN] Single authority point for frontend chain/faucet policy.

export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const HARDHAT_CHAIN_ID = 31337;

const CHAIN_NAME_BY_ID = {
  [BASE_MAINNET_CHAIN_ID]: 'Base Mainnet',
  [BASE_SEPOLIA_CHAIN_ID]: 'Base Sepolia',
  [HARDHAT_CHAIN_ID]: 'Hardhat Local',
};

export const getSupportedChainIds = (isProd = import.meta.env.PROD) => (
  isProd
    ? [BASE_MAINNET_CHAIN_ID]
    : [HARDHAT_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID, BASE_MAINNET_CHAIN_ID]
);

export const getSupportedChainsMap = (isProd = import.meta.env.PROD) => (
  getSupportedChainIds(isProd).reduce((acc, id) => {
    acc[id] = CHAIN_NAME_BY_ID[id];
    return acc;
  }, {})
);

export const isSupportedChainId = (chainId, isProd = import.meta.env.PROD) =>
  Boolean(getSupportedChainsMap(isProd)[chainId]);

export const isMintTokenEnabled = (isProd = import.meta.env.PROD) => !isProd;

