import React, { useEffect, useMemo, useState } from 'react';
import { formatUnits } from 'viem';
import { useCountdown } from '../hooks/useCountdown';
import { mapApiOrderToUi } from './orderUiModel';

const API_URL = import.meta.env.VITE_API_URL || (
  import.meta.env.DEV ? 'http://localhost:4000' : ''
);

const DEFAULT_TOKEN_DECIMALS = 6;

const formatTokenAmountFromRaw = (rawAmount, decimals = DEFAULT_TOKEN_DECIMALS, maxFractionDigits = 4) => {
  try {
    const normalized = formatUnits(BigInt(rawAmount ?? 0), decimals);
    return Number(normalized).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
    });
  } catch {
    return '0';
  }
};

const rawTokenToDisplayNumber = (rawAmount, decimals = DEFAULT_TOKEN_DECIMALS) => {
  try {
    return Number(formatUnits(BigInt(rawAmount ?? 0), decimals));
  } catch {
    return 0;
  }
};

export function useAppSessionData({
  address,
  isConnected,
  connector,
  chainId,
  publicClient,
  currentView,
  showProfileModal,
  profileTab,
  lang,
  isContractLoading,
  connectedWallet,
  setShowMakerModal,
  setShowProfileModal,
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
  filterTier1,
  filterToken,
  searchAmount,
}) {
  const [tradeState, setTradeState] = useState('LOCKED');
  const [userRole, setUserRole] = useState('taker');
  const [isBanned, setIsBanned] = useState(false);
  const [cancelStatus, setCancelStatus] = useState(null);
  const [chargebackAccepted, setChargebackAccepted] = useState(false);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticatedWallet, setAuthenticatedWallet] = useState(null);
  const [isWalletRegistered, setIsWalletRegistered] = useState(null);
  const [isRegisteringWallet, setIsRegisteringWallet] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [userReputation, setUserReputation] = useState(null);
  const [piiBankOwner, setPiiBankOwner] = useState('');
  const [piiIban, setPiiIban] = useState('');
  const [piiTelegram, setPiiTelegram] = useState('');

  const [tradeHistory, setTradeHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [tradeHistoryPage, setTradeHistoryPage] = useState(1);
  const [tradeHistoryTotal, setTradeHistoryTotal] = useState(0);
  const [tradeHistoryLimit, setTradeHistoryLimit] = useState(10);

  const [activeTrade, setActiveTrade] = useState(null);
  const resolvedTradeState = activeTrade?.state || tradeState;
  const [paymentIpfsHash, setPaymentIpfsHash] = useState('');

  const [sybilStatus, setSybilStatus] = useState(null);
  const [walletAgeRemainingDays, setWalletAgeRemainingDays] = useState(null);
  const [takerName, setTakerName] = useState('');
  const [isPaused, setIsPaused] = useState(false);

  const [protocolStats, setProtocolStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  const [onchainBondMap, setOnchainBondMap] = useState(null);
  const [onchainTokenMap, setOnchainTokenMap] = useState({});
  const [takerFeeBps, setTakerFeeBps] = useState(10);
  const [tokenDecimalsMap, setTokenDecimalsMap] = useState({ USDT: DEFAULT_TOKEN_DECIMALS, USDC: DEFAULT_TOKEN_DECIMALS });
  const [bleedingAmounts, setBleedingAmounts] = useState(null);

  const [orders, setOrders] = useState([]);
  const [myOrders, setMyOrders] = useState([]);
  const [activeEscrows, setActiveEscrows] = useState([]);
  const [loading, setLoading] = useState(true);

  const authenticatedWalletRef = React.useRef(null);
  const pendingTxCheckedRef = React.useRef(false);
  const autoTradeResumeRef = React.useRef(false);

  const clearLocalSessionState = React.useCallback(() => {
    setIsAuthenticated(false);
    setAuthenticatedWallet(null);
    authenticatedWalletRef.current = null;
    setShowMakerModal(false);
    setShowProfileModal(false);
    setCurrentView('home');
    setActiveTrade(null);
    setActiveEscrows([]);
    setCancelStatus(null);
    setChargebackAccepted(false);
    setPaymentIpfsHash('');
    setIsLoggingIn(false);
    pendingTxCheckedRef.current = false;
    autoTradeResumeRef.current = false;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('araf_pending_tx');
    }
  }, [setCurrentView, setShowMakerModal, setShowProfileModal]);

  const bestEffortBackendLogout = React.useCallback(async () => {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (_) {}
  }, []);

  const authenticatedFetch = React.useCallback(async (url, options = {}) => {
    const walletHeader = connectedWallet ? { 'x-wallet-address': connectedWallet } : {};
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        ...walletHeader,
      },
      credentials: 'include',
    });

    if (res.status === 409) {
      try {
        await fetch(`${API_URL}/api/auth/logout`, {
          method: 'POST',
          credentials: 'include',
        });
      } catch (_) {}

      clearLocalSessionState();
      showToast(
        lang === 'TR'
          ? 'Oturum cüzdan uyuşmazlığı nedeniyle sonlandırıldı. Lütfen yeniden giriş yapın.'
          : 'Session ended due to wallet mismatch. Please sign in again.',
        'error'
      );
      return res;
    }

    if (res.status !== 401) return res;

    try {
      const refreshRes = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ wallet: address?.toLowerCase() }),
      });

      if (!refreshRes.ok) {
        clearLocalSessionState();
        showToast(
          lang === 'TR'
            ? 'Oturumunuz sona erdi. Lütfen tekrar imzalayın.'
            : 'Session expired. Please sign in again.',
          'error'
        );
        return res;
      }

      return fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
          ...walletHeader,
        },
        credentials: 'include',
      });
    } catch (_) {
      return res;
    }
  }, [connectedWallet, address, clearLocalSessionState, lang, showToast]);

  const formatAddress = (addr) => addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '—';

  const fetchStats = React.useCallback(async () => {
    try {
      setStatsError(false);
      setStatsLoading(true);
      const res = await fetch(`${API_URL}/api/stats`, { credentials: 'include' });
      const data = await res.json();
      if (data.stats) setProtocolStats(data.stats);
      else setStatsError(true);
    } catch {
      setStatsError(true);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchMyTrades = React.useCallback(async () => {
    if (!isAuthenticated || !isConnected) {
      setActiveEscrows([]);
      return;
    }

    try {
      const res = await authenticatedFetch(`${API_URL}/api/trades/my`);
      const data = await res.json();

      if (data.trades) {
        setActiveEscrows(data.trades.map((t) => {
          const cryptoAmtRaw = t.financials?.crypto_amount || '0';
          const cryptoAsset = t.financials?.crypto_asset || 'USDT';
          const tokenDecimals = tokenDecimalsMap[cryptoAsset] ?? DEFAULT_TOKEN_DECIMALS;
          const cryptoAmtNum = rawTokenToDisplayNumber(cryptoAmtRaw, tokenDecimals);
          const rate = t.financials?.exchange_rate || 1;
          const fiatAmt = cryptoAmtNum * rate;

          return {
            id: `#${t.onchain_escrow_id}`,
            role: t.maker_address.toLowerCase() === address?.toLowerCase() ? 'maker' : 'taker',
            counterparty: formatAddress(
              t.maker_address.toLowerCase() === address?.toLowerCase() ? (t.taker_address || '') : t.maker_address
            ),
            state: t.status,
            paidAt: t.timers?.paid_at,
            lockedAt: t.timers?.locked_at,
            pingedAt: t.timers?.pinged_at,
            challengePingedAt: t.timers?.challenge_pinged_at,
            challengedAt: t.timers?.challenged_at,
            onchainId: t.onchain_escrow_id,
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
              fiat: t.financials?.fiat_currency || 'TRY',
              rate,
              max: fiatAmt,
              tokenDecimals,
              paidAt: t.timers?.paid_at,
              lockedAt: t.timers?.locked_at,
              pingedAt: t.timers?.pinged_at,
              challengePingedAt: t.timers?.challenge_pinged_at,
              challengedAt: t.timers?.challenged_at,
              cancelProposedBy: t.cancel_proposal?.proposed_by,
              chargebackAcked: t.chargeback_ack?.acknowledged === true,
            },
          };
        }));

        setActiveTrade((prev) => {
          if (!prev) return prev;
          const updated = data.trades.find((t) => t.onchain_escrow_id === prev.onchainId);
          if (!updated) return prev;

          const wasPendingSync = prev._pendingBackendSync && !prev.id;
          if (wasPendingSync && updated._id) {
            showToast(lang === 'TR' ? '✅ İşlem odası hazır!' : '✅ Trade room ready!', 'success');
          }

          if (updated.status !== prev.state) setTradeState(updated.status);
          setChargebackAccepted(updated.chargeback_ack?.acknowledged === true);

          return {
            ...prev,
            id: prev.id || updated._id,
            _pendingBackendSync: false,
            state: updated.status,
            paidAt: updated.timers?.paid_at ?? prev.paidAt,
            lockedAt: updated.timers?.locked_at ?? prev.lockedAt,
            pingedAt: updated.timers?.pinged_at ?? prev.pingedAt,
            challengePingedAt: updated.timers?.challenge_pinged_at ?? prev.challengePingedAt,
            challengedAt: updated.timers?.challenged_at ?? prev.challengedAt,
            cancelProposedBy: updated.cancel_proposal?.proposed_by ?? prev.cancelProposedBy,
            chargebackAcked: updated.chargeback_ack?.acknowledged === true,
          };
        });
      }
    } catch (err) {
      console.error('Trades fetch error:', err);
    }
  }, [isAuthenticated, isConnected, address, lang, authenticatedFetch, tokenDecimalsMap, showToast]);

  // Protocol configuration and read models
  useEffect(() => {
    fetch(`${API_URL}/api/orders/config`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (data.bondMap) setOnchainBondMap(data.bondMap);
        if (data.tokenMap) setOnchainTokenMap(data.tokenMap);
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

  useEffect(() => {
    if (resolvedTradeState !== 'CHALLENGED' || !activeTrade?.onchainId || !getCurrentAmounts) {
      setBleedingAmounts(null);
      return;
    }
    const fetchAmounts = async () => {
      const result = await getCurrentAmounts(activeTrade.onchainId);
      if (result) setBleedingAmounts(result);
    };
    fetchAmounts();
    const interval = setInterval(fetchAmounts, 30000);
    return () => clearInterval(interval);
  }, [resolvedTradeState, activeTrade?.onchainId, getCurrentAmounts]);

  useEffect(() => {
    if (!isConnected || !connectedWallet) {
      clearLocalSessionState();
      setAuthChecked(true);
      return;
    }

    fetch(`${API_URL}/api/auth/me`, {
      credentials: 'include',
      headers: { 'x-wallet-address': connectedWallet },
    })
      .then(async (res) => {
        if (res.status === 409) {
          clearLocalSessionState();
          setAuthChecked(true);
          showToast(
            lang === 'TR'
              ? 'Oturum cüzdanınızla eşleşmiyor. Lütfen yeniden giriş yapın.'
              : 'Session does not match your wallet. Please sign in again.',
            'info'
          );
          return;
        }

        if (!res.ok) {
          clearLocalSessionState();
          setAuthChecked(true);
          return;
        }

        const data = await res.json().catch(() => ({}));
        const sessionWallet = data?.wallet?.toLowerCase?.() || null;

        if (!sessionWallet) {
          await bestEffortBackendLogout();
          clearLocalSessionState();
          setAuthChecked(true);
          return;
        }

        if (sessionWallet !== connectedWallet) {
          await bestEffortBackendLogout();
          clearLocalSessionState();
          showToast(
            lang === 'TR'
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
        clearLocalSessionState();
        setAuthChecked(true);
      });
  }, [isConnected, connectedWallet, clearLocalSessionState, bestEffortBackendLogout, lang, showToast]);

  useEffect(() => {
    const mapOrders = (apiOrders = []) => apiOrders.map((o) => mapApiOrderToUi({
      order: o,
      lang,
      bondMap: onchainBondMap || {},
      tokenMap: onchainTokenMap || {},
      formatAddress,
    }));

    const fetchOrders = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_URL}/api/orders`, { credentials: 'include' });
        const data = await res.json();
        if (data.orders) {
          setOrders(mapOrders(data.orders));
        }
      } catch (err) {
        console.error('Order fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, [lang, onchainBondMap, onchainTokenMap]);

  useEffect(() => {
    if (!isAuthenticated || !isConnected) {
      setMyOrders([]);
      return;
    }

    const fetchMyOrders = async () => {
      try {
        const res = await authenticatedFetch(`${API_URL}/api/orders/my`);
        const data = await res.json();
        if (data.orders) {
          setMyOrders(data.orders.map((o) => mapApiOrderToUi({
            order: o,
            lang,
            bondMap: onchainBondMap || {},
            tokenMap: onchainTokenMap || {},
            formatAddress,
          })));
        }
      } catch (err) {
        console.error('My orders fetch error:', err);
      }
    };

    fetchMyOrders();
  }, [isAuthenticated, isConnected, authenticatedFetch, lang, onchainBondMap, onchainTokenMap]);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    if (!isConnected || !address || !getWalletRegisteredAt) {
      setIsWalletRegistered(null);
      setWalletAgeRemainingDays(null);
      return;
    }
    const checkRegistration = async () => {
      try {
        const regAt = await getWalletRegisteredAt(address);
        setIsWalletRegistered(regAt > 0n);
        if (regAt > 0n) {
          const nowSec = Math.floor(Date.now() / 1000);
          const remainingSec = Math.max(0, Number(regAt) + 7 * 24 * 3600 - nowSec);
          setWalletAgeRemainingDays(Math.ceil(remainingSec / (24 * 3600)));
        } else {
          setWalletAgeRemainingDays(null);
        }
      } catch {
        setIsWalletRegistered(null);
        setWalletAgeRemainingDays(null);
      }
    };
    checkRegistration();
  }, [isConnected, address, getWalletRegisteredAt]);

  useEffect(() => {
    if (!isConnected || !address || !getReputation) {
      setUserReputation(null);
      return;
    }
    const fetchUserReputation = async () => {
      try {
        const repData = await getReputation(address);
        const successful = typeof repData.successful !== 'undefined' ? repData.successful : repData[0];
        const failed = typeof repData.failed !== 'undefined' ? repData.failed : repData[1];
        const bannedUntil = typeof repData.bannedUntil !== 'undefined' ? repData.bannedUntil : repData[2];
        const consecutiveBans = typeof repData.consecutiveBans !== 'undefined' ? repData.consecutiveBans : repData[3];
        const effectiveTier = typeof repData.effectiveTier !== 'undefined' ? repData.effectiveTier : repData[4];
        const firstTradeAt = getFirstSuccessfulTradeAt ? await getFirstSuccessfulTradeAt(address) : 0n;

        setUserReputation({
          successful: Number(successful),
          failed: Number(failed),
          bannedUntil: Number(bannedUntil),
          consecutiveBans: Number(consecutiveBans),
          effectiveTier: Number(effectiveTier),
          firstSuccessfulTradeAt: Number(firstTradeAt),
        });
        setIsBanned(Number(bannedUntil) > Date.now() / 1000);
      } catch (err) {
        console.error('Kullanıcı itibar verisi çekilemedi:', err);
      }
    };
    fetchUserReputation();
  }, [isConnected, address, getReputation, getFirstSuccessfulTradeAt]);

  useEffect(() => {
    if (!isConnected || !address || !antiSybilCheck) return;
    const fetchSybil = async () => {
      const res = await antiSybilCheck(address);
      if (res) {
        const cooldownOk = typeof res.cooldownOk !== 'undefined' ? res.cooldownOk : res[2];
        const remaining = (!cooldownOk && getCooldownRemaining) ? await getCooldownRemaining(address) : 0n;
        setSybilStatus({
          aged: typeof res.aged !== 'undefined' ? res.aged : res[0],
          funded: typeof res.balanceOk !== 'undefined' ? res.balanceOk : (typeof res.funded !== 'undefined' ? res.funded : res[1]),
          cooldownOk,
          cooldownRemaining: Number(remaining),
        });
      }
    };
    fetchSybil();
    const interval = setInterval(fetchSybil, 30000);
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
    const interval = setInterval(fetchPausedStatus, 60000);
    return () => clearInterval(interval);
  }, [getPaused]);

  useEffect(() => {
    if (currentView === 'tradeRoom' && ['LOCKED', 'PAID', 'CHALLENGED'].includes(resolvedTradeState) && userRole === 'maker' && activeTrade?.id && isAuthenticated) {
      authenticatedFetch(`${API_URL}/api/pii/taker-name/${activeTrade.onchainId}`)
        .then((res) => res.json())
        .then((data) => { if (data.bankOwner) setTakerName(data.bankOwner); })
        .catch((err) => console.error('Taker name fetch error', err));
    }
  }, [currentView, resolvedTradeState, userRole, activeTrade?.onchainId, activeTrade?.id, isAuthenticated, authenticatedFetch]);

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
    if (currentView !== 'tradeRoom' || !isAuthenticated || isContractLoading || document.hidden) return;
    const interval = setInterval(fetchMyTrades, 15000);
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

  useEffect(() => {
    if (!showProfileModal || !isAuthenticated) return;
    const fetchMyPII = async () => {
      try {
        const res = await authenticatedFetch(`${API_URL}/api/pii/my`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.pii?.fields) {
          setPiiBankOwner(data.pii.fields.account_holder_name || '');
          setPiiIban(data.pii.fields.iban || '');
          setPiiTelegram(data.pii?.contact?.channel === 'telegram' ? (data.pii?.contact?.value || '') : '');
        }
      } catch (err) {
        console.error('Mevcut PII verisi çekilemedi:', err);
      }
    };
    if (profileTab === 'ayarlar') fetchMyPII();
  }, [showProfileModal, profileTab, isAuthenticated, authenticatedFetch]);

  useEffect(() => {
    if (profileTab !== 'gecmis' || !isAuthenticated) return;
    const fetchHistory = async (page) => {
      try {
        setHistoryLoading(true);
        const res = await authenticatedFetch(`${API_URL}/api/trades/history?page=${page}&limit=5`);
        if (!res.ok) throw new Error('History fetch failed');
        const data = await res.json();
        if (data.trades) {
          setTradeHistory(data.trades);
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
  }, [showProfileModal, profileTab, isAuthenticated, tradeHistoryPage, authenticatedFetch]);

  useEffect(() => {
    if (!isConnected) clearLocalSessionState();
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
      .then(() => {
        localStorage.removeItem('araf_pending_tx');
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
      clearLocalSessionState();
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
    const handleWalletRuntimeEvent = () => {
      if (!isAuthenticated || !authenticatedWallet) return;
      const runtimeWallet = provider?.selectedAddress?.toLowerCase?.() || connectedWallet;
      if (runtimeWallet && runtimeWallet !== authenticatedWallet) {
        bestEffortBackendLogout();
        clearLocalSessionState();
        showToast(
          lang === 'TR'
            ? 'Wallet oturumu değişti. Güvenlik için tekrar imza gerekli.'
            : 'Wallet session changed. Re-sign is required for security.',
          'info'
        );
      }
    };

    const bind = async () => {
      provider = await connector.getProvider();
      if (!provider?.on) return;
      provider.on('accountsChanged', handleWalletRuntimeEvent);
      provider.on('disconnect', handleWalletRuntimeEvent);
      provider.on('chainChanged', handleWalletRuntimeEvent);
    };
    bind().catch(() => {});

    return () => {
      if (!provider?.removeListener) return;
      provider.removeListener('accountsChanged', handleWalletRuntimeEvent);
      provider.removeListener('disconnect', handleWalletRuntimeEvent);
      provider.removeListener('chainChanged', handleWalletRuntimeEvent);
    };
  }, [connector, connectedWallet, isAuthenticated, authenticatedWallet, lang, bestEffortBackendLogout, clearLocalSessionState, showToast]);

  const filteredOrders = orders.filter((order) => {
    const amountMatch = searchAmount === '' || Number(searchAmount) <= Number(order.remainingAmount || 0);
    const tierMatch = filterTier1 ? order.tier === 0 : true;
    const tokenMatch = filterToken === 'ALL' || order.crypto === filterToken;
    return amountMatch && tierMatch && tokenMatch;
  });

  const activeEscrowCounts = {
    LOCKED: activeEscrows.filter((e) => e.state === 'LOCKED').length,
    PAID: activeEscrows.filter((e) => e.state === 'PAID').length,
    CHALLENGED: activeEscrows.filter((e) => e.state === 'CHALLENGED').length,
  };

  const gracePeriodEndDate = useMemo(() => activeTrade?.paidAt ? new Date(new Date(activeTrade.paidAt).getTime() + 48 * 3600 * 1000) : null, [activeTrade?.paidAt]);
  const gracePeriodTimer = useCountdown(gracePeriodEndDate);
  const bleedingEndDate = useMemo(() => activeTrade?.challengedAt ? new Date(new Date(activeTrade.challengedAt).getTime() + 240 * 3600 * 1000) : null, [activeTrade?.challengedAt]);
  const bleedingTimer = useCountdown(bleedingEndDate);
  const principalProtectionEndDate = useMemo(() => activeTrade?.challengedAt ? new Date(new Date(activeTrade.challengedAt).getTime() + (48 + 96) * 3600 * 1000) : null, [activeTrade?.challengedAt]);
  const principalProtectionTimer = useCountdown(principalProtectionEndDate);
  const makerPingEndDate = useMemo(() => activeTrade?.paidAt ? new Date(new Date(activeTrade.paidAt).getTime() + 48 * 3600 * 1000) : null, [activeTrade?.paidAt]);
  const makerPingTimer = useCountdown(makerPingEndDate);
  const canMakerPing = makerPingTimer.isFinished;
  const makerChallengePingEndDate = useMemo(() => activeTrade?.paidAt ? new Date(new Date(activeTrade.paidAt).getTime() + 24 * 3600 * 1000) : null, [activeTrade?.paidAt]);
  const makerChallengePingTimer = useCountdown(makerChallengePingEndDate);
  const canMakerStartChallengeFlow = makerChallengePingTimer.isFinished;
  const makerChallengeEndDate = useMemo(() => activeTrade?.challengePingedAt ? new Date(new Date(activeTrade.challengePingedAt).getTime() + 24 * 3600 * 1000) : null, [activeTrade?.challengePingedAt]);
  const makerChallengeTimer = useCountdown(makerChallengeEndDate);
  const canMakerChallenge = makerChallengeTimer.isFinished;

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
    piiBankOwner,
    setPiiBankOwner,
    piiIban,
    setPiiIban,
    piiTelegram,
    setPiiTelegram,
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
    takerFeeBps,
    tokenDecimalsMap,
    bleedingAmounts,
    orders,
    myOrders,
    setMyOrders,
    setOrders,
    activeEscrows,
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
    setIsBanned,
    cancelStatus,
    setCancelStatus,
    chargebackAccepted,
    setChargebackAccepted,
    formatAddress,
    filteredOrders,
    activeEscrowCounts,
    gracePeriodTimer,
    bleedingTimer,
    principalProtectionTimer,
    makerPingTimer,
    canMakerPing,
    makerChallengePingTimer,
    canMakerStartChallengeFlow,
    makerChallengeTimer,
    canMakerChallenge,
  };
}
