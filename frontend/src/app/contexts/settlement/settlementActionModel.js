const ACTIVE_ROOM_STATES = ['CHALLENGED'];
const TERMINAL_PROPOSAL_STATES = ['FINALIZED', 'REJECTED', 'WITHDRAWN', 'EXPIRED'];
const SETTLEMENT_STATE_BY_INDEX = ['NONE', 'PROPOSED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'FINALIZED'];

export const normalizeSettlementStateForAction = (rawState) => {
  if (typeof rawState === 'number') return SETTLEMENT_STATE_BY_INDEX[rawState] || 'UNKNOWN';
  if (typeof rawState === 'bigint') return SETTLEMENT_STATE_BY_INDEX[Number(rawState)] || 'UNKNOWN';
  if (typeof rawState === 'string') return rawState.toUpperCase();
  return 'NONE';
};

export const toSettlementUnixSeconds = (value) => {
  if (!value) return 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber > 1e12 ? Math.floor(asNumber / 1000) : Math.floor(asNumber);
  const asDateMs = new Date(value).getTime();
  return Number.isFinite(asDateMs) ? Math.floor(asDateMs / 1000) : 0;
};

export const normalizeAddress = (address) => address?.toLowerCase?.() || null;

export const getSettlementActionContext = ({ activeTrade, userRole, address, nowTs = Math.floor(Date.now() / 1000) }) => {
  const proposal = activeTrade?.settlementProposal || activeTrade?.rawTrade?.settlementProposal || null;
  const proposalState = normalizeSettlementStateForAction(proposal?.state);
  const onchainTradeId = activeTrade?.onchainId ?? activeTrade?.rawTrade?.onchainId ?? null;
  const hasOnchainTradeId = onchainTradeId !== null && onchainTradeId !== undefined && onchainTradeId !== '';
  const roomState = activeTrade?.state || 'LOCKED';
  const isActionableRoom = ACTIVE_ROOM_STATES.includes(roomState);
  const makerAddress = normalizeAddress(activeTrade?.makerFull || activeTrade?.rawTrade?.maker_address || null);
  const takerAddress = normalizeAddress(activeTrade?.takerFull || activeTrade?.rawTrade?.taker_address || null);
  const userAddress = normalizeAddress(address);
  const isTradeParty = Boolean(userAddress && (userAddress === makerAddress || userAddress === takerAddress));
  const proposer = normalizeAddress(proposal?.proposer ?? proposal?.proposed_by);
  const isProposer = Boolean(isTradeParty && userAddress && proposer && userAddress === proposer);
  const isCounterparty = Boolean(isTradeParty && userAddress && proposer && userAddress !== proposer);
  const expiresAt = toSettlementUnixSeconds(proposal?.expiresAt ?? proposal?.expires_at ?? 0);
  const isExpired = expiresAt > 0 && nowTs >= expiresAt;
  const isProposed = proposalState === 'PROPOSED';
  const isTerminalProposal = TERMINAL_PROPOSAL_STATES.includes(proposalState);

  return {
    proposal,
    proposalState,
    onchainTradeId,
    hasOnchainTradeId,
    roomState,
    isActionableRoom,
    isTradeParty,
    isProposer,
    isCounterparty,
    expiresAt,
    isExpired,
    isProposed,
    isTerminalProposal,
    canPropose: Boolean(activeTrade && isActionableRoom && !proposal),
    canAccept: Boolean(activeTrade && isActionableRoom && isProposed && !isExpired && isCounterparty),
    canReject: Boolean(activeTrade && isActionableRoom && isProposed && !isExpired && isCounterparty),
    canWithdraw: Boolean(activeTrade && isActionableRoom && isProposed && !isExpired && isProposer),
    canExpire: Boolean(activeTrade && isActionableRoom && isProposed && isExpired && isTradeParty),
    userRole,
  };
};

export const validateSettlementProposalInput = ({ tradeId, makerShareBps, expiresAt, nowTs = Math.floor(Date.now() / 1000), lang = 'EN' }) => {
  const tradeIdError = validateSettlementTradeId({ tradeId, lang });
  if (tradeIdError) return tradeIdError;
  const share = Number(makerShareBps);
  if (!Number.isInteger(share) || share < 0 || share > 10000) {
    return lang === 'TR' ? 'makerShareBps 0..10000 aralığında olmalı.' : 'makerShareBps must be in range 0..10000.';
  }
  const expiry = Number(expiresAt);
  if (!Number.isInteger(expiry) || expiry <= nowTs) {
    return lang === 'TR' ? 'Geçerli bir settlement bitiş zamanı girin.' : 'Enter a valid settlement expiry.';
  }
  return null;
};

export const validateSettlementTradeId = ({ tradeId, lang = 'EN' }) => {
  if (tradeId === null || tradeId === undefined || tradeId === '') {
    return lang === 'TR' ? 'On-chain trade ID bulunamadı.' : 'Missing on-chain trade ID.';
  }
  try {
    if (BigInt(tradeId) <= 0n) {
      return lang === 'TR' ? 'Geçersiz on-chain trade ID.' : 'Invalid on-chain trade ID.';
    }
  } catch {
    return lang === 'TR' ? 'Geçersiz on-chain trade ID.' : 'Invalid on-chain trade ID.';
  }
  return null;
};
