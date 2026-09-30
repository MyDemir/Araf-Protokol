import { useCallback, useMemo } from 'react';
import { usePublicClient, useWalletClient, useChainId } from 'wagmi';
import { parseAbi, getAddress } from 'viem';
import { getSupportedChainsMap } from '../app/chainPolicy';
import { decorateContractError } from '../app/contractErrors';

const REWARDS_ADDRESS = import.meta.env.VITE_REWARDS_ADDRESS;
const VAULT_ADDRESS = import.meta.env.VITE_REVENUE_VAULT_ADDRESS;

const REWARDS_ABI = parseAbi([
  'function epochDuration() view returns (uint256)',
  'function claimDelay() view returns (uint256)',
  'function claimWindow() view returns (uint256)',
  'function currentEpoch() view returns (uint256)',
  'function totalWeight(uint256) view returns (uint256)',
  'function userWeight(uint256,address) view returns (uint256)',
  'function epochRewardPool(uint256,address) view returns (uint256)',
  'function epochTokenFinalized(uint256,address) view returns (bool)',
  'function claimed(uint256,address,address) view returns (bool)',
  'function claimable(uint256,address,address) view returns (uint256)',
  'function claim(uint256,address)',
  'function recordTradeOutcome(uint256)',
  'function recordTradeOutcomes(uint256[])',
  'function recordedTrade(uint256) view returns (bool)',
  'function finalizeEpochToken(uint256,address)',
  'error EpochTokenNotFinalized()',
  'error EpochNotEnded()',
  'error ClaimDelayActive()',
  'error ClaimWindowClosed()',
  'error ZeroTotalWeight()',
  'error ZeroUserWeight()',
  'error AlreadyClaimed()',
  'error ZeroAmount()',
  'error RecordingWindowClosed()',
  'error RecordingWindowOpen()',
  'error EnforcedPause()',
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

const _isValid = (addr) => Boolean(addr) && addr !== '0x0000000000000000000000000000000000000000';

const _assertSuccess = (receipt, label) => {
  // [TR] viem revert olmuş tx için de receipt döndürür; status kontrol edilmeli.
  // [EN] viem returns receipts for reverted txs too; check status.
  if (receipt?.status && receipt.status !== 'success') {
    const err = new Error(`${label} reverted`);
    err.shortMessage = err.message;
    throw err;
  }
  return receipt;
};

// [TR] P4 — Tek çağrıda toplu okuma. Multicall3 olan zincirlerde (Base, Base Sepolia) tek eth_call; olmayan
//      zincirlerde (yerel hardhat) tek tek okuma. Önceki panel ~52 ayrı RPC isteği yapıyordu.
// [EN] P4 — Batched reads. One eth_call via Multicall3 where the chain has it (Base, Base Sepolia); per-call reads
//      elsewhere (local hardhat). The panel used to issue ~52 separate RPC requests.
const _supportsMulticall = (publicClient) =>
  typeof publicClient?.multicall === 'function'
  && (publicClient.chain === undefined || publicClient.chain?.contracts?.multicall3 !== undefined);

export async function batchRead(publicClient, contracts) {
  if (contracts.length === 0) return [];
  if (_supportsMulticall(publicClient)) {
    return publicClient.multicall({ contracts, allowFailure: false });
  }
  return Promise.all(contracts.map((c) => publicClient.readContract(c)));
}

/**
 * [TR] Ödül panelinin tüm zincir okumasını (zamanlama, dönemler, havuzlar, talep durumu) 2 toplu okuma + 1 blok okumasına indirir.
 *      `chainNow` son bloğun zaman damgasıdır; dönem/talep penceresi hesabı tarayıcı saatine değil buna dayanmalıdır.
 * [EN] Collapses the rewards panel's chain reads into 2 batched reads + 1 block read. `chainNow` is the latest block
 *      timestamp; epoch/claim-window maths must use it rather than the browser clock.
 */
export async function readRewardsSnapshot(publicClient, { address, user, tokens, epochsBack }) {
  const rewards = { address: getAddress(address), abi: REWARDS_ABI };
  const userAddr = getAddress(user);
  const tokenAddrs = tokens.map((t) => getAddress(t));

  const [head, block] = await Promise.all([
    batchRead(publicClient, [
      { ...rewards, functionName: 'currentEpoch' },
      { ...rewards, functionName: 'epochDuration' },
      { ...rewards, functionName: 'claimDelay' },
      { ...rewards, functionName: 'claimWindow' },
    ]),
    typeof publicClient?.getBlock === 'function'
      ? publicClient.getBlock().catch((err) => {
        console.warn('[rewards] getBlock failed; falling back to browser clock for epoch windows', err);
        return null;
      })
      : Promise.resolve(null),
  ]);
  const [current, epochDuration, claimDelay, claimWindow] = head.map((v) => BigInt(v));
  const chainNow = block?.timestamp != null ? Number(block.timestamp) : null;

  const epochs = [];
  for (let i = 0n; i <= BigInt(epochsBack) && current - i >= 0n; i += 1n) epochs.push(current - i);

  const calls = [];
  epochs.forEach((epoch) => {
    calls.push({ ...rewards, functionName: 'totalWeight', args: [epoch] });
    calls.push({ ...rewards, functionName: 'userWeight', args: [epoch, userAddr] });
    tokenAddrs.forEach((token) => {
      calls.push({ ...rewards, functionName: 'epochRewardPool', args: [epoch, token] });
      calls.push({ ...rewards, functionName: 'epochTokenFinalized', args: [epoch, token] });
      calls.push({ ...rewards, functionName: 'claimed', args: [epoch, userAddr, token] });
    });
  });
  const results = await batchRead(publicClient, calls);

  const perEpoch = 2 + tokenAddrs.length * 3;
  const rows = epochs.map((epoch, idx) => {
    const base = idx * perEpoch;
    return {
      epoch,
      totalWeight: BigInt(results[base]),
      userWeight: BigInt(results[base + 1]),
      tokens: tokenAddrs.map((token, ti) => {
        const o = base + 2 + ti * 3;
        return { token, pool: BigInt(results[o]), finalized: Boolean(results[o + 1]), claimed: Boolean(results[o + 2]) };
      }),
    };
  });

  // [TR] usingBrowserClock: zincir saati okunamadı, panel tarayıcı saatine düşer (UI isterse uyarabilir).
  return { current, timing: { epochDuration, claimDelay, claimWindow }, chainNow, usingBrowserClock: chainNow == null, epochs: rows };
}

export function useRewardsContract() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();
  const isSupportedChain = Boolean(getSupportedChainsMap()[chainId]);
  const isConfigured = _isValid(REWARDS_ADDRESS);

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
    try {
      const hash = await walletClient.writeContract({ address: getAddress(VAULT_ADDRESS), abi: VAULT_ABI, functionName, args });
      return _assertSuccess(await publicClient.waitForTransactionReceipt({ hash }), functionName);
    } catch (error) {
      throw decorateContractError(error);
    }
  }, [walletClient, publicClient, isSupportedChain]);

  const writeRewards = useCallback(async (functionName, args = []) => {
    if (!isSupportedChain) throw new Error('Wrong chain: rewards unavailable');
    if (!_isValid(REWARDS_ADDRESS) || !walletClient) throw new Error('Rewards unavailable');
    try {
      const hash = await walletClient.writeContract({ address: getAddress(REWARDS_ADDRESS), abi: REWARDS_ABI, functionName, args });
      return _assertSuccess(await publicClient.waitForTransactionReceipt({ hash }), functionName);
    } catch (error) {
      throw decorateContractError(error);
    }
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

  // [TR] Dönen nesne memoize edilir; aksi halde tüketen useEffect'ler her render'da yeniden tetiklenir.
  // [EN] Memoized so consuming effects do not re-run on every render.
  return useMemo(() => ({
    isConfigured,
    isSupportedChain,
    claimable: (epoch, user, token) => readRewards('claimable', [BigInt(epoch), getAddress(user), getAddress(token)]),
    getClaimableState,
    claim: (epoch, token) => writeRewards('claim', [BigInt(epoch), getAddress(token)]),
    recordTradeOutcome: (tradeId) => writeRewards('recordTradeOutcome', [BigInt(tradeId)]),
    recordTradeOutcomes: (tradeIds) => writeRewards('recordTradeOutcomes', [tradeIds.map((id) => BigInt(id))]),
    isTradeRecorded: (tradeId) => readRewards('recordedTrade', [BigInt(tradeId)]),
    // [TR] Kayıt penceresi kapandıktan sonra herkes çağırabilir; claim bundan önce açılmaz.
    // [EN] Callable by anyone once the recording window closes; claims do not open before it.
    finalizeEpochToken: (epoch, token) => writeRewards('finalizeEpochToken', [BigInt(epoch), getAddress(token)]),
    // [TR] Panel için toplu okuma (bkz. readRewardsSnapshot). [EN] Batched read for the panel.
    readSnapshot: ({ user, tokens, epochsBack }) => {
      if (!isSupportedChain) return Promise.reject(new Error('Wrong chain: rewards unavailable'));
      if (!_isValid(REWARDS_ADDRESS) || !publicClient) return Promise.reject(new Error('Rewards unavailable'));
      return readRewardsSnapshot(publicClient, { address: REWARDS_ADDRESS, user, tokens, epochsBack });
    },
    epochDuration: () => readRewards('epochDuration'),
    claimDelay: () => readRewards('claimDelay'),
    claimWindow: () => readRewards('claimWindow'),
    currentEpoch: () => readRewards('currentEpoch'),
    epochTokenFinalized: (epoch, token) => readRewards('epochTokenFinalized', [BigInt(epoch), getAddress(token)]),
    hasClaimed: (epoch, user, token) => readRewards('claimed', [BigInt(epoch), getAddress(user), getAddress(token)]),
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
  }), [isConfigured, isSupportedChain, publicClient, readRewards, readVault, writeRewards, writeVault, getClaimableState]);
}
