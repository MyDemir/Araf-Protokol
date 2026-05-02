import { useCallback } from 'react';
import { usePublicClient, useWalletClient, useChainId } from 'wagmi';
import { parseAbi, getAddress } from 'viem';
import { getSupportedChainsMap } from '../app/chainPolicy';

const REWARDS_ADDRESS = import.meta.env.VITE_REWARDS_ADDRESS;
const VAULT_ADDRESS = import.meta.env.VITE_REVENUE_VAULT_ADDRESS;

const REWARDS_ABI = parseAbi([
  'function epochDuration() view returns (uint256)',
  'function claimDelay() view returns (uint256)',
  'function totalWeight(uint256) view returns (uint256)',
  'function userWeight(uint256,address) view returns (uint256)',
  'function epochRewardPool(uint256,address) view returns (uint256)',
  'function claimable(uint256,address,address) view returns (uint256)',
  'function claim(uint256,address)',
  'function recordTradeOutcome(uint256)',
]);

const VAULT_ABI = parseAbi([
  'function rewardBps() view returns (uint256)',
  'function rewardReserve(address) view returns (uint256)',
  'function treasuryReserve(address) view returns (uint256)',
  'function totalEscrowRevenue(address) view returns (uint256)',
  'function totalExternalFunding(address) view returns (uint256)',
  'function supportedToken(address) view returns (bool)',
  'function fundGlobalRewards(address,uint256,uint256,bytes32)',
  'function fundProductRewards(bytes32,address,uint256,uint256,bytes32)',
]);

const _isValid = (addr) => addr && addr !== '0x0000000000000000000000000000000000000000';

export function useRewardsContract() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const isSupportedChain = Boolean(getSupportedChainsMap()[chainId]);

  const readRewards = useCallback(async (functionName, args = []) => {
    if (!isSupportedChain) throw new Error('Wrong chain: rewards unavailable');
    if (!_isValid(REWARDS_ADDRESS) || !publicClient) throw new Error('Rewards unavailable');
    return publicClient.readContract({ address: getAddress(REWARDS_ADDRESS), abi: REWARDS_ABI, functionName, args });
  }, [publicClient, isSupportedChain]);

  const readVault = useCallback(async (functionName, args = []) => {
    if (!isSupportedChain) throw new Error('Wrong chain: vault unavailable');
    if (!_isValid(VAULT_ADDRESS) || !publicClient) throw new Error('Vault unavailable');
    return publicClient.readContract({ address: getAddress(VAULT_ADDRESS), abi: VAULT_ABI, functionName, args });
  }, [publicClient, isSupportedChain]);

  const writeVault = useCallback(async (functionName, args = []) => {
    if (!isSupportedChain) throw new Error('Wrong chain: vault unavailable');
    if (!_isValid(VAULT_ADDRESS) || !walletClient) throw new Error('Vault unavailable');
    const hash = await walletClient.writeContract({ address: getAddress(VAULT_ADDRESS), abi: VAULT_ABI, functionName, args });
    return publicClient.waitForTransactionReceipt({ hash });
  }, [walletClient, publicClient, isSupportedChain]);

  const writeRewards = useCallback(async (functionName, args = []) => {
    if (!isSupportedChain) throw new Error('Wrong chain: rewards unavailable');
    if (!_isValid(REWARDS_ADDRESS) || !walletClient) throw new Error('Rewards unavailable');
    const hash = await walletClient.writeContract({ address: getAddress(REWARDS_ADDRESS), abi: REWARDS_ABI, functionName, args });
    return publicClient.waitForTransactionReceipt({ hash });
  }, [walletClient, publicClient, isSupportedChain]);

  const getClaimableState = useCallback(async (epoch, user, token) => {
    if (!isSupportedChain) return { status: 'blocked', value: null, error: 'wrong_chain' };
    try {
      const value = await readRewards('claimable', [BigInt(epoch), getAddress(user), getAddress(token)]);
      return { status: value === 0n ? 'zero' : 'ok', value, error: null };
    } catch (error) {
      return { status: 'error', value: null, error: error?.message || 'read_failed' };
    }
  }, [isSupportedChain, readRewards]);

  return {
    claimable: (epoch, user, token) => readRewards('claimable', [BigInt(epoch), getAddress(user), getAddress(token)]),
    getClaimableState,
    claim: (epoch, token) => writeRewards('claim', [BigInt(epoch), getAddress(token)]),
    recordTradeOutcome: (tradeId) => writeRewards('recordTradeOutcome', [BigInt(tradeId)]),
    epochDuration: () => readRewards('epochDuration'),
    claimDelay: () => readRewards('claimDelay'),
    userWeight: (epoch, user) => readRewards('userWeight', [BigInt(epoch), getAddress(user)]),
    totalWeight: (epoch) => readRewards('totalWeight', [BigInt(epoch)]),
    epochRewardPool: (epoch, token) => readRewards('epochRewardPool', [BigInt(epoch), getAddress(token)]),
    rewardBps: () => readVault('rewardBps'),
    rewardReserve: (token) => readVault('rewardReserve', [getAddress(token)]),
    treasuryReserve: (token) => readVault('treasuryReserve', [getAddress(token)]),
    totalEscrowRevenue: (token) => readVault('totalEscrowRevenue', [getAddress(token)]),
    totalExternalFunding: (token) => readVault('totalExternalFunding', [getAddress(token)]),
    fundGlobalRewards: (token, amount, targetEpoch, fundingRef) => writeVault('fundGlobalRewards', [getAddress(token), BigInt(amount), BigInt(targetEpoch), fundingRef]),
    fundProductRewards: (productId, token, amount, targetEpoch, fundingRef) => writeVault('fundProductRewards', [productId, getAddress(token), BigInt(amount), BigInt(targetEpoch), fundingRef]),
  };
}
