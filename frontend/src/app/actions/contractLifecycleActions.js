import { keccak256, stringToHex } from 'viem';
import { buildApiUrl } from '../apiConfig';
import { resolveValidatedFillAmountRaw } from '../fillAmountPolicy';
import { normalizeOrderSide, removeOrderByOnchainId, resolveOrderActionFns } from '../orderUiModel';
import { WALLET_AGE_MIN_DAYS } from '../walletAge';
import { mapChainTradeState, resolveConfirmedState } from '../tradeStateSync';
import { computeFillAllowance } from './allowanceMath';
import { clearAppHashRoute } from './tradeNavigationActions';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const getOnchainOrderField = (onchainOrder, namedKey, tupleIndex) => {
  if (!onchainOrder) return undefined;
  return typeof onchainOrder[namedKey] !== 'undefined' ? onchainOrder[namedKey] : onchainOrder[tupleIndex];
};

const isUsableChainTokenAddress = (tokenAddress) => Boolean(
  tokenAddress
  && typeof tokenAddress === 'string'
  && tokenAddress !== ZERO_ADDRESS,
);

const isPositiveOnchainId = (value) => {
  if (value === null || value === undefined || value === '') return false;
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
};

// [TR] window.confirm yoksa (gömülü/kısıtlı tarayıcı) eskiden sessizce "hayır" sayılıyor, kullanıcı butona
//      basıp hiçbir şey olmadığını görüyordu. Artık null döner ve çağıran kullanıcıya bildirir.
// [EN] A missing window.confirm used to silently mean "no"; now callers get null and tell the user.
const getConfirm = () => {
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') return window.confirm.bind(window);
  return null;
};

const resolveLoadingState = (isContractLoading) => (
  typeof isContractLoading === 'function' ? isContractLoading() : Boolean(isContractLoading)
);

const isSameTrade = (trade, onchainId) => {
  const current = String(trade?.onchainId ?? '');
  return current !== '' && current === String(onchainId ?? '');
};

const fetchAttempts = 6;
const FETCH_RETRY_MS = 2000;

/**
 * [TR] Fill tx'i zincire yazıldı ama OrderFilled olayından tradeId okunamadıysa "tekrar dene" demek çifte doldurma
 *      riskidir. Bunun yerine backend'in /trades/my kaydında parent order + doldurulan tutar + rol ile trade aranır.
 * [EN] The fill is already on chain; "retry" would double-fill. Find the trade in /trades/my by parent order,
 *      filled amount and role instead.
 */
const findFilledTradeViaBackend = async ({ authenticatedFetch, order, address, side, fillAmountRaw, sleep }) => {
  const me = String(address || '').toLowerCase();
  for (let attempt = 0; attempt < fetchAttempts; attempt += 1) {
    try {
      const res = await authenticatedFetch(buildApiUrl('trades/my?page=1&limit=50'));
      if (res?.ok) {
        const data = await res.json();
        const found = (data?.trades || []).find((t) => {
          if (String(t?.parent_order_id ?? '') !== String(order.onchainId)) return false;
          // Sell emrini dolduran taker, buy emrini dolduran maker olur.
          const mine = side === 'BUY_CRYPTO' ? t?.maker_address : t?.taker_address;
          if (String(mine || '').toLowerCase() !== me) return false;
          return String(t?.financials?.crypto_amount ?? '') === fillAmountRaw.toString();
        });
        if (found?.onchain_escrow_id !== undefined && found?.onchain_escrow_id !== null && found?._id) {
          return { onchainId: String(found.onchain_escrow_id), id: found._id };
        }
      }
    } catch (_) {}
    if (attempt < fetchAttempts - 1) await sleep(FETCH_RETRY_MS);
  }
  return null;
};

export const buildStartTradeAction = ({
  lang = 'EN',
  address,
  isBanned,
  isContractLoading,
  supportedTokenAddresses,
  getOrder,
  getAllowance,
  approveToken,
  fillSellOrder,
  fillBuyOrder,
  createSellOrder,
  createBuyOrder,
  cancelSellOrder,
  cancelBuyOrder,
  authenticatedFetch,
  showToast,
  setIsContractLoading,
  setLoadingText,
  setActiveTrade,
  setTradeState,
  setCancelStatus,
  setChargebackAccepted,
  setCurrentView,
  // [TR] Fill sonrası rol: buy emrini dolduran maker, sell emrini dolduran taker olur.
  setUserRole = null,
  fetchMyTrades = null,
  // [TR] Tam approve tutarı için (yoksa muhafazakâr üst sınır): backend bondMap + cüzdan itibarı okuyucusu.
  bondMap = null,
  getReputation = null,
  confirmFn = null,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) => async (order) => {
  const confirm = confirmFn || getConfirm();
  if (!confirm) {
    showToast(
      lang === 'TR'
        ? 'Bu tarayıcıda onay penceresi kullanılamıyor. Lütfen işlemi standart bir tarayıcıdan yapın.'
        : 'Confirmation dialogs are unavailable in this browser. Please use a standard browser to continue.',
      'error'
    );
    return;
  }
  if (!confirm(lang === 'TR' ? 'İşlemi onaylıyor musunuz?' : 'Do you confirm the transaction?')) return;
  if (isBanned) {
    showToast(
      lang === 'TR'
        ? 'Taker kısıtlamanız aktif. Süre için on-chain kaydınızı kontrol edin.'
        : 'Taker restriction active. Check on-chain record for duration.',
      'error'
    );
    return;
  }
  if (!order?.onchainId) {
    showToast(
      lang === 'TR'
        ? 'Bu order için on-chain ID henüz yok. Lütfen daha sonra tekrar deneyin.'
        : 'This order has no on-chain ID yet. Please try again later.',
      'error'
    );
    return;
  }
  if (resolveLoadingState(isContractLoading)) return;

  let tokenAddress = null;

  try {
    setIsContractLoading(true);
    tokenAddress = supportedTokenAddresses[order.crypto || 'USDT'];

    if (!tokenAddress) {
      showToast(
        lang === 'TR'
          ? `${order.crypto} token adresi .env dosyasında tanımlı değil.`
          : `${order.crypto} token address not configured.`,
        'error'
      );
      return;
    }

    const onchainOrder = await getOrder(BigInt(order.onchainId));
    const orderRemaining = getOnchainOrderField(onchainOrder, 'remainingAmount', 5) ?? 0n;
    const tokenFromChain = getOnchainOrderField(onchainOrder, 'tokenAddress', 3) ?? null;

    const remainingAmountRaw = BigInt(orderRemaining || 0n);
    if (remainingAmountRaw <= 0n) {
      showToast(
        lang === 'TR'
          ? 'Order dolu veya geçersiz görünüyor. Lütfen listeyi yenileyin.'
          : 'Order appears filled/invalid. Please refresh order feed.',
        'error'
      );
      return;
    }
    const orderMinFill = getOnchainOrderField(onchainOrder, 'minFillAmount', 6) ?? 0n;

    // [TR] Partial-fill input parse/guard fail-closed:
    //      geçersiz değerlerde sessiz remaining fallback YOK.
    // [EN] Partial-fill parse/guard is fail-closed:
    //      no silent fallback to remaining on invalid input.
    const fillAmountRaw = resolveValidatedFillAmountRaw({
      fillAmountRaw: order.fillAmountRaw,
      remainingAmountRaw,
      minFillAmountRaw: BigInt(orderMinFill || 0n),
      lang,
    });

    const side = normalizeOrderSide(String(order.side || '').toUpperCase());
    if (side === 'UNKNOWN') {
      throw new Error(lang === 'TR' ? 'Geçersiz order side. İşlem başlatılamadı.' : 'Invalid order side. Cannot start trade.');
    }
    const { fillFn: fillOrderFn } = resolveOrderActionFns(side, { fillBuyOrder, fillSellOrder, createBuyOrder, createSellOrder, cancelBuyOrder, cancelSellOrder });
    if (isUsableChainTokenAddress(tokenFromChain)) {
      tokenAddress = tokenFromChain;
    }

    // [TR] Approve tutarı kontratın çekeceği tam miktardır (fill + teminat ya da yalnız teminat; tier + itibara
    //      göre, aşağı yuvarlı). Eski "fill * 2" gereğinden çok büyük izin istiyordu. İtibar okunamazsa
    //      muhafazakâr üst sınır kullanılır. Başarısızlıkta otomatik approve(0) istenmez.
    // [EN] Approve the exact amount the contract pulls (fill + bond, or bond only). Not 2x; no auto approve(0).
    let reputation = null;
    if (typeof getReputation === 'function') {
      try { reputation = await getReputation(address); } catch (_) { reputation = null; }
    }
    const requiredAllowance = computeFillAllowance({
      side,
      fillAmountRaw,
      tier: getOnchainOrderField(onchainOrder, 'tier', 11),
      bondMap,
      reputation,
    });

    const currentAllowance = await getAllowance(tokenAddress, address);
    if (currentAllowance < requiredAllowance) {
      setLoadingText(
        lang === 'TR'
          ? `Adım 1/2: ${order.crypto} izni veriliyor...`
          : `Step 1/2: Approving ${order.crypto}...`
      );
      await approveToken(tokenAddress, requiredAllowance);
    }

    setLoadingText(
      lang === 'TR'
        ? 'Adım 2/2: Order fill işlemi gönderiliyor...'
        : 'Step 2/2: Submitting order fill...'
    );
    const childTradeRef = `fill:${order.onchainId}:${Date.now()}:${Math.random()}`;
    const childRefHash = keccak256(stringToHex(childTradeRef));
    const fillResult = await fillOrderFn(BigInt(order.onchainId), fillAmountRaw, childRefHash);
    let onchainTradeId = fillResult?.tradeId ? fillResult.tradeId.toString() : null;
    let realTradeId = null;
    // [TR] Buy emrini dolduran maker, sell emrini dolduran taker olur (kontrat: fillBuyOrder → maker = msg.sender).
    const myRole = side === 'BUY_CRYPTO' ? 'maker' : 'taker';

    // [TR] Trade odası state'i order id ile değil child trade id ile açılmalıdır. Tx zincire yazıldıysa ama olaydan
    //      id okunamadıysa "tekrar dene" çifte doldurma riskidir: trade backend kaydından bulunur.
    // [EN] Trade room state must use the child trade id. If the fill is on chain but the id could not be decoded,
    //      look the trade up via the backend instead of asking the user to retry (double fill).
    if (!onchainTradeId) {
      const found = await findFilledTradeViaBackend({ authenticatedFetch, order, address, side, fillAmountRaw, sleep });
      if (!found) {
        showToast(
          lang === 'TR'
            ? 'Doldurma işlemi zincire yazıldı ancak işlem kimliği okunamadı. Tekrar denemeyin; "Aktif İşlemler" ekranını kontrol edin.'
            : 'The fill was confirmed on-chain but the trade id could not be read. Do not retry; check "Active Trades".',
          'info'
        );
        if (typeof fetchMyTrades === 'function') {
          try { await fetchMyTrades(); } catch (_) {}
        }
        return;
      }
      onchainTradeId = found.onchainId;
      realTradeId = found.id;
    }

    // Backend trade kaydı listener gecikmesiyle gelebilir.
    // Bu yüzden birkaç deneme yapılır; gerçek trade ID yoksa sahte/fallback ID ile devam edilmez.
    for (let attempt = 0; !realTradeId && attempt < fetchAttempts; attempt++) {
      try {
        const res = await authenticatedFetch(buildApiUrl(`trades/by-escrow/${onchainTradeId}`));
        if (res.ok) {
          const data = await res.json();
          realTradeId = data.trade?._id;
          if (realTradeId) break;
        }
      } catch (_) {}
      if (attempt < fetchAttempts - 1) await sleep(FETCH_RETRY_MS);
    }

    if (!realTradeId) {
      showToast(
        lang === 'TR'
          ? 'İşlem zincire yazıldı ancak backend kaydı henüz oluşmadı. Birkaç saniye sonra "Aktif İşlemler" ekranını kontrol edin.'
          : 'Trade was written on-chain but backend record is not ready yet. Check "Active Trades" in a few seconds.',
        'info'
      );

      setActiveTrade({
        ...order,
        id: null,
        onchainId: onchainTradeId,
        _pendingBackendSync: true,
      });
      if (typeof setUserRole === 'function') setUserRole(myRole);
      setTradeState('LOCKED');
      setCancelStatus(null);
      setChargebackAccepted(false);
      setCurrentView('tradeRoom');
      return;
    }

    setActiveTrade({ ...order, id: realTradeId, onchainId: onchainTradeId });
    if (typeof setUserRole === 'function') setUserRole(myRole);
    setTradeState('LOCKED');
    setCancelStatus(null);
    setChargebackAccepted(false);
    setCurrentView('tradeRoom');
    showToast(lang === 'TR' ? 'İşlem başarıyla kilitlendi!' : 'Trade locked successfully!', 'success');
  } catch (err) {
    console.error('handleStartTrade error:', err);

    const errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'İşlem kilitlenemedi.' : 'Failed to lock trade.');
    if (errorMessage.includes('rejected') || errorMessage.includes('User rejected')) {
      showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
    } else {
      showToast(errorMessage, 'error');
    }
  } finally {
    setIsContractLoading(false);
    setLoadingText('');
  }
};

const getTxErrorMessage = (err, fallback) => err?.shortMessage || err?.reason || err?.message || fallback;
const isUserRejected = (message) => String(message || '').includes('rejected') || String(message || '').includes('User rejected');

export const buildMintAction = ({
  lang = 'EN',
  isConnected,
  isFaucetEnabled,
  supportedTokenAddresses,
  mintToken,
  showToast,
  setIsContractLoading,
  setLoadingText,
}) => async (tokenName) => {
  if (!isConnected) {
    showToast(lang === 'TR' ? 'Önce cüzdanınızı bağlayın.' : 'Please connect your wallet first.', 'error');
    return;
  }
  try {
    if (!isFaucetEnabled) {
      throw new Error(lang === 'TR'
        ? 'Production ortamında test faucet devre dışıdır.'
        : 'Test faucet is disabled in production.');
    }
    setIsContractLoading(true);
    setLoadingText(lang === 'TR' ? `${tokenName} alınıyor...` : `Minting ${tokenName}...`);
    const tokenAddr = supportedTokenAddresses[tokenName];
    if (!tokenAddr) throw new Error(lang === 'TR' ? `Test ${tokenName} adresi tanımlı değil.` : `Test ${tokenName} address not defined.`);
    await mintToken(tokenAddr);
    showToast(lang === 'TR' ? `Test ${tokenName} başarıyla alındı!` : `Test ${tokenName} minted successfully!`, 'success');
  } catch (err) {
    showToast(getTxErrorMessage(err, lang === 'TR' ? 'İşlem başarısız.' : 'Transaction failed.'), 'error');
  } finally {
    setIsContractLoading(false);
    setLoadingText('');
  }
};

export const buildTradeRoomActions = ({
  lang = 'EN',
  activeTrade,
  activeEscrows = [],
  paymentIpfsHash = '',
  resolvedTradeState,
  chargebackAccepted,
  isContractLoading,
  canMakerStartChallengeFlow,
  canMakerChallenge,
  reportPayment,
  proposeOrApproveCancel,
  expirePaymentWindow,
  cancelStatus = null,
  releaseFunds,
  pingTakerForChallenge,
  challengeTrade,
  pingMaker,
  autoRelease,
  burnExpired,
  authenticatedFetch,
  showToast,
  fetchMyTrades,
  setIsContractLoading,
  setActiveTrade,
  setTradeState,
  setPaymentIpfsHash,
  setCancelStatus,
  setChargebackAccepted,
  setCurrentView,
  // [TR] Tx sonrası durumu kontrattan okumak (getTrade) ve backend aynası yetişene kadar pin'lemek için.
  getTrade = null,
  pinTradeState = null,
  fetchFn = fetch,
}) => {
  // [TR] fetchMyTrades hatası, zincirde başarılı olmuş bir tx'i "başarısız" gösterdiği için ayrı korunur.
  // [EN] A refresh failure must not make an already-confirmed tx look failed.
  const refreshTrades = async () => {
    if (typeof fetchMyTrades !== 'function') return;
    try {
      await fetchMyTrades();
    } catch (err) {
      console.error('fetchMyTrades after tx failed:', err);
    }
  };

  // [TR] İyimser durum yerine kontrattaki gerçek durum okunur; RPC geride kalırsa beklenen durum kullanılır.
  //      Sonuç pin'lenir: gecikmeli backend aynası daha eski bir durumla ezmez.
  // [EN] Read the real state from the contract after a tx (fall back to the expected one) and pin it so a lagging
  //      mirror cannot overwrite it.
  const confirmTradeState = async (onchainId, expectedState) => {
    let chainState = null;
    if (typeof getTrade === 'function') {
      try { chainState = mapChainTradeState(await getTrade(onchainId)); } catch (_) { chainState = null; }
    }
    const state = resolveConfirmedState(chainState, expectedState);
    if (typeof pinTradeState === 'function') pinTradeState(onchainId, state);
    return state;
  };

  const finishTrade = async (state, onchainId = activeTrade?.onchainId) => {
    const confirmed = await confirmTradeState(onchainId, state);
    // [TR] Oda yalnız biten trade açıksa kapatılır; başka bir trade'in odası ezilmez.
    if (!isSameTrade(activeTrade, onchainId)) return confirmed;
    setTradeState(confirmed);
    setActiveTrade(null);
    setCancelStatus(null);
    setChargebackAccepted(false);
    // [TR] Odadan çıkışta #/trade/.. hash'i temizlenir; yoksa yenileme/hashchange kullanıcıyı geri çeker.
    clearAppHashRoute();
    setCurrentView('home');
    return confirmed;
  };

  const applyConfirmedState = async (onchainId, expectedState, patch = {}) => {
    const confirmed = await confirmTradeState(onchainId, expectedState);
    // [TR] Yalnız hâlâ aynı trade açıksa: başka/null trade ezilmez.
    if (isSameTrade(activeTrade, onchainId)) setTradeState(confirmed);
    setActiveTrade((prev) => (isSameTrade(prev, onchainId) ? { ...prev, state: confirmed, ...patch } : prev));
    return confirmed;
  };

  const invalidOnchainIdMessage = lang === 'TR' ? 'On-chain işlem ID bulunamadı.' : 'On-chain trade ID not found.';
  const requireActiveOnchainId = () => {
    if (isPositiveOnchainId(activeTrade?.onchainId)) return true;
    showToast(invalidOnchainIdMessage, 'error');
    return false;
  };
  const requireOnchainIdValue = (tradeId) => {
    if (isPositiveOnchainId(tradeId)) return true;
    showToast(invalidOnchainIdMessage, 'error');
    return false;
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!requireActiveOnchainId()) return;
    try {
      setIsContractLoading(true);
      const formData = new FormData();
      formData.append('receipt', file);
      formData.append('onchainEscrowId', String(activeTrade.onchainId));
      // [TR] Backend requireSessionWalletMatch x-wallet-address başlığı ister; düz fetch ile her
      //      yükleme 401 dönüyordu. authenticatedFetch başlığı ekler ve oturumu yeniler.
      // [EN] Backend requires the x-wallet-address header; a plain fetch always got 401.
      const doFetch = authenticatedFetch || fetchFn;
      const res = await doFetch(buildApiUrl('receipts/upload'), {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.hash) {
        setPaymentIpfsHash(data.hash);
        showToast(lang === 'TR' ? 'Dekont yüklendi.' : 'Receipt uploaded.', 'success');
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Dekont yükleme hatası:', err);
      const detail = err?.message && err.message !== 'Upload failed' ? ` ${err.message}` : '';
      showToast((lang === 'TR' ? 'Dekont yüklenemedi.' : 'Failed to upload receipt.') + detail, 'error');
    } finally {
      if (e?.target) e.target.value = '';
      setIsContractLoading(false);
    }
  };

  const handleReportPayment = async () => {
    if (!requireActiveOnchainId()) return;
    if (!paymentIpfsHash.trim()) {
      showToast(lang === 'TR' ? 'Önce bir dekont yüklemelisiniz.' : 'You must upload a receipt first.', 'error');
      return;
    }
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Ödeme bildirimi gönderiliyor... Cüzdanınızdan onaylayın.' : 'Reporting payment... Confirm in wallet.', 'info');
      await reportPayment(BigInt(activeTrade.onchainId), paymentIpfsHash.trim());
      await applyConfirmedState(activeTrade.onchainId, 'PAID');
      setPaymentIpfsHash('');
      showToast(lang === 'TR' ? 'Ödeme bildirildi! 48 saatlik grace period başladı.' : 'Payment reported! 48h grace period started.', 'success');
    } catch (err) {
      console.error('handleReportPayment error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'Ödeme bildirimi başarısız.' : 'Payment report failed.');
      showToast(isUserRejected(errorMessage) ? (lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.') : errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  const handleProposeCancel = async () => {
    if (!requireActiveOnchainId()) return;
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'İptal onayı gönderiliyor... Cüzdanınızdan onaylayın.' : 'Sending cancel consent... Confirm in wallet.', 'info');
      // [TR] İptal tamamen on-chain: her taraf kendi tx'ini gönderir, ikinci onay iptali yürütür.
      //      Ayrı imza/backend rölesi yok; karşı tarafın onayı mirror'daki CancelProposed'dan bilinir.
      // [EN] Cancel is fully on-chain: each party sends its own tx and the second consent executes it.
      //      No separate signature or backend relay; counterparty consent comes from the mirrored CancelProposed.
      const counterpartyAlreadyConsented = cancelStatus === 'proposed_by_other';
      const onchainId = activeTrade.onchainId;
      await proposeOrApproveCancel(onchainId);

      // [TR] İkinci onay iptali yürüttü mü, kontrattan okunur; okunamazsa aynadaki bilgi (cancelStatus) kullanılır.
      let chainState = null;
      if (typeof getTrade === 'function') {
        try { chainState = mapChainTradeState(await getTrade(onchainId)); } catch (_) { chainState = null; }
      }
      const executed = chainState ? chainState === 'CANCELED' : counterpartyAlreadyConsented;

      if (executed) {
        await finishTrade('CANCELED', onchainId);
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Trade cancelled.', 'success');
      } else {
        setCancelStatus('proposed_by_me');
        showToast(lang === 'TR' ? 'İptal teklifi gönderildi. Karşı taraf onaylayınca işlem kapanır.' : 'Cancel proposed. It completes when the counterparty approves.', 'success');
      }
      refreshTrades();
    } catch (err) {
      console.error('handleProposeCancel error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'İptal teklifi başarısız.' : 'Cancel proposal failed.');
      showToast(isUserRejected(errorMessage) ? (lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.') : errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  // [TR] LOCKED trade'de 48 saatlik ödeme penceresi dolduysa kilit zamanla çözülür (maker tam iade alır).
  // [EN] Once the 48h payment window on a LOCKED trade has passed, the lock unwinds by time (maker refunded in full).
  const handleExpirePaymentWindow = async () => {
    if (isContractLoading || !requireActiveOnchainId()) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Kilit çözülüyor... Cüzdanınızdan onaylayın.' : 'Unlocking... Confirm in wallet.', 'info');
      await expirePaymentWindow(activeTrade.onchainId);
      await finishTrade('CANCELED');
      showToast(lang === 'TR' ? 'Ödeme süresi doldu; fonlar satıcıya iade edildi.' : 'Payment window expired; funds returned to the seller.', 'success');
      refreshTrades();
    } catch (err) {
      console.error('expirePaymentWindow error:', err);
      showToast(getTxErrorMessage(err, lang === 'TR' ? 'Kilit çözülemedi.' : 'Unlock failed.'), 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  const handleChargebackAck = (checked) => { setChargebackAccepted(checked); };

  const handleRelease = async () => {
    if (resolvedTradeState === 'PAID' && !chargebackAccepted) {
      showToast(lang === 'TR' ? 'Lütfen ters ibraz riskini kabul edin.' : 'Please acknowledge the chargeback risk.', 'error');
      return;
    }
    if (!requireActiveOnchainId()) return;
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      // [TR] Backend kaydı (id) henüz yoksa (_pendingBackendSync) istek "trades/null/..." olurdu; atlanır.
      if (activeTrade.id) {
        try {
          await authenticatedFetch(buildApiUrl(`trades/${activeTrade.id}/chargeback-ack`), { method: 'POST' });
        } catch (err) {
          console.error('Backend chargeback-ack log hatası:', err);
        }
      }
      showToast(lang === 'TR' ? 'İşlem cüzdanınıza gönderildi, onaylayın...' : 'Transaction sent to wallet, please confirm...', 'info');
      await releaseFunds(BigInt(activeTrade.onchainId));
      await finishTrade('RESOLVED');
      // [TR] Sabit "USDT" yerine trade'in gerçek token sembolü (USDC işlemi "USDT serbest bırakıldı" demesin).
      const symbol = activeTrade.crypto || activeTrade.cryptoAsset || 'USDT';
      showToast(lang === 'TR' ? `${symbol} başarıyla serbest bırakıldı!` : `${symbol} successfully released!`, 'success');
    } catch (err) {
      console.error('releaseFunds error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'Kontrat işlemi başarısız oldu.' : 'Contract transaction failed.');
      showToast(isUserRejected(errorMessage) ? (lang === 'TR' ? 'İşlem sizin tarafınızdan iptal edildi.' : 'Transaction cancelled by you.') : errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  const handleChallenge = async () => {
    if (!requireActiveOnchainId() || isContractLoading) return;
    const tradeDetails = activeEscrows.find((e) => e.id === `#${activeTrade.onchainId}`);
    const challengePingedAt = activeTrade?.challengePingedAt || tradeDetails?.challengePingedAt;
    if (!challengePingedAt && !canMakerStartChallengeFlow) {
      showToast(lang === 'TR' ? 'Ping için 24 saat dolmadan işlem gönderemezsiniz.' : 'You cannot ping before the 24-hour cooldown ends.', 'error');
      return;
    }
    if (challengePingedAt && !canMakerChallenge) {
      showToast(lang === 'TR' ? 'Resmi itiraz için ping sonrası 24 saat beklenmeli.' : 'You must wait 24h after ping before opening a challenge.', 'error');
      return;
    }
    if (!challengePingedAt) {
      try {
        setIsContractLoading(true);
        showToast(lang === 'TR' ? 'Alıcıya uyarı gönderiliyor...' : 'Pinging taker...', 'info');
        const onchainId = activeTrade.onchainId;
        await pingTakerForChallenge(BigInt(onchainId));
        const pingedAt = new Date().toISOString();
        setActiveTrade((prev) => (isSameTrade(prev, onchainId) ? { ...prev, challengePingedAt: pingedAt } : prev));
        await refreshTrades();
        showToast(lang === 'TR' ? 'Alıcı uyarıldı. İtiraz için 24 saat beklemeniz gerekiyor.' : 'Taker pinged. You must wait 24h to challenge.', 'success');
      } catch (err) {
        console.error('pingTakerForChallenge error:', err);
        const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'Uyarı gönderilemedi.' : 'Failed to send ping.');
        showToast(errorMessage.includes('ConflictingPingPath') ? (lang === 'TR' ? 'Karşı taraf farklı bir uyarı/itiraz akışı başlattı. Bu yolu artık kullanamazsınız.' : 'Counterparty already started another ping/challenge path. This flow is no longer available.') : errorMessage, 'error');
      } finally {
        setIsContractLoading(false);
      }
      return;
    }
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'İtiraz işlemi cüzdanınıza gönderildi...' : 'Challenge transaction sent to wallet...', 'info');
      const onchainId = activeTrade.onchainId;
      await challengeTrade(BigInt(onchainId));
      await applyConfirmedState(onchainId, 'CHALLENGED', { challengedAt: new Date().toISOString() });
      await refreshTrades();
      showToast(lang === 'TR' ? 'İtiraz başlatıldı. Bleeding Escrow aktif.' : 'Challenge opened. Bleeding Escrow active.', 'success');
    } catch (err) {
      console.error('challengeTrade error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'İtiraz işlemi başarısız.' : 'Challenge failed.');
      showToast(errorMessage.includes('ConflictingPingPath') ? (lang === 'TR' ? 'Karşı taraf farklı bir uyarı/itiraz akışı başlattı. Bu yolu artık kullanamazsınız.' : 'Counterparty already started another ping/challenge path. This flow is no longer available.') : errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  const handlePingMaker = async (tradeId) => {
    if (!requireOnchainIdValue(tradeId) || isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Uyarı işlemi cüzdanınıza gönderiliyor...' : 'Pinging maker, please confirm in wallet...', 'info');
      await pingMaker(BigInt(tradeId));
      const pingedAt = new Date().toISOString();
      setActiveTrade((prev) => (isSameTrade(prev, tradeId) ? { ...prev, pingedAt } : prev));
      showToast(lang === 'TR' ? 'Maker uyarıldı. Yanıt için 24 saati var.' : 'Maker has been pinged. They have 24h to respond.', 'success');
    } catch (err) {
      console.error('pingMaker error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'Ping işlemi başarısız oldu.' : 'Ping failed.');
      const message = errorMessage.includes('ConflictingPingPath')
        ? (lang === 'TR' ? 'Karşı taraf farklı bir uyarı/itiraz akışı başlattı. Bu yolu artık kullanamazsınız.' : 'Counterparty already started another ping/challenge path. This flow is no longer available.')
        : isUserRejected(errorMessage) ? (lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.') : errorMessage;
      showToast(message, 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  const handleAutoRelease = async (tradeId) => {
    if (!requireOnchainIdValue(tradeId) || isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Otomatik serbest bırakma işlemi cüzdanınıza gönderiliyor...' : 'Auto-release transaction sent to wallet...', 'info');
      await autoRelease(BigInt(tradeId));
      await finishTrade('RESOLVED', tradeId);
      showToast(lang === 'TR' ? 'İşlem başarıyla sonlandırıldı. Fonlar cüzdanınıza aktarıldı.' : 'Trade successfully resolved. Funds transferred to your wallet.', 'success');
    } catch (err) {
      console.error('autoRelease error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'Otomatik serbest bırakma başarısız oldu.' : 'Auto-release failed.');
      showToast(isUserRejected(errorMessage) ? (lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.') : errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
    }
  };


  const handleBurnExpired = async () => {
    if (isContractLoading || !requireActiveOnchainId()) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Yakma işlemi gönderiliyor... Cüzdanınızdan onaylayın.' : 'Burn transaction sent... Confirm in wallet.', 'info');
      await burnExpired(BigInt(activeTrade.onchainId));
      await finishTrade('BURNED');
      showToast(lang === 'TR' ? 'Süre doldu: kilitli tutar ve teminatlar hazineye aktarıldı.' : 'Expired: locked amount and bonds moved to treasury.', 'success');
    } catch (err) {
      console.error('burnExpired error:', err);
      const reason = getTxErrorMessage(err, lang === 'TR' ? 'Yakma işlemi başarısız.' : 'Burn failed.');
      showToast(reason, 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  return {
    handleFileUpload,
    handleReportPayment,
    handleProposeCancel,
    handleChargebackAck,
    handleRelease,
    handleChallenge,
    handlePingMaker,
    handleAutoRelease,
    handleBurnExpired,
    handleExpirePaymentWindow,
  };
};

export const buildProfileActions = ({
  lang = 'EN',
  isContractLoading,
  isRegisteringWallet,
  isWalletRegistered,
  payoutProfileDraft,
  requireSignedSessionForActiveWallet,
  authenticatedFetch,
  canonicalizePayoutProfileDraft,
  registerWallet,
  showToast,
  setIsContractLoading,
  setIsRegisteringWallet,
  setIsWalletRegistered,
}) => {
  const handleUpdatePII = async (e) => {
    e.preventDefault();
    if (isContractLoading) return;
    if (!requireSignedSessionForActiveWallet()) return;
    try {
      setIsContractLoading(true);
      const res = await authenticatedFetch(buildApiUrl('auth/profile'), {
        method: 'PUT',
        body: JSON.stringify({ payoutProfile: canonicalizePayoutProfileDraft(payoutProfileDraft) }),
      });
      // [TR] Durum önce kontrol edilir, gövde güvenli okunur (JSON olmayan/boş yanıt akışı kırmaz).
      const readBody = async () => {
        try { return (await res.json()) || {}; } catch { return {}; }
      };
      if (res.status === 409) {
        const body = await readBody();
        // Oturum-cüzdan uyuşmazlığı authenticatedFetch tarafından zaten işlendi (çıkış + bildirim); yanıltıcı
        // "aktif trade" mesajı gösterme.
        if (body.code === 'SESSION_WALLET_MISMATCH') return;
        throw new Error(lang === 'TR' ? 'Aktif trade varken payout profili değiştirilemez.' : 'Payout profile cannot be changed during active trades.');
      }
      if (!res.ok) {
        const body = await readBody();
        throw new Error(body.error || (lang === 'TR' ? 'Güncelleme başarısız oldu.' : 'Update failed.'));
      }
      showToast(lang === 'TR' ? 'Ödeme profili güncellendi.' : 'Payout profile updated.', 'success');
    } catch (err) {
      console.error('PII update error:', err);
      showToast(err.message || (lang === 'TR' ? 'Profil güncelleme başarısız.' : 'Profile update failed.'), 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  const handleRegisterWallet = async () => {
    if (isRegisteringWallet || isWalletRegistered) return;
    try {
      setIsRegisteringWallet(true);
      showToast(lang === 'TR' ? 'Cüzdan kaydediliyor... Cüzdanınızdan onaylayın.' : 'Registering wallet... Confirm in wallet.', 'info');
      await registerWallet();
      setIsWalletRegistered(true);
      showToast(lang === 'TR' ? `Cüzdan kaydedildi! ${WALLET_AGE_MIN_DAYS} gün sonra Taker olarak işlem başlatabilirsiniz.` : `Wallet registered! You can start as Taker after ${WALLET_AGE_MIN_DAYS} days.`, 'success');
    } catch (err) {
      console.error('handleRegisterWallet error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'Kayıt başarısız.' : 'Registration failed.');
      if (err?.arafErrorName === 'AlreadyRegistered' || errorMessage.includes('AlreadyRegistered')) {
        setIsWalletRegistered(true);
        showToast(lang === 'TR' ? 'Cüzdan zaten kayıtlı.' : 'Wallet already registered.', 'info');
      } else if (isUserRejected(errorMessage)) {
        showToast(lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.', 'error');
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setIsRegisteringWallet(false);
    }
  };

  return { handleUpdatePII, handleRegisterWallet };
};

export const buildOrderActions = ({
  lang = 'EN',
  isContractLoading,
  requireSignedSessionForActiveWallet,
  fillSellOrder,
  fillBuyOrder,
  createSellOrder,
  createBuyOrder,
  cancelSellOrder,
  cancelBuyOrder,
  showToast,
  setIsContractLoading,
  setOrders,
  setMyOrders,
  setConfirmDeleteId,
}) => ({
  handleDeleteOrder: async (order) => {
    if (order?.onchainId == null || isContractLoading) return;
    if (!requireSignedSessionForActiveWallet()) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Order zincirde iptal ediliyor... Cüzdanınızdan onaylayın.' : 'Cancelling order on-chain... Confirm in wallet.', 'info');
      const normalizedSide = normalizeOrderSide(order?.side);
      if (normalizedSide === 'UNKNOWN') {
        throw new Error(lang === 'TR' ? 'Geçersiz order side. İptal işlemi durduruldu.' : 'Invalid order side. Cancel blocked.');
      }
      const { cancelFn } = resolveOrderActionFns(normalizedSide, { fillBuyOrder, fillSellOrder, createBuyOrder, createSellOrder, cancelBuyOrder, cancelSellOrder });
      await cancelFn(BigInt(order.onchainId));
      setOrders((prev) => removeOrderByOnchainId(prev, order.onchainId));
      setMyOrders((prev) => removeOrderByOnchainId(prev, order.onchainId));
      setConfirmDeleteId(null);
      showToast(lang === 'TR' ? 'Order iptal edildi.' : 'Order canceled.', 'success');
    } catch (err) {
      console.error('handleDeleteOrder error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'Order iptal edilemedi.' : 'Failed to cancel order.');
      showToast(isUserRejected(errorMessage) ? (lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.') : errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
    }
  },
});
