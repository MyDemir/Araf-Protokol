import React, { useEffect, useMemo, useState } from 'react';
import { deriveTradeTimeline } from './contexts/trade-room/tradeTimeline';
import { shortAddress } from './copy';
import { buildMarketOrdersQuery, MARKET_FILTER_DEFAULTS, matchesMarketFilters } from './contexts/marketplace/marketFilters';
import { mapApiOrderToUi, formatTokenAmount as formatTokenAmountFromRaw, tokenToNumber as rawTokenToDisplayNumber } from './orderUiModel';
import { buildApiUrl } from './apiConfig';
import { WALLET_AGE_MIN_SEC } from './walletAge';
import { applyStatePin, createStatePin, isTerminalTradeState } from './tradeStateSync';

// [TR] İçerik değişmediyse eski referans korunur (gereksiz render/effect zincirini önler).
export const deepEqual = (a, b) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
};

// [TR] Yalnız gövdede code === 'SESSION_WALLET_MISMATCH' olan 409 cüzdan uyuşmazlığıdır; diğer 409'lar
//      (ör. BANK_PROFILE_LOCKED_DURING_ACTIVE_TRADE) çağırana bırakılır. Gövde res.clone() ile okunur.
export const isSessionWalletMismatch = async (res) => {
  try {
    if (!res || typeof res.clone !== 'function') return false;
    const body = await res.clone().json();
    return body?.code === 'SESSION_WALLET_MISMATCH';
  } catch {
    return false;
  }
};

const DEFAULT_TOKEN_DECIMALS = 6;

// [TR] Arka plandaki sekmede yoklama yapılmaz (boşa RPC/backend isteği). [EN] Never poll from a hidden tab.
const whenVisible = (fn) => () => {
  if (typeof document === 'undefined' || !document.hidden) fn();
};

const MY_ITEMS_PAGE_LIMIT = 50;
const MAX_MY_ITEMS_PAGE_FETCHES = 100;

const assertPaginatedPayload = (data, collectionKey, endpointLabel) => {
  const items = data?.[collectionKey];
  const total = Number(data?.total);
  const page = Number(data?.page);
  const limit = Number(data?.limit);

  if (!Array.isArray(items) || !Number.isFinite(total) || !Number.isFinite(page) || !Number.isFinite(limit) || page < 1 || limit < 1) {
    throw new Error(`${endpointLabel} response schema mismatch`);
  }

  return { items, total, page, limit };
};

const fetchAllMyPages = async ({ authenticatedFetch, endpoint, collectionKey, endpointLabel, signal }) => {
  const allItems = [];
  let requestedPage = 1;

  while (requestedPage <= MAX_MY_ITEMS_PAGE_FETCHES) {
    const res = await authenticatedFetch(buildApiUrl(`${endpoint}?page=${requestedPage}&limit=${MY_ITEMS_PAGE_LIMIT}`), signal ? { signal } : undefined);
    if (signal?.aborted) return allItems;
    const data = await res.json();
    const { items, total, page, limit } = assertPaginatedPayload(data, collectionKey, endpointLabel);

    allItems.push(...items);

    const totalPages = Math.ceil(total / limit);
    if (totalPages <= page || allItems.length >= total || items.length === 0) return allItems;

    requestedPage += 1;
  }

  console.warn(`${endpointLabel} pagination stopped after ${MAX_MY_ITEMS_PAGE_FETCHES} pages to avoid an infinite loop.`);
  return allItems;
};

export function mapSettlementProposalFromApi(settlementProposal) {
  if (!settlementProposal || typeof settlementProposal !== 'object') return null;
  if (Object.keys(settlementProposal).length === 0) return null;

  // [TR] Fail-closed: state/id yoksa proposal authoritative kabul edilmez.
  // [EN] Fail-closed: without state/id we do not treat payload as an actionable proposal.
  const state = settlementProposal.state || null;
  if (!state || state === 'NONE') return null;

  const id = settlementProposal.id ?? settlementProposal.proposal_id ?? null;
  if (id === null || id === undefined || id === '') return null;

  const proposer = settlementProposal.proposer || settlementProposal.proposed_by || null;

  return {
    ...settlementProposal,
    id,
    proposalId: id,
    state,
    proposer,
    makerShareBps: settlementProposal.makerShareBps ?? settlementProposal.maker_share_bps ?? null,
    takerShareBps: settlementProposal.takerShareBps ?? settlementProposal.taker_share_bps ?? null,
    expiresAt: settlementProposal.expiresAt ?? settlementProposal.expires_at ?? null,
    finalizedAt: settlementProposal.finalizedAt ?? settlementProposal.finalized_at ?? null,
    makerPayout: settlementProposal.makerPayout ?? settlementProposal.maker_payout ?? null,
    takerPayout: settlementProposal.takerPayout ?? settlementProposal.taker_payout ?? null,
    txHash: settlementProposal.txHash ?? settlementProposal.tx_hash ?? null,
  };
}

export function buildSettlementQuickCounts(activeEscrows = [], connectedAddress = null) {
  const viewer = connectedAddress?.toLowerCase?.() || null;
  return activeEscrows.reduce((acc, escrow) => {
    const proposal = escrow?.rawTrade?.settlementProposal;
    if (!proposal || proposal.state !== 'PROPOSED') return acc;

    acc.PROPOSED += 1;
    // [TR] quick-count action lane sadece normalize proposer varsa hesaplanır.
    // [EN] action-required lane is counted only when normalized proposer exists.
    const proposer = proposal.proposer?.toLowerCase?.() || null;
    if (viewer && proposer && proposer === viewer) {
      acc.WAITING += 1;
    } else if (viewer && proposer && proposer !== viewer) {
      acc.ACTION_REQUIRED += 1;
    }
    return acc;
  }, { PROPOSED: 0, ACTION_REQUIRED: 0, WAITING: 0 });
}

export function mapReputationToSessionView(repData, firstTradeAt = 0n) {
  if (!repData) return null;

  // [TR] Frontend sadece kontrattan mirror edilen V3 authority alanlarını paketler.
  // [EN] Frontend only packages V3 authority fields mirrored from contract data.
  return {
    successful: Number(repData.successful ?? 0n),
    failed: Number(repData.failed ?? 0n),
    bannedUntil: Number(repData.bannedUntil ?? 0n),
    consecutiveBans: Number(repData.consecutiveBans ?? 0n),
    effectiveTier: Number(repData.effectiveTier ?? 0n),
    // [TR] null = okunamadı (bilinmiyor); 0 = gerçekten hiç başarılı işlem yok.
    firstSuccessfulTradeAt: firstTradeAt === null ? null : Number(firstTradeAt ?? 0n),
    authorityCounters: {
      manualReleaseCount: Number(repData.manualReleaseCount ?? 0n),
      autoReleaseCount: Number(repData.autoReleaseCount ?? 0n),
      mutualCancelCount: Number(repData.mutualCancelCount ?? 0n),
      disputedResolvedCount: Number(repData.disputedResolvedCount ?? 0n),
      burnCount: Number(repData.burnCount ?? 0n),
      disputeWinCount: Number(repData.disputeWinCount ?? 0n),
      disputeLossCount: Number(repData.disputeLossCount ?? 0n),
      partialSettlementCount: Number(repData.partialSettlementCount ?? 0n),
      riskPoints: Number(repData.riskPoints ?? 0n),
      lastPositiveEventAt: Number(repData.lastPositiveEventAt ?? 0n),
      lastNegativeEventAt: Number(repData.lastNegativeEventAt ?? 0n),
    },
  };
}

export function mapResolutionTypeLabel(resolutionType, lang = "EN") {
  const labels = {
    PARTIAL_SETTLEMENT: {
      EN: "Closed by agreed partial settlement",
      TR: "Uzlaşmalı kısmi ödemeyle kapandı",
    },
    MANUAL_RELEASE: {
      EN: "Closed by manual release",
      TR: "Manuel onayla kapandı",
    },
    AUTO_RELEASE: {
      EN: "Closed by auto-release",
      TR: "Otomatik serbest bırakma ile kapandı",
    },
    MUTUAL_CANCEL: {
      EN: "Closed by mutual cancel",
      TR: "Karşılıklı iptal ile kapandı",
    },
    BURNED: {
      EN: "Closed by burn",
      TR: "Yakım ile kapandı",
    },
    DISPUTED_RESOLUTION: {
      EN: "Released after a dispute",
      TR: "İtiraz sonrası serbest bırakıldı",
    },
    PAYMENT_WINDOW_EXPIRED: {
      EN: "Unlocked: payment not reported in 48h",
      TR: "Kilit çözüldü: 48 saatte ödeme bildirilmedi",
    },
    UNKNOWN: {
      EN: "Closed; outcome type unavailable",
      TR: "Kapandı; sonuç tipi bilinmiyor",
    },
  };
  const key = labels[resolutionType] ? resolutionType : "UNKNOWN";
  return labels[key][lang === "TR" ? "TR" : "EN"];
}

export function useAppSessionData({
  address,
  isConnected,
  connector,
  chainId,
  publicClient,
  currentView,
  lang,
  isContractLoading,
  connectedWallet,
  setShowMakerModal,
  setCurrentView,
  showToast,
  getTakerFeeBps,
  getTokenDecimals,
  getCurrentAmounts,
  getWalletRegisteredAt,
  getReputation,
  getFirstSuccessfulTradeAt,
  antiSybilCheck,
  getCooldownRemaining,
  getPaused,
  SUPPORTED_TOKEN_ADDRESSES,
  marketFilters = MARKET_FILTER_DEFAULTS,
  devScenarioActive = false,
}) {
  const [tradeState, setTradeState] = useState('LOCKED');
  const [userRole, setUserRole] = useState('taker');
  const [cancelStatus, setCancelStatus] = useState(null);
  const [chargebackAccepted, setChargebackAccepted] = useState(false);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticatedWallet, setAuthenticatedWallet] = useState(null);
  const [isWalletRegistered, setIsWalletRegistered] = useState(null);
  const [isRegisteringWallet, setIsRegisteringWallet] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [userReputation, setUserReputation] = useState(null);
  const [payoutProfileDraft, setPayoutProfileDraft] = useState({
    rail: 'TR_IBAN',
    country: 'TR',
    contact: { channel: null, value: null },
    fields: {
      account_holder_name: '',
      iban: null,
      routing_number: null,
      account_number: null,
      account_type: null,
      bic: null,
      bank_name: null,
    },
  });

  const [tradeHistory, setTradeHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [tradeHistoryPage, setTradeHistoryPage] = useState(1);
  const [tradeHistoryTotal, setTradeHistoryTotal] = useState(0);
  const [tradeHistoryLimit, setTradeHistoryLimit] = useState(10);

  const [activeTrade, setActiveTradeRaw] = useState(null);
  const resolvedTradeState = activeTrade?.state || tradeState;
  // [TR] İçerik değişmediyse eski referans korunur; kimlik sabit (P3).
  const setActiveTrade = React.useCallback((value) => {
    setActiveTradeRaw((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      return deepEqual(prev, next) ? prev : next;
    });
  }, []);
  const activeTradeRef = React.useRef(null);
  activeTradeRef.current = activeTrade;
  // [TR] Dekont hash'i trade'e (onchainId) bağlıdır; oda değişince başka trade'e sızmaz (F2). Yenilemede
  //      backend kaydındaki evidence.ipfs_receipt_hash (activeTrade.paymentIpfsHash) kullanılır.
  const [paymentIpfsHashState, setPaymentIpfsHashState] = useState({ onchainId: null, hash: '' });
  const setPaymentIpfsHash = React.useCallback((value) => {
    const onchainId = activeTradeRef.current?.onchainId;
    setPaymentIpfsHashState({
      onchainId: onchainId === undefined || onchainId === null ? null : String(onchainId),
      hash: typeof value === 'string' ? value : '',
    });
  }, []);
  const activeOnchainKey = activeTrade?.onchainId === undefined || activeTrade?.onchainId === null ? null : String(activeTrade.onchainId);
  const localHash = activeOnchainKey !== null && paymentIpfsHashState.onchainId === activeOnchainKey ? paymentIpfsHashState.hash : '';
  const paymentIpfsHash = localHash || (typeof activeTrade?.paymentIpfsHash === 'string' ? activeTrade.paymentIpfsHash : '');

  const [sybilStatus, setSybilStatus] = useState(null);
  const [walletAgeRemainingDays, setWalletAgeRemainingDays] = useState(null);
  const [takerNameState, setTakerNameState] = useState({ onchainId: null, name: '' });
  const [isPaused, setIsPaused] = useState(false);

  const [protocolStats, setProtocolStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  const [onchainBondMap, setOnchainBondMap] = useState(null);
  const [onchainTokenMap, setOnchainTokenMap] = useState({});
  const [paymentRiskConfig, setPaymentRiskConfig] = useState({});
  const [takerFeeBps, setTakerFeeBps] = useState(15);
  // [TR] Kontrat getFeeConfig aynası (backend /orders/config): emir önizlemesinde ücret gösterimi için.
  const [protocolFeeConfig, setProtocolFeeConfig] = useState(null);
  // [TR] Kontrat itibar politikası (tier eşikleri, temiz sayfa süresi); getter olmadığından backend event aynası.
  const [reputationPolicy, setReputationPolicy] = useState(null);
  const [backendDeployment, setBackendDeployment] = useState(null);
  const [tokenDecimalsMap, setTokenDecimalsMap] = useState({ USDT: DEFAULT_TOKEN_DECIMALS, USDC: DEFAULT_TOKEN_DECIMALS });
  const [bleedingState, setBleedingState] = useState(null);

  const [orders, setOrders] = useState([]);
  // [TR] Sunucudaki eşleşen emir sayısı (ilk sayfa 50 ile sınırlı olduğundan ayrı tutulur). [EN] Server-side match count.
  const [marketOrdersTotal, setMarketOrdersTotal] = useState(null);
  // [TR] Pazar akışı alınamazsa sayaçlar "0" yerine "—" göstermeli; boş pazar ile ulaşılamayan sunucu ayırt edilir.
  // [EN] Distinguish an unreachable feed from an empty market.
  const [ordersFeedError, setOrdersFeedError] = useState(false);
  const [myOrders, setMyOrders] = useState([]);
  const [activeEscrows, setActiveEscrowsRaw] = useState([]);
  const setActiveEscrows = React.useCallback((value) => {
    setActiveEscrowsRaw((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      return deepEqual(prev, next) ? prev : next;
    });
  }, []);
  const [loading, setLoading] = useState(true);

  const authenticatedWalletRef = React.useRef(null);
  const pendingTxCheckedRef = React.useRef(false);
  const autoTradeResumeRef = React.useRef(false);
  const authValidationKeyRef = React.useRef(null);
  const showToastRef = React.useRef(showToast);
  const langRef = React.useRef(lang);
  const sessionToastShownRef = React.useRef(false);
  // [TR] Yarış koruması: oturum dönemi (logout/cüzdan değişimi) ve istek sıra numaraları (F10).
  const sessionEpochRef = React.useRef(0);
  const tradesSeqRef = React.useRef(0);
  const statePinRef = React.useRef(null);
  const roomReadyToastRef = React.useRef(null);

  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  const clearLocalSessionState = React.useCallback((options = {}) => {
    // [TR] araf_pending_tx yalnız gerçek çıkışta silinir; ilk render'da (cüzdan henüz bağlanmadı) silinirse
    //      yenileme sonrası tx kurtarma hiç çalışmaz (F7).
    const { navigateHome = false, closeModals = true, clearPendingTx = false } = options;
    sessionEpochRef.current += 1;
    statePinRef.current = null;
    setIsAuthenticated(false);
    setAuthenticatedWallet(null);
    authenticatedWalletRef.current = null;
    if (closeModals) {
      setShowMakerModal(false);
    }
    if (navigateHome) {
      setCurrentView('home');
    }
    setActiveTrade(null);
    setActiveEscrows([]);
    setCancelStatus(null);
    setChargebackAccepted(false);
    setIsLoggingIn(false);
    pendingTxCheckedRef.current = false;
    autoTradeResumeRef.current = false;
    setPaymentIpfsHashState((prev) => (prev.onchainId === null && prev.hash === '' ? prev : { onchainId: null, hash: '' }));
    if (clearPendingTx && typeof window !== 'undefined') {
      localStorage.removeItem('araf_pending_tx');
    }
  }, [setCurrentView, setShowMakerModal, setActiveTrade, setActiveEscrows]);

  const bestEffortBackendLogout = React.useCallback(async () => {
    try {
      await fetch(buildApiUrl('auth/logout'), {
        method: 'POST',
        credentials: 'include',
      });
    } catch (_) {}
  }, []);

  const authenticatedFetch = React.useCallback(async (url, options = {}) => {
    const {
      skipRefresh = false,
      suppressAuthToast = false,
      ...requestOptions
    } = options || {};
    const walletHeader = connectedWallet ? { 'x-wallet-address': connectedWallet } : {};
    // [TR] FormData (dekont yükleme) için Content-Type tarayıcıya bırakılır; aksi halde multipart
    //      boundary kaybolur. JSON istekleri için varsayılan application/json korunur.
    // [EN] Let the browser set multipart Content-Type for FormData uploads (boundary).
    const isFormData = typeof FormData !== 'undefined' && requestOptions.body instanceof FormData;
    const buildHeaders = () => ({
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...requestOptions.headers,
      ...walletHeader,
    });
    const res = await fetch(url, {
      ...requestOptions,
      headers: buildHeaders(),
      credentials: 'include',
    });

    if (res.status === 409 && await isSessionWalletMismatch(res)) {
      try {
        await fetch(buildApiUrl('auth/logout'), {
          method: 'POST',
          credentials: 'include',
        });
      } catch (_) {}

      clearLocalSessionState({ navigateHome: false, closeModals: true });
      if (!suppressAuthToast && !sessionToastShownRef.current) {
        sessionToastShownRef.current = true;
        showToast(
          lang === 'TR'
            ? 'Oturum cüzdan uyuşmazlığı nedeniyle sonlandırıldı. Lütfen yeniden giriş yapın.'
            : 'Session ended due to wallet mismatch. Please sign in again.',
          'error'
        );
      }
      return res;
    }

    if (res.status !== 401) return res;
    if (skipRefresh) return res;

    try {
      const refreshRes = await fetch(buildApiUrl('auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ wallet: address?.toLowerCase() }),
      });

      if (!refreshRes.ok) {
        clearLocalSessionState({ navigateHome: false, closeModals: true });
        if (!suppressAuthToast && !sessionToastShownRef.current) {
          sessionToastShownRef.current = true;
          showToast(
            lang === 'TR'
              ? 'Oturumunuz sona erdi. Lütfen tekrar imzalayın.'
              : 'Session expired. Please sign in again.',
            'error'
          );
        }
        return res;
      }

      // [TR] Oturum başarıyla yenilendiğinde auth-toast dalgası sıfırlanır.
      // [EN] Reset auth-toast wave only after successful session refresh.
      sessionToastShownRef.current = false;

      return fetch(url, {
        ...requestOptions,
        headers: buildHeaders(),
        credentials: 'include',
      });
    } catch (_) {
      return res;
    }
  }, [connectedWallet, address, clearLocalSessionState, lang, showToast]);

  useEffect(() => {
    // [TR] Dedupe bayrağını yalnız doğrulanmış auth geri geldiğinde sıfırlarız.
    // [EN] Reset dedupe flag only when authenticated state is recovered.
    if (isAuthenticated) {
      sessionToastShownRef.current = false;
    }
  }, [isAuthenticated]);

  const formatAddress = shortAddress;

  const fetchStats = React.useCallback(async () => {
    try {
      setStatsError(false);
      setStatsLoading(true);
      const res = await fetch(buildApiUrl('stats'), { credentials: 'include' });
      const data = await res.json();
      if (data.stats) setProtocolStats(data.stats);
      else setStatsError(true);
    } catch {
      setStatsError(true);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // [TR] Tx sonrası kontrattan okunan durum pin'lenir; backend aynası yetişene kadar eski durumlar yok sayılır (F6).
  const pinTradeState = React.useCallback((onchainId, state) => {
    if (onchainId === undefined || onchainId === null || !state) return;
    statePinRef.current = createStatePin(onchainId, state);
  }, []);

  const fetchMyTrades = React.useCallback(async () => {
    if (devScenarioActive) return;
    if (!isAuthenticated || !isConnected) {
      tradesSeqRef.current += 1;
      setActiveEscrows([]);
      return;
    }

    // [TR] Sıra numarası + oturum dönemi: geç gelen/eski cüzdana ait yanıt state'i ezmez (F10).
    const seq = ++tradesSeqRef.current;
    const epoch = sessionEpochRef.current;
    const isStale = () => seq !== tradesSeqRef.current || epoch !== sessionEpochRef.current;

    try {
      const fetchedTrades = await fetchAllMyPages({
        authenticatedFetch,
        endpoint: 'trades/my',
        collectionKey: 'trades',
        endpointLabel: 'trades/my',
      });
      if (isStale()) return;

      const pinned = applyStatePin(fetchedTrades, statePinRef.current);
      statePinRef.current = pinned.pin;
      const trades = pinned.trades;
      const me = address?.toLowerCase();

      const mappedEscrows = trades.map((t) => {
        const cryptoAmtRaw = t.financials?.crypto_amount || '0';
        const cryptoAsset = t.financials?.crypto_asset || 'USDT';
        const tokenDecimals = tokenDecimalsMap[cryptoAsset] ?? DEFAULT_TOKEN_DECIMALS;
        const cryptoAmtNum = rawTokenToDisplayNumber(cryptoAmtRaw, tokenDecimals);
        const rate = Number(t.financials?.exchange_rate) > 0 ? Number(t.financials.exchange_rate) : null;
        const fiatAmt = rate ? cryptoAmtNum * rate : null;
        // [TR] Rol her zaman adresten türetilir (F4).
        const isMaker = String(t.maker_address || '').toLowerCase() === me;

        return {
          id: `#${t.onchain_escrow_id}`,
          role: isMaker ? 'maker' : 'taker',
          counterparty: formatAddress(isMaker ? (t.taker_address || '') : t.maker_address),
          state: t.status,
          paidAt: t.timers?.paid_at,
          lockedAt: t.timers?.locked_at,
          pingedAt: t.timers?.pinged_at,
          challengePingedAt: t.timers?.challenge_pinged_at,
          challengedAt: t.timers?.challenged_at,
          resolutionType: t.resolution_type || null,
          onchainId: t.onchain_escrow_id,
          settlementProposal: mapSettlementProposalFromApi(t.settlement_proposal),
          amount: `${formatTokenAmountFromRaw(cryptoAmtRaw, tokenDecimals)} ${cryptoAsset}`,
          action: t.status === 'PAID' ? (lang === 'TR' ? 'Onay Bekliyor' : 'Pending Approval') : (lang === 'TR' ? 'İşlemde' : 'In Progress'),
          rawTrade: {
            id: t._id,
            onchainId: t.onchain_escrow_id,
            maker: formatAddress(t.maker_address),
            makerFull: t.maker_address,
            takerFull: t.taker_address,
            crypto: cryptoAsset,
            cryptoAmountRaw: cryptoAmtRaw,
            cryptoAmountUi: cryptoAmtNum,
            fiat: t.financials?.fiat_currency || null,
            rate,
            max: fiatAmt,
            tokenDecimals,
            // [TR] Bleeding barı için lock anındaki orijinal teminatlar ve trade'e özgü fee snapshot.
            // [EN] Original lock-time bonds for the bleeding bar and the trade's own fee snapshot.
            makerBondRaw: t.financials?.maker_bond || '0',
            takerBondRaw: t.financials?.taker_bond || '0',
            takerFeeBps: Number.isFinite(Number(t.fee_snapshot?.taker_fee_bps)) ? Number(t.fee_snapshot.taker_fee_bps) : null,
            makerFeeBps: Number.isFinite(Number(t.fee_snapshot?.maker_fee_bps)) ? Number(t.fee_snapshot.maker_fee_bps) : null,
            paidAt: t.timers?.paid_at,
            lockedAt: t.timers?.locked_at,
            pingedAt: t.timers?.pinged_at,
            challengePingedAt: t.timers?.challenge_pinged_at,
            challengedAt: t.timers?.challenged_at,
            resolutionType: t.resolution_type || null,
            cancelProposedBy: t.cancel_proposal?.proposed_by,
            chargebackAcked: t.chargeback_ack?.acknowledged === true,
            // [TR] Yenilemede dekont hash'i kaybolmasın: backend kaydından gelir (F2).
            paymentIpfsHash: t.evidence?.ipfs_receipt_hash || null,
            settlementProposal: mapSettlementProposalFromApi(t.settlement_proposal),
            // [TR] Trust Visibility Layer payload'ı backend'den read-only gelir; UI explainability için taşınır.
            // [EN] Trust Visibility payload arrives read-only from backend; carried for UI explainability only.
            offchainHealthScoreInput: t.offchain_health_score_input || null,
            bankProfileRisk: t.bank_profile_risk || null,
          },
        };
      });
      setActiveEscrows(mappedEscrows);

      // [TR] Yan etkiler (toast/setState) updater dışında hesaplanır (F16); updater saf kalır ve trade
      //      kimliği eşleşmezse (başka/null trade) dokunmaz (F15).
      const prev = activeTradeRef.current;
      if (!prev) return;
      const prevOnchainId = String(prev.onchainId ?? '');
      const updated = trades.find((t) => String(t.onchain_escrow_id ?? '') === prevOnchainId);
      if (!updated) return;
      const mapped = mappedEscrows.find((e) => String(e.onchainId ?? '') === prevOnchainId);
      const mappedRaw = mapped?.rawTrade || {};

      const wasPendingSync = prev._pendingBackendSync && !prev.id;
      if (wasPendingSync && updated._id && roomReadyToastRef.current !== prevOnchainId) {
        roomReadyToastRef.current = prevOnchainId;
        showToast(lang === 'TR' ? 'İşlem odası hazır!' : 'Trade room ready!', 'success');
      }
      if (updated.status !== prev.state) setTradeState(updated.status);
      setChargebackAccepted(updated.chargeback_ack?.acknowledged === true);
      if (mapped?.role) setUserRole(mapped.role);

      setActiveTrade((cur) => {
        if (!cur || String(cur.onchainId ?? '') !== prevOnchainId) return cur;
        return {
          ...cur,
          ...mappedRaw,
          id: cur.id || updated._id,
          onchainId: cur.onchainId,
          _pendingBackendSync: false,
          state: updated.status,
          paidAt: updated.timers?.paid_at ?? cur.paidAt,
          lockedAt: updated.timers?.locked_at ?? cur.lockedAt,
          pingedAt: updated.timers?.pinged_at ?? cur.pingedAt,
          challengePingedAt: updated.timers?.challenge_pinged_at ?? cur.challengePingedAt,
          challengedAt: updated.timers?.challenged_at ?? cur.challengedAt,
          resolutionType: updated.resolution_type ?? cur.resolutionType ?? null,
          cancelProposedBy: updated.cancel_proposal?.proposed_by ?? cur.cancelProposedBy,
          chargebackAcked: updated.chargeback_ack?.acknowledged === true,
          settlementProposal: mapSettlementProposalFromApi(updated.settlement_proposal) ?? cur.settlementProposal ?? null,
          offchainHealthScoreInput: updated.offchain_health_score_input ?? cur.offchainHealthScoreInput ?? null,
          bankProfileRisk: updated.bank_profile_risk ?? cur.bankProfileRisk ?? null,
        };
      });
    } catch (err) {
      console.error('Trades fetch error:', err);
    }
  }, [devScenarioActive, isAuthenticated, isConnected, address, lang, authenticatedFetch, tokenDecimalsMap, showToast, setActiveEscrows, setActiveTrade]);

  // Protocol configuration and read models
  useEffect(() => {
    fetch(buildApiUrl('orders/config'), { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (data.bondMap) setOnchainBondMap(data.bondMap);
        if (data.tokenMap) setOnchainTokenMap(data.tokenMap);
        if (data.feeConfig) setProtocolFeeConfig(data.feeConfig);
        if (data.reputationPolicy) setReputationPolicy(data.reputationPolicy);
        if (data.deployment) setBackendDeployment(data.deployment);
        if (data.paymentRiskConfig) setPaymentRiskConfig(data.paymentRiskConfig);
      })
      .catch((err) => console.error('[ProtocolConfig] fetch failed:', err));
  }, []);

  useEffect(() => {
    if (!getTakerFeeBps) return;
    const run = async () => {
      try {
        const fee = await getTakerFeeBps();
        setTakerFeeBps(Number(fee));
      } catch (_) {}
    };
    run();
  }, [getTakerFeeBps]);

  useEffect(() => {
    const loadTokenDecimals = async () => {
      try {
        const [usdtDecimals, usdcDecimals] = await Promise.all([
          SUPPORTED_TOKEN_ADDRESSES.USDT ? getTokenDecimals(SUPPORTED_TOKEN_ADDRESSES.USDT) : DEFAULT_TOKEN_DECIMALS,
          SUPPORTED_TOKEN_ADDRESSES.USDC ? getTokenDecimals(SUPPORTED_TOKEN_ADDRESSES.USDC) : DEFAULT_TOKEN_DECIMALS,
        ]);
        setTokenDecimalsMap({
          USDT: Number.isFinite(usdtDecimals) ? usdtDecimals : DEFAULT_TOKEN_DECIMALS,
          USDC: Number.isFinite(usdcDecimals) ? usdcDecimals : DEFAULT_TOKEN_DECIMALS,
        });
      } catch {
        setTokenDecimalsMap({ USDT: DEFAULT_TOKEN_DECIMALS, USDC: DEFAULT_TOKEN_DECIMALS });
      }
    };
    if (getTokenDecimals) loadTokenDecimals();
  }, [getTokenDecimals, SUPPORTED_TOKEN_ADDRESSES.USDT, SUPPORTED_TOKEN_ADDRESSES.USDC]);

  // [TR] getCurrentAmounts sonucu yalnız istenen tradeId için yazılır; türetilen değer de tradeId eşleşmesini arar (F10).
  useEffect(() => {
    if (resolvedTradeState !== 'CHALLENGED' || !activeTrade?.onchainId || !getCurrentAmounts) {
      setBleedingState(null);
      return undefined;
    }
    const tradeId = String(activeTrade.onchainId);
    let cancelled = false;
    const fetchAmounts = async () => {
      try {
        const result = await getCurrentAmounts(tradeId);
        if (!cancelled && result) setBleedingState({ tradeId, value: result });
      } catch (err) {
        console.error('getCurrentAmounts failed:', err);
      }
    };
    fetchAmounts();
    const interval = setInterval(whenVisible(fetchAmounts), 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [resolvedTradeState, activeTrade?.onchainId, getCurrentAmounts]);
  const bleedingAmounts = bleedingState && resolvedTradeState === 'CHALLENGED' && bleedingState.tradeId === String(activeTrade?.onchainId ?? '')
    ? bleedingState.value
    : null;

  // [TR] Cüzdan değişince uçuştaki yanıtlar geçersiz sayılır.
  useEffect(() => {
    sessionEpochRef.current += 1;
    tradesSeqRef.current += 1;
  }, [connectedWallet]);

  useEffect(() => {
    if (!isConnected || !connectedWallet) {
      authValidationKeyRef.current = null;
      clearLocalSessionState({ navigateHome: false, closeModals: true });
      setAuthChecked(true);
      return;
    }

    const validationKey = `wallet:${connectedWallet}`;
    if (authValidationKeyRef.current !== validationKey) {
      authValidationKeyRef.current = validationKey;
      setAuthChecked(false);
    }

    let cancelled = false;
    fetch(buildApiUrl('auth/me'), {
      credentials: 'include',
      headers: { 'x-wallet-address': connectedWallet },
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 409) {
          clearLocalSessionState({ navigateHome: false, closeModals: true });
          setAuthChecked(true);
          showToastRef.current(
            langRef.current === 'TR'
              ? 'Oturum cüzdanınızla eşleşmiyor. Lütfen yeniden giriş yapın.'
              : 'Session does not match your wallet. Please sign in again.',
            'info'
          );
          return;
        }

        if (!res.ok) {
          clearLocalSessionState({ navigateHome: false, closeModals: true });
          setAuthChecked(true);
          return;
        }

        const data = await res.json().catch(() => ({}));
        const sessionWallet = data?.wallet?.toLowerCase?.() || null;

        if (!sessionWallet) {
          await bestEffortBackendLogout();
          if (cancelled) return;
          clearLocalSessionState({ navigateHome: false, closeModals: true });
          setAuthChecked(true);
          return;
        }

        if (sessionWallet !== connectedWallet) {
          await bestEffortBackendLogout();
          if (cancelled) return;
          clearLocalSessionState({ navigateHome: false, closeModals: true });
          showToastRef.current(
            langRef.current === 'TR'
              ? 'Bağlı cüzdan oturumla eşleşmiyor. Lütfen yeniden imzalayın.'
              : 'Connected wallet does not match session. Please sign in again.',
            'info'
          );
          setAuthChecked(true);
          return;
        }

        setIsAuthenticated(true);
        setAuthenticatedWallet(sessionWallet);
        authenticatedWalletRef.current = sessionWallet;
        setAuthChecked(true);
      })
      .catch(() => {
        if (cancelled) return;
        clearLocalSessionState({ navigateHome: false, closeModals: true });
        setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isConnected, connectedWallet, clearLocalSessionState, bestEffortBackendLogout]);

  // [TR] Tutar araması her tuşta istek atmasın diye 400 ms geciktirilir. [EN] Debounce the amount search.
  const searchAmount = marketFilters.amount;
  const [debouncedSearchAmount, setDebouncedSearchAmount] = useState(searchAmount);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchAmount(searchAmount), 400);
    return () => clearTimeout(t);
  }, [searchAmount]);
  const viewerTier = Number.isInteger(userReputation?.effectiveTier) ? userReputation.effectiveTier : null;
  const marketViewOpen = currentView === 'market';
  const ordersLoadedRef = React.useRef(false);
  const ordersSeqRef = React.useRef(0);
  const myOrdersSeqRef = React.useRef(0);
  const marketOrdersQuery = buildMarketOrdersQuery({
    filters: { ...marketFilters, amount: debouncedSearchAmount },
    tokenAddresses: SUPPORTED_TOKEN_ADDRESSES,
    userTier: viewerTier,
  });

  useEffect(() => {
    const mapOrders = (apiOrders = []) => apiOrders.map((o) => mapApiOrderToUi({
      order: o,
      lang,
      bondMap: onchainBondMap || {},
      tokenMap: onchainTokenMap || {},
      paymentRiskConfig: paymentRiskConfig || {},
      formatAddress,
    }));

    // [TR] Pazar yeri yalnız fill edilebilir (OPEN + PARTIALLY_FILLED) emirleri gösterir ve periyodik
    //      yenilenir. Önceki çağrı filtresizdi (iptal/dolu emirler başta) ve yalnız bir kez çalışıyordu.
    // [EN] Marketplace shows only fillable orders and refreshes periodically.
    let initialLoad = true;
    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    // [TR] Sorgu/dil değişince ya da bileşen kapanınca uçuştaki istek iptal edilir; sıra numarası üst üste binen
    //      yoklamalarda eski yanıtın yenisini ezmesini önler (F10).
    const fetchOrders = async () => {
      const seq = ++ordersSeqRef.current;
      const isStale = () => cancelled || seq !== ordersSeqRef.current;
      try {
        if (initialLoad) setLoading(true);
        const res = await fetch(buildApiUrl(marketOrdersQuery), { credentials: 'include', signal: controller?.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (isStale()) return;
        if (!Array.isArray(data.orders)) throw new Error('Malformed orders payload');
        setOrders(mapOrders(data.orders));
        setMarketOrdersTotal(Number.isFinite(data.total) ? data.total : null);
        setOrdersFeedError(false);
        ordersLoadedRef.current = true;
      } catch (err) {
        if (isStale() || err?.name === 'AbortError') return;
        console.error('Order fetch error:', err);
        setOrdersFeedError(true);
      } finally {
        if (!cancelled) {
          if (initialLoad) setLoading(false);
          initialLoad = false;
        }
      }
    };
    // [TR] Pazardan çıkarken tekrar çekilmez; yalnız ilk yüklemede ya da Pazar açıkken. [EN] No refetch on leaving Market.
    if (marketViewOpen || !ordersLoadedRef.current) fetchOrders();
    // [TR] Liste yalnız Pazar ekranı açıkken yenilenir; diğer ekranlarda ilk yükleme yeterlidir.
    // [EN] Refresh only while the Market view is open; other views keep the initial load.
    if (!marketViewOpen) {
      return () => { cancelled = true; controller?.abort(); };
    }
    const interval = setInterval(whenVisible(fetchOrders), 30000);
    return () => { cancelled = true; controller?.abort(); clearInterval(interval); };
  }, [lang, onchainBondMap, onchainTokenMap, paymentRiskConfig, marketOrdersQuery, marketViewOpen]);

  useEffect(() => {
    if (!isAuthenticated || !isConnected) {
      setMyOrders([]);
      return;
    }

    let cancelled = false;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const epoch = sessionEpochRef.current;
    const seq = ++myOrdersSeqRef.current;
    const fetchMyOrders = async () => {
      try {
        const myOrdersPayload = await fetchAllMyPages({
          authenticatedFetch,
          endpoint: 'orders/my',
          collectionKey: 'orders',
          endpointLabel: 'orders/my',
          signal: controller?.signal,
        });
        // [TR] Logout/cüzdan değişimi/yeni istek sonrası gelen yanıt yazılmaz (F10).
        if (cancelled || seq !== myOrdersSeqRef.current || epoch !== sessionEpochRef.current) return;
        setMyOrders(myOrdersPayload.map((o) => mapApiOrderToUi({
          order: o,
          lang,
          bondMap: onchainBondMap || {},
          tokenMap: onchainTokenMap || {},
          paymentRiskConfig: paymentRiskConfig || {},
          formatAddress,
        })));
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') return;
        console.error('My orders fetch error:', err);
      }
    };

    fetchMyOrders();
    return () => { cancelled = true; controller?.abort(); };
  }, [isAuthenticated, isConnected, authenticatedFetch, lang, onchainBondMap, onchainTokenMap, paymentRiskConfig]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    if (!isConnected || !address || !getWalletRegisteredAt) {
      setIsWalletRegistered(null);
      setWalletAgeRemainingDays(null);
      return;
    }
    let cancelled = false;
    const checkRegistration = async () => {
      try {
        const regAt = await getWalletRegisteredAt(address);
        if (cancelled) return;
        setIsWalletRegistered(regAt > 0n);
        if (regAt > 0n) {
          const nowSec = Math.floor(Date.now() / 1000);
          const remainingSec = Math.max(0, Number(regAt) + WALLET_AGE_MIN_SEC - nowSec);
          setWalletAgeRemainingDays(Math.ceil(remainingSec / (24 * 3600)));
        } else {
          setWalletAgeRemainingDays(null);
        }
      } catch {
        // [TR] Okunamadı = bilinmiyor (null); "kayıtsız" sanılmaz (F20).
        if (cancelled) return;
        setIsWalletRegistered(null);
        setWalletAgeRemainingDays(null);
      }
    };
    checkRegistration();
    return () => { cancelled = true; };
  }, [isConnected, address, getWalletRegisteredAt]);

  // [TR] İtibar/ban/tier yalnız cüzdan değişiminde değil; trade bitince, decayReputation sonrası ve ban süresi
  //      dolunca da yeniden okunur (F9).
  const reputationReqRef = React.useRef(0);
  const refreshReputation = React.useCallback(async () => {
    if (!isConnected || !address || !getReputation) {
      setUserReputation(null);
      return null;
    }
    const req = ++reputationReqRef.current;
    try {
      const repData = await getReputation(address);
      if (req !== reputationReqRef.current) return null;
      if (!repData) {
        setUserReputation(null);
        return null;
      }
      let firstTradeAt = null;
      if (getFirstSuccessfulTradeAt) {
        try { firstTradeAt = await getFirstSuccessfulTradeAt(address); } catch (err) {
          console.error('İlk başarılı işlem zamanı okunamadı:', err);
        }
      } else {
        firstTradeAt = 0n;
      }
      if (req !== reputationReqRef.current) return null;
      const mappedReputation = mapReputationToSessionView(repData, firstTradeAt);
      setUserReputation(mappedReputation);
      return mappedReputation;
    } catch (err) {
      console.error('Kullanıcı itibar verisi çekilemedi:', err);
      return null;
    }
  }, [isConnected, address, getReputation, getFirstSuccessfulTradeAt]);

  useEffect(() => { refreshReputation(); }, [refreshReputation]);

  // Trade sonuçlandığında (terminal durum) ya da aktif trade listeden çıktığında yeniden oku.
  const prevEscrowCountRef = React.useRef(0);
  useEffect(() => {
    if (activeEscrows.length < prevEscrowCountRef.current) refreshReputation();
    prevEscrowCountRef.current = activeEscrows.length;
  }, [activeEscrows.length, refreshReputation]);
  const terminalSeenRef = React.useRef(false);
  useEffect(() => {
    const terminal = isTerminalTradeState(resolvedTradeState);
    if (terminal && !terminalSeenRef.current) refreshReputation();
    terminalSeenRef.current = terminal;
  }, [resolvedTradeState, refreshReputation]);

  useEffect(() => {
    if (!isConnected || !address || !antiSybilCheck) return;
    const fetchSybil = async () => {
      let res = null;
      try { res = await antiSybilCheck(address); } catch { res = null; }
      if (res) {
        const cooldownOk = typeof res.cooldownOk !== 'undefined' ? res.cooldownOk : res[2];
        let remaining = 0n;
        let cooldownUnknown = false;
        if (!cooldownOk && getCooldownRemaining) {
          // [TR] Okunamazsa 0 (süre doldu) sanılmaz: bilinmiyor olarak işaretlenir (F20).
          try { remaining = await getCooldownRemaining(address); } catch { cooldownUnknown = true; }
        }
        setSybilStatus({
          cooldownUnknown,
          aged: typeof res.aged !== 'undefined' ? res.aged : res[0],
          funded: typeof res.balanceOk !== 'undefined' ? res.balanceOk : (typeof res.funded !== 'undefined' ? res.funded : res[1]),
          cooldownOk,
          cooldownRemaining: Number(remaining),
        });
      }
    };
    fetchSybil();
    const interval = setInterval(whenVisible(fetchSybil), 60000);
    return () => clearInterval(interval);
  }, [isConnected, address, antiSybilCheck, getCooldownRemaining]);

  useEffect(() => {
    if (!getPaused) return;
    const fetchPausedStatus = async () => {
      try {
        const paused = await getPaused();
        setIsPaused(paused);
      } catch (err) {
        console.error('Paused durumu çekilemedi:', err);
      }
    };
    fetchPausedStatus();
    const interval = setInterval(whenVisible(fetchPausedStatus), 120000);
    return () => clearInterval(interval);
  }, [getPaused]);

  // [TR] Ad trade'e (onchainId) bağlıdır; trade değişince sıfırlanır, eski istek iptal edilir (F8).
  useEffect(() => { setTakerNameState({ onchainId: null, name: '' }); }, [activeTrade?.onchainId]);
  useEffect(() => {
    if (!devScenarioActive && currentView === 'tradeRoom' && ['LOCKED', 'PAID', 'CHALLENGED'].includes(resolvedTradeState) && userRole === 'maker' && activeTrade?.id && isAuthenticated) {
      const onchainId = String(activeTrade.onchainId);
      let cancelled = false;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      authenticatedFetch(buildApiUrl(`pii/taker-name/${onchainId}`), controller ? { signal: controller.signal } : undefined)
        .then((res) => (res && res.ok === false ? {} : res.json()))
        .then((data) => { if (!cancelled && data?.bankOwner) setTakerNameState({ onchainId, name: data.bankOwner }); })
        .catch((err) => { if (!cancelled && err?.name !== 'AbortError') console.error('Taker name fetch error', err); });
      return () => { cancelled = true; controller?.abort(); };
    }
    return undefined;
  }, [devScenarioActive, currentView, resolvedTradeState, userRole, activeTrade?.onchainId, activeTrade?.id, isAuthenticated, authenticatedFetch]);
  const takerName = takerNameState.onchainId !== null && takerNameState.onchainId === String(activeTrade?.onchainId ?? '') ? takerNameState.name : '';

  useEffect(() => {
    if (activeTrade?.state && activeTrade.state !== tradeState) {
      setTradeState(activeTrade.state);
    }
  }, [activeTrade?.state, tradeState]);

  useEffect(() => {
    if (!activeTrade?.onchainId || !activeEscrows.length) return;
    const currentTrade = activeEscrows.find((e) => e.onchainId === activeTrade.onchainId);
    if (currentTrade?.rawTrade?.cancelProposedBy) {
      const isMyProposal = currentTrade.rawTrade.cancelProposedBy.toLowerCase() === address?.toLowerCase();
      setCancelStatus(isMyProposal ? 'proposed_by_me' : 'proposed_by_other');
    } else {
      setCancelStatus((prev) => prev ? null : prev);
    }
  }, [activeTrade?.onchainId, activeEscrows, address]);

  useEffect(() => { fetchMyTrades(); }, [fetchMyTrades]);

  useEffect(() => {
    // [TR] Interval her zaman kurulur; gizli sekme kontrolü her tick'te yapılır (kurulum anında değil). Sekme
    //      tekrar görününce aşağıdaki visibilitychange dinleyicisi hemen bir kez çeker (F12).
    if (currentView !== 'tradeRoom' || !isAuthenticated || isContractLoading) return undefined;
    const interval = setInterval(whenVisible(fetchMyTrades), 15000);
    return () => clearInterval(interval);
  }, [currentView, isAuthenticated, isContractLoading, fetchMyTrades]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const onVisibilityChange = () => {
      if (!document.hidden && currentView === 'tradeRoom') fetchMyTrades();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [isAuthenticated, currentView, fetchMyTrades]);

  // [TR] Ödeme profili ve geçmiş, tek profil yüzeyi olan Profil Merkezi sayfasında yüklenir.
  // [EN] Payout profile and history load on the Profile Center page (the only profile surface).
  const wantsPayoutProfile = currentView === 'profile';
  const wantsTradeHistory = currentView === 'profile';

  useEffect(() => {
    if (!wantsPayoutProfile || !isAuthenticated) return;
    const fetchMyPII = async () => {
      try {
        const res = await authenticatedFetch(buildApiUrl('pii/my'));
        if (!res.ok) return;
        const data = await res.json();
        if (data.pii) {
          setPayoutProfileDraft({
            rail: data.pii.rail || 'TR_IBAN',
            country: data.pii.country || 'TR',
            contact: {
              channel: data.pii?.contact?.channel || null,
              value: data.pii?.contact?.value || null,
            },
            fields: {
              account_holder_name: data.pii?.fields?.account_holder_name || '',
              iban: data.pii?.fields?.iban || null,
              routing_number: data.pii?.fields?.routing_number || null,
              account_number: data.pii?.fields?.account_number || null,
              account_type: data.pii?.fields?.account_type || null,
              bic: data.pii?.fields?.bic || null,
              bank_name: data.pii?.fields?.bank_name || null,
            },
          });
        }
      } catch (err) {
        console.error('Mevcut PII verisi çekilemedi:', err);
      }
    };
    fetchMyPII();
  }, [wantsPayoutProfile, isAuthenticated, authenticatedFetch]);

  useEffect(() => {
    if (!wantsTradeHistory || !isAuthenticated) return;
    const fetchHistory = async (page) => {
      try {
        setHistoryLoading(true);
        const res = await authenticatedFetch(buildApiUrl(`trades/history?page=${page}&limit=5`));
        if (!res.ok) throw new Error('History fetch failed');
        const data = await res.json();
        if (data.trades) {
          setTradeHistory(
            data.trades.map((trade) => ({
              ...trade,
              resolutionType: trade?.resolution_type || null,
            }))
          );
          setTradeHistoryTotal(data.total);
          setTradeHistoryPage(data.page);
          setTradeHistoryLimit(data.limit);
        }
      } catch (err) {
        console.error('İşlem geçmişi çekilemedi:', err);
        setTradeHistory([]);
        setTradeHistoryTotal(0);
      } finally {
        setHistoryLoading(false);
      }
    };
    fetchHistory(tradeHistoryPage);
  }, [wantsTradeHistory, isAuthenticated, tradeHistoryPage, authenticatedFetch]);

  useEffect(() => {
    if (!isConnected) clearLocalSessionState({ navigateHome: true, closeModals: true });
  }, [isConnected, clearLocalSessionState]);

  useEffect(() => {
    if (!publicClient || !isConnected) return;
    if (pendingTxCheckedRef.current) return;
    pendingTxCheckedRef.current = true;
    const raw = localStorage.getItem('araf_pending_tx');
    if (!raw) return;

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      localStorage.removeItem('araf_pending_tx');
      return;
    }

    if (!parsed?.hash) {
      localStorage.removeItem('araf_pending_tx');
      return;
    }
    const isValidHash = /^0x[a-fA-F0-9]{64}$/.test(parsed.hash);
    if (!isValidHash) {
      localStorage.removeItem('araf_pending_tx');
      return;
    }
    if (parsed.createdAt && (Date.now() - Number(parsed.createdAt) > 24 * 3600 * 1000)) {
      localStorage.removeItem('araf_pending_tx');
      return;
    }
    if (parsed.chainId && Number(parsed.chainId) !== Number(chainId)) return;

    publicClient.getTransactionReceipt({ hash: parsed.hash })
      .then((receipt) => {
        localStorage.removeItem('araf_pending_tx');
        // [TR] Receipt'in status'u kontrol edilir: reverted işlem "onaylandı" diye gösterilmez (F7).
        if (receipt && receipt.status && receipt.status !== 'success') {
          showToast(
            lang === 'TR'
              ? 'Bekleyen işlem zincirde başarısız oldu (reverted).'
              : 'The pending transaction failed on-chain (reverted).',
            'error'
          );
          return;
        }
        fetchMyTrades();
        showToast(
          lang === 'TR'
            ? 'Bekleyen işlem bulundu ve onaylandı. Veriler yenilendi.'
            : 'Recovered pending transaction and confirmed it. Data refreshed.',
          'success'
        );
      })
      .catch(() => {});
  }, [publicClient, isConnected, fetchMyTrades, chainId, lang, showToast]);

  useEffect(() => {
    if (!isAuthenticated) {
      autoTradeResumeRef.current = false;
      return;
    }
    if (autoTradeResumeRef.current || currentView !== 'home' || activeEscrows.length !== 1) return;

    const escrow = activeEscrows[0];
    autoTradeResumeRef.current = true;
    setActiveTrade({ ...escrow.rawTrade, onchainId: escrow.onchainId, state: escrow.state });
    setTradeState(escrow.state);
    setUserRole(escrow.role);
    setChargebackAccepted(escrow.rawTrade?.chargebackAcked === true);
    setCurrentView('tradeRoom');
    showToast(
      lang === 'TR' ? 'Aktif işleminize otomatik geri dönüldü.' : 'Automatically returned to your active trade.',
      'info'
    );
  }, [isAuthenticated, currentView, activeEscrows, lang, showToast, setCurrentView]);

  useEffect(() => {
    if (!isConnected || !connectedWallet || !isAuthenticated || !authenticatedWallet) return;
    if (authenticatedWallet !== connectedWallet) {
      bestEffortBackendLogout();
      clearLocalSessionState({ navigateHome: false, closeModals: true });
      showToast(
        lang === 'TR'
          ? 'Cüzdan değişikliği algılandı. Güvenlik için yeniden giriş yapmanız gerekiyor.'
          : 'Wallet change detected. For security, please sign in again.',
        'info'
      );
    }
  }, [isConnected, connectedWallet, isAuthenticated, authenticatedWallet, lang, bestEffortBackendLogout, clearLocalSessionState, showToast]);

  useEffect(() => {
    if (!connector?.getProvider) return undefined;
    let provider = null;
    let disposed = false;
    const handleWalletRuntimeEvent = () => {
      if (!isAuthenticated || !authenticatedWallet) return;
      const runtimeWallet = provider?.selectedAddress?.toLowerCase?.() || connectedWallet;
      if (runtimeWallet && runtimeWallet !== authenticatedWallet) {
        bestEffortBackendLogout();
        clearLocalSessionState({ navigateHome: false, closeModals: true });
        showToast(
          lang === 'TR'
            ? 'Wallet oturumu değişti. Güvenlik için tekrar imza gerekli.'
            : 'Wallet session changed. Re-sign is required for security.',
          'info'
        );
      }
    };

    const bind = async () => {
      const resolved = await connector.getProvider();
      // [TR] Cleanup çalıştıysa dinleyici hiç eklenmez; eklenmişse kaldırılır (F17).
      if (disposed || !resolved?.on) return;
      provider = resolved;
      provider.on('accountsChanged', handleWalletRuntimeEvent);
      provider.on('disconnect', handleWalletRuntimeEvent);
      provider.on('chainChanged', handleWalletRuntimeEvent);
    };
    bind().catch(() => {});

    return () => {
      disposed = true;
      if (!provider?.removeListener) return;
      provider.removeListener('accountsChanged', handleWalletRuntimeEvent);
      provider.removeListener('disconnect', handleWalletRuntimeEvent);
      provider.removeListener('chainChanged', handleWalletRuntimeEvent);
    };
  }, [connector, connectedWallet, isAuthenticated, authenticatedWallet, lang, bestEffortBackendLogout, clearLocalSessionState, showToast]);

  const filteredOrders = orders.filter((order) => matchesMarketFilters(order, marketFilters, { viewerAddress: connectedWallet, userTier: viewerTier }));

  const activeEscrowCounts = {
    LOCKED: activeEscrows.filter((e) => e.state === 'LOCKED').length,
    PAID: activeEscrows.filter((e) => e.state === 'PAID').length,
    CHALLENGED: activeEscrows.filter((e) => e.state === 'CHALLENGED').length,
    settlement: buildSettlementQuickCounts(activeEscrows, address),
  };

  // [TR] İşlem odası sayaçları tek saatten, kontrat kurallarının aynası tradeTimeline ile türetilir.
  //      Önceden 6 ayrı useCountdown (6 ayrı 1 sn interval) tüm App'i her saniye 6 kez render ediyordu;
  //      şimdi tek interval, yalnız işlem odası açıkken ve sekme görünürken çalışır.
  // [EN] Trade room timers derive from one clock via tradeTimeline (the contract-rule mirror): one interval,
  //      only while the trade room is open and the tab is visible (was six 1s intervals re-rendering App).
  const [clockMs, setClockMs] = useState(() => Date.now());
  // [TR] Süre kararları cihaz saatine değil zincir saatine göre verilir: cihaz saati geri kalan taker'ın uyarı butonu
  //      geç açılırsa maker ping yolunu önce açıp otomatik serbest bırakma hakkını kapatabilirdi. İşlem odası her
  //      açıldığında tek bir getBlock ile fark ölçülür (ek yük yok); okunamazsa cihaz saati kullanılır.
  // [EN] Timing decisions follow chain time, not the device clock (a lagging clock could cost the taker the
  //      auto-release path). One getBlock per trade-room open measures the offset; falls back to the device clock.
  const [chainOffsetMs, setChainOffsetMs] = useState(0);
  const tradeRoomOpen = currentView === 'tradeRoom' && Boolean(activeTrade);
  // [TR] Ban kararı zincir saatine göre verilir; süre dolunca itibar yeniden okunur ve ban anında kalkar (F9).
  const bannedUntilSec = userReputation?.bannedUntil ?? 0;
  const [banTick, setBanTick] = useState(0);
  const isBanned = useMemo(
    () => bannedUntilSec > (Date.now() + chainOffsetMs) / 1000,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bannedUntilSec, chainOffsetMs, banTick],
  );
  useEffect(() => {
    if (!(bannedUntilSec > 0)) return undefined;
    const remainingMs = bannedUntilSec * 1000 - (Date.now() + chainOffsetMs);
    if (remainingMs <= 0) return undefined;
    const timer = setTimeout(() => {
      setBanTick((t) => t + 1);
      refreshReputation();
    }, Math.min(remainingMs + 500, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [bannedUntilSec, chainOffsetMs, banTick, refreshReputation]);
  useEffect(() => {
    if (!(tradeRoomOpen || bannedUntilSec > 0) || !publicClient?.getBlock) return undefined;
    let alive = true;
    publicClient.getBlock()
      .then((block) => {
        const blockMs = Number(block?.timestamp) * 1000;
        if (alive && Number.isFinite(blockMs) && blockMs > 0) setChainOffsetMs(blockMs - Date.now());
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [tradeRoomOpen, bannedUntilSec, publicClient]);
  useEffect(() => {
    if (!tradeRoomOpen) return undefined;
    setClockMs(Date.now() + chainOffsetMs);
    const interval = setInterval(whenVisible(() => setClockMs(Date.now() + chainOffsetMs)), 1000);
    return () => clearInterval(interval);
  }, [tradeRoomOpen, chainOffsetMs]);
  // [TR] Odaya yeniden girişte ilk render'da saat eski kalmasın. [EN] Never decide on a stale tick after re-entering the room.
  const freshNowMs = Date.now() + chainOffsetMs;
  const chainNowMs = Math.abs(clockMs - freshNowMs) > 1500 ? freshNowMs : clockMs;
  const tradeTimers = useMemo(
    () => deriveTradeTimeline(activeTrade, { state: resolvedTradeState, now: chainNowMs }).timers,
    [activeTrade, resolvedTradeState, chainNowMs],
  );
  // [TR] Zaman damgası bilinmiyorsa (eski veri) buton kilidi kontrata bırakılır. [EN] Unknown timestamp → let the contract decide.
  const canMakerStartChallengeFlow = tradeTimers.makerChallengePing ? tradeTimers.makerChallengePing.isFinished : true;
  const canMakerChallenge = tradeTimers.makerChallenge ? tradeTimers.makerChallenge.isFinished : true;

  return {
    isAuthenticated,
    setIsAuthenticated,
    authChecked,
    authenticatedWallet,
    setAuthenticatedWallet,
    isWalletRegistered,
    setIsWalletRegistered,
    isRegisteringWallet,
    setIsRegisteringWallet,
    isLoggingIn,
    setIsLoggingIn,
    userReputation,
    payoutProfileDraft,
    setPayoutProfileDraft,
    tradeHistory,
    historyLoading,
    tradeHistoryPage,
    setTradeHistoryPage,
    tradeHistoryTotal,
    tradeHistoryLimit,
    activeTrade,
    setActiveTrade,
    resolvedTradeState,
    paymentIpfsHash,
    setPaymentIpfsHash,
    sybilStatus,
    walletAgeRemainingDays,
    takerName,
    isPaused,
    protocolStats,
    statsLoading,
    statsError,
    onchainBondMap,
    onchainTokenMap,
    protocolFeeConfig,
    reputationPolicy,
    backendDeployment,
    paymentRiskConfig,
    takerFeeBps,
    tokenDecimalsMap,
    bleedingAmounts,
    orders,
    ordersFeedError,
    myOrders,
    setMyOrders,
    setOrders,
    activeEscrows,
    setActiveEscrows,
    loading,
    setLoading,
    clearLocalSessionState,
    bestEffortBackendLogout,
    authenticatedFetch,
    fetchStats,
    fetchMyTrades,
    tradeState,
    setTradeState,
    userRole,
    setUserRole,
    isBanned,
    refreshReputation,
    pinTradeState,
    cancelStatus,
    setCancelStatus,
    chargebackAccepted,
    setChargebackAccepted,
    formatAddress,
    filteredOrders,
    marketOrdersTotal,
    activeEscrowCounts,
    tradeTimers,
    chainNowMs,
    chainOffsetMs,
    canMakerStartChallengeFlow,
    canMakerChallenge,
  };
}
