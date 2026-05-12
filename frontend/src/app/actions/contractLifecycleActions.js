import { buildApiUrl } from '../apiConfig';
import { resolveValidatedFillAmountRaw } from '../fillAmountPolicy';
import { normalizeOrderSide, removeOrderByOnchainId, resolveOrderActionFns } from '../orderUiModel';

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

const getConfirm = () => {
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') return window.confirm.bind(window);
  return () => false;
};

const resolveLoadingState = (isContractLoading) => (
  typeof isContractLoading === 'function' ? isContractLoading() : Boolean(isContractLoading)
);

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
  confirmFn = getConfirm(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) => async (order) => {
  if (!confirmFn(lang === 'TR' ? 'İşlemi onaylıyor musunuz?' : 'Do you confirm the transaction?')) return;
  if (isBanned) {
    showToast(
      lang === 'TR'
        ? '🚫 Taker kısıtlamanız aktif. Süre için on-chain kaydınızı kontrol edin.'
        : '🚫 Taker restriction active. Check on-chain record for duration.',
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
  let didIncreaseAllowance = false;

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

    // [TR] Frontend taker bond authority üretmez; bu hesap kontrata aittir.
    //      Approve için konservatif üst sınır kullanırız: fill amount * 2.
    // [EN] Frontend does not author taker-bond authority; contract does.
    //      For approve we use a conservative upper bound: fill amount * 2.
    const requiredAllowance = fillAmountRaw * 2n;

    const currentAllowance = await getAllowance(tokenAddress, address);
    if (currentAllowance < requiredAllowance) {
      setLoadingText(
        lang === 'TR'
          ? `Adım 1/2: ${order.crypto} izni veriliyor...`
          : `Step 1/2: Approving ${order.crypto}...`
      );
      await approveToken(tokenAddress, requiredAllowance);
      didIncreaseAllowance = true;
    }

    setLoadingText(
      lang === 'TR'
        ? 'Adım 2/2: Order fill işlemi gönderiliyor...'
        : 'Step 2/2: Submitting order fill...'
    );
    const childListingRef = `fill:${order.onchainId}:${Date.now()}:${Math.random()}`;
    const { keccak256, stringToHex } = await import('viem');
    const childRefHash = keccak256(stringToHex(childListingRef));
    const fillResult = await fillOrderFn(BigInt(order.onchainId), fillAmountRaw, childRefHash);
    const onchainTradeId = fillResult?.tradeId ? fillResult.tradeId.toString() : null;

    // [TR] Trade odası state'i order id ile değil child trade id ile açılmalıdır.
    //      Event decode edilemediyse belirsiz state ile devam etmeyip güvenli hata veririz.
    // [EN] Trade room state must be initialized with child trade id, not parent order id.
    //      If event decode fails, fail closed instead of continuing with ambiguous authority.
    if (!onchainTradeId) {
      throw new Error(
        lang === 'TR'
          ? 'OrderFilled eventinden child trade id okunamadı. Lütfen tekrar deneyin.'
          : 'Failed to read child trade id from OrderFilled event. Please retry.'
      );
    }

    // Backend trade kaydı listener gecikmesiyle gelebilir.
    // Bu yüzden birkaç deneme yapılır; gerçek trade ID yoksa sahte/fallback ID ile devam edilmez.
    let realTradeId = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await authenticatedFetch(buildApiUrl(`trades/by-escrow/${onchainTradeId}`));
        if (res.ok) {
          const data = await res.json();
          realTradeId = data.trade?._id;
          if (realTradeId) break;
        }
      } catch (_) {}
      if (attempt < 5) await sleep(2000);
    }

    if (!realTradeId) {
      showToast(
        lang === 'TR'
          ? '⚠️ İşlem zincire yazıldı ancak backend kaydı henüz oluşmadı. Birkaç saniye sonra "Aktif İşlemler" ekranını kontrol edin.'
          : '⚠️ Trade was written on-chain but backend record is not ready yet. Check "Active Trades" in a few seconds.',
        'info'
      );

      setActiveTrade({
        ...order,
        id: null,
        onchainId: onchainTradeId,
        _pendingBackendSync: true,
      });
      setTradeState('LOCKED');
      setCancelStatus(null);
      setChargebackAccepted(false);
      setCurrentView('tradeRoom');
      return;
    }

    setActiveTrade({ ...order, id: realTradeId, onchainId: onchainTradeId });
    setTradeState('LOCKED');
    setCancelStatus(null);
    setChargebackAccepted(false);
    setCurrentView('tradeRoom');
    showToast(lang === 'TR' ? '🔒 İşlem başarıyla kilitlendi!' : '🔒 Trade locked successfully!', 'success');
  } catch (err) {
    console.error('handleStartTrade error:', err);

    if (didIncreaseAllowance && tokenAddress) {
      try { await approveToken(tokenAddress, 0n); } catch (_) {}
    }

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
    showToast(lang === 'TR' ? `✅ Test ${tokenName} başarıyla alındı!` : `✅ Test ${tokenName} minted successfully!`, 'success');
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
  signCancelProposal,
  proposeOrApproveCancel,
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
  setLoadingText,
  fetchFn = fetch,
}) => {
  const finishTrade = (state) => {
    setTradeState(state);
    setActiveTrade(null);
    setCancelStatus(null);
    setChargebackAccepted(false);
    setCurrentView('home');
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!activeTrade?.onchainId) {
      showToast(lang === 'TR' ? 'Aktif işlem bulunamadı.' : 'No active trade found.', 'error');
      return;
    }
    try {
      setIsContractLoading(true);
      const formData = new FormData();
      formData.append('receipt', file);
      formData.append('onchainEscrowId', String(activeTrade.onchainId));
      const res = await fetchFn(buildApiUrl('receipts/upload'), {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const data = await res.json();
      if (res.ok && data.hash) {
        setPaymentIpfsHash(data.hash);
        showToast(lang === 'TR' ? 'Dekont şifrelendi ve yüklendi.' : 'Receipt encrypted and uploaded.', 'success');
      } else {
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Dekont yükleme hatası:', err);
      showToast(lang === 'TR' ? 'Dekont yüklenemedi.' : 'Failed to upload receipt.', 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  const handleReportPayment = async () => {
    if (!activeTrade?.onchainId) {
      showToast(lang === 'TR' ? 'On-chain işlem ID bulunamadı.' : 'On-chain trade ID not found.', 'error');
      return;
    }
    if (!paymentIpfsHash.trim()) {
      showToast(lang === 'TR' ? 'Önce bir dekont yüklemelisiniz.' : 'You must upload a receipt first.', 'error');
      return;
    }
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Ödeme bildirimi gönderiliyor... Cüzdanınızdan onaylayın.' : 'Reporting payment... Confirm in wallet.', 'info');
      await reportPayment(BigInt(activeTrade.onchainId), paymentIpfsHash.trim());
      setTradeState('PAID');
      setPaymentIpfsHash('');
      showToast(lang === 'TR' ? '✅ Ödeme bildirildi! 48 saatlik grace period başladı.' : '✅ Payment reported! 48h grace period started.', 'success');
    } catch (err) {
      console.error('handleReportPayment error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'Ödeme bildirimi başarısız.' : 'Payment report failed.');
      showToast(isUserRejected(errorMessage) ? (lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.') : errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  const handleProposeCancel = async () => {
    if (!activeTrade?.onchainId) {
      showToast(lang === 'TR' ? 'On-chain işlem ID bulunamadı.' : 'On-chain trade ID not found.', 'error');
      return;
    }
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'İptal imzası oluşturuluyor...' : 'Creating cancel signature...', 'info');
      const { signature, deadline } = await signCancelProposal(activeTrade.onchainId);
      try {
        const relayRes = await authenticatedFetch(buildApiUrl('trades/propose-cancel'), {
          method: 'POST',
          body: JSON.stringify({ tradeId: activeTrade.id, signature, deadline }),
        });
        const relayData = await relayRes.json();
        if (relayData.bothSigned) {
          showToast(lang === 'TR' ? 'Her iki taraf imzaladı. Kontrata gönderiliyor...' : 'Both signed. Sending to contract...', 'info');
          await proposeOrApproveCancel(BigInt(activeTrade.onchainId), deadline, signature);
          setCancelStatus(null);
          setTradeState('CANCELED');
          setCurrentView('home');
          showToast(lang === 'TR' ? '✅ İşlem iptal edildi.' : '✅ Trade cancelled.', 'success');
        } else {
          setCancelStatus('proposed_by_me');
          showToast(lang === 'TR' ? '✅ İptal teklifi gönderildi. Karşı tarafın onayı bekleniyor.' : '✅ Cancel proposal sent. Awaiting counterparty.', 'success');
        }
      } catch (relayErr) {
        console.warn('[Cancel] Backend relay başarısız, direkt on-chain fallback:', relayErr.message);
        showToast(lang === 'TR' ? 'Backend erişilemez. Kontrata direkt gönderiliyor...' : 'Backend unreachable. Sending directly to contract...', 'info');
        await proposeOrApproveCancel(BigInt(activeTrade.onchainId), deadline, signature);
        setCancelStatus('proposed_by_me');
        showToast(lang === 'TR' ? '✅ İptal teklifi kontrata gönderildi (direkt).' : '✅ Cancel proposal sent directly to contract.', 'success');
      }
    } catch (err) {
      console.error('handleProposeCancel error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'İptal teklifi başarısız.' : 'Cancel proposal failed.');
      showToast(isUserRejected(errorMessage) ? (lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.') : errorMessage, 'error');
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
    if (!activeTrade?.onchainId) {
      showToast(lang === 'TR' ? 'On-chain işlem ID bulunamadı.' : 'On-chain trade ID not found.', 'error');
      return;
    }
    if (isContractLoading) return;
    try {
      setIsContractLoading(true);
      try {
        await authenticatedFetch(buildApiUrl(`trades/${activeTrade.id}/chargeback-ack`), { method: 'POST' });
      } catch (err) {
        console.error('Backend chargeback-ack log hatası:', err);
      }
      showToast(lang === 'TR' ? 'İşlem cüzdanınıza gönderildi, onaylayın...' : 'Transaction sent to wallet, please confirm...', 'info');
      await releaseFunds(BigInt(activeTrade.onchainId));
      finishTrade('RESOLVED');
      showToast(lang === 'TR' ? 'USDT başarıyla serbest bırakıldı! ✅' : 'USDT successfully released! ✅', 'success');
    } catch (err) {
      console.error('releaseFunds error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'Kontrat işlemi başarısız oldu.' : 'Contract transaction failed.');
      showToast(isUserRejected(errorMessage) ? (lang === 'TR' ? 'İşlem sizin tarafınızdan iptal edildi.' : 'Transaction cancelled by you.') : errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
    }
  };

  const handleChallenge = async () => {
    if (!activeTrade?.onchainId || isContractLoading) return;
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
        await pingTakerForChallenge(BigInt(activeTrade.onchainId));
        setActiveTrade((prev) => ({ ...prev, challengePingedAt: new Date().toISOString() }));
        await fetchMyTrades();
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
      await challengeTrade(BigInt(activeTrade.onchainId));
      setTradeState('CHALLENGED');
      setActiveTrade((prev) => ({ ...prev, challengedAt: new Date().toISOString() }));
      await fetchMyTrades();
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
    if (!tradeId || isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Uyarı işlemi cüzdanınıza gönderiliyor...' : 'Pinging maker, please confirm in wallet...', 'info');
      await pingMaker(BigInt(tradeId));
      setActiveTrade((prev) => ({ ...prev, pingedAt: new Date().toISOString() }));
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
    if (!tradeId || isContractLoading) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Otomatik serbest bırakma işlemi cüzdanınıza gönderiliyor...' : 'Auto-release transaction sent to wallet...', 'info');
      await autoRelease(BigInt(tradeId));
      finishTrade('RESOLVED');
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
    if (isContractLoading || !activeTrade?.onchainId) return;
    try {
      setIsContractLoading(true);
      showToast(lang === 'TR' ? 'Yakma işlemi gönderiliyor... Cüzdanınızdan onaylayın.' : 'Burn transaction sent... Confirm in wallet.', 'info');
      await burnExpired(BigInt(activeTrade.onchainId));
      finishTrade('BURNED');
      showToast(lang === 'TR' ? '🔥 İşlem yakıldı. Maker bond protokole aktarıldı.' : '🔥 Trade burned. Maker bond transferred to protocol.', 'success');
    } catch (err) {
      console.error('burnExpired error:', err);
      const reason = err.reason || err.message || (lang === 'TR' ? 'Yakma işlemi başarısız.' : 'Burn failed.');
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
      const data = await res.json();
      if (res.status === 409) {
        throw new Error(lang === 'TR' ? 'Aktif trade varken payout profili değiştirilemez.' : 'Payout profile cannot be changed during active trades.');
      }
      if (!res.ok) throw new Error(data.error || 'Güncelleme başarısız oldu.');
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
      showToast(lang === 'TR' ? '✅ Cüzdan kaydedildi! 7 gün sonra Taker olarak işlem başlatabilirsiniz.' : '✅ Wallet registered! You can start as Taker after 7 days.', 'success');
    } catch (err) {
      console.error('handleRegisterWallet error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'Kayıt başarısız.' : 'Registration failed.');
      if (errorMessage.includes('AlreadyRegistered')) {
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
      showToast(lang === 'TR' ? '✅ Order iptal edildi.' : '✅ Order canceled.', 'success');
    } catch (err) {
      console.error('handleDeleteOrder error:', err);
      const errorMessage = getTxErrorMessage(err, lang === 'TR' ? 'Order iptal edilemedi.' : 'Failed to cancel order.');
      showToast(isUserRejected(errorMessage) ? (lang === 'TR' ? 'İşlem iptal edildi.' : 'Transaction cancelled.') : errorMessage, 'error');
    } finally {
      setIsContractLoading(false);
    }
  },
});
