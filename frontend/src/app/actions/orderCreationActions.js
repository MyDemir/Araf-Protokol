import { normalizeOrderSide, resolveOrderActionFns, resolvePaymentRiskEntry } from '../orderUiModel';

export const MAKER_ORDER_DEFAULTS = {
  makerTier: 1,
  makerAmount: '',
  makerRate: '',
  makerMinLimit: '',
  makerMaxLimit: '',
  makerFiat: 'TRY',
  makerToken: 'USDT',
  makerSide: 'SELL_CRYPTO',
};

export const MAKER_TIER_MAX_AMOUNTS = {
  0: 150,
  1: 1500,
  2: 7500,
  3: 30000,
};

export const getMakerOrderValidationError = ({
  makerAmount,
  makerTier,
  makerRate,
  makerMinLimit,
  makerMaxLimit,
  makerFiat,
  lang = 'EN',
}) => {
  const cryptoAmtNum = parseFloat(makerAmount) || 0;
  const rateNum = parseFloat(makerRate) || 0;
  const minLimNum = parseFloat(makerMinLimit) || 0;
  const maxLimNum = parseFloat(makerMaxLimit) || 0;
  const totalFiatValue = cryptoAmtNum * rateNum;

  if (!makerAmount || cryptoAmtNum <= 0) return lang === 'TR' ? 'Order miktarını giriniz.' : 'Enter order amount.';
  if (makerTier === 0 && cryptoAmtNum > MAKER_TIER_MAX_AMOUNTS[0]) return lang === 'TR' ? 'Tier 0 maksimum order limiti 150 USDT/USDC.' : 'Tier 0 max order limit is 150 USDT/USDC.';
  if (makerTier === 1 && cryptoAmtNum > MAKER_TIER_MAX_AMOUNTS[1]) return lang === 'TR' ? 'Tier 1 maksimum order limiti 1.500 USDT/USDC.' : 'Tier 1 max order limit is 1500 USDT/USDC.';
  if (makerTier === 2 && cryptoAmtNum > MAKER_TIER_MAX_AMOUNTS[2]) return lang === 'TR' ? 'Tier 2 maksimum order limiti 7.500 USDT/USDC.' : 'Tier 2 max order limit is 7500 USDT/USDC.';
  if (makerTier === 3 && cryptoAmtNum > MAKER_TIER_MAX_AMOUNTS[3]) return lang === 'TR' ? 'Tier 3 maksimum order limiti 30.000 USDT/USDC.' : 'Tier 3 max order limit is 30000 USDT/USDC.';
  if (!makerRate || rateNum <= 0) return lang === 'TR' ? 'Kur fiyatını giriniz.' : 'Enter exchange rate.';
  if (!makerMinLimit || minLimNum <= 0) return lang === 'TR' ? 'Minimum işlem limitini giriniz.' : 'Enter min limit.';
  if (!makerMaxLimit || maxLimNum <= 0) return lang === 'TR' ? 'Maksimum işlem limitini giriniz.' : 'Enter max limit.';
  if (minLimNum > maxLimNum) return lang === 'TR' ? 'Min limit, Max limitten büyük olamaz.' : 'Min limit cannot exceed Max.';
  if (maxLimNum > totalFiatValue) return lang === 'TR' ? `Max limit toplam değeri (${totalFiatValue.toFixed(2)} ${makerFiat}) aşamaz.` : `Max limit exceeds total fiat (${totalFiatValue.toFixed(2)} ${makerFiat}).`;
  return null;
};

export const getRestrictedPaymentRiskEntry = ({ paymentRiskConfig, canonicalPayoutProfile }) => {
  const selectedRiskEntry = resolvePaymentRiskEntry({
    paymentRiskConfig: paymentRiskConfig || {},
    rail: canonicalPayoutProfile?.rail,
    country: canonicalPayoutProfile?.country,
  });
  const isRestricted = selectedRiskEntry
    && (String(selectedRiskEntry.riskLevel || '').toUpperCase() === 'RESTRICTED' || selectedRiskEntry.enabled === false);
  return { selectedRiskEntry, isRestricted };
};

export const buildCreateOrderAction = ({
  getFormState,
  resetForm,
  requireSignedSessionForActiveWallet,
  supportedTokens,
  address,
  lang = 'EN',
  isContractLoading,
  setIsContractLoading,
  setLoadingText,
  setShowMakerModal,
  showToast,
  getTokenDecimals,
  getAllowance,
  approveToken,
  createSellOrder,
  createBuyOrder,
  fillSellOrder,
  fillBuyOrder,
  cancelSellOrder,
  cancelBuyOrder,
  canonicalizePayoutProfileDraft,
  payoutProfileDraft,
  paymentRiskConfig,
}) => async () => {
  if (!requireSignedSessionForActiveWallet()) return;

  const formState = getFormState();
  const {
    makerToken,
    makerAmount,
    makerRate,
    makerMinLimit,
    makerTier,
    makerSide,
  } = formState;

  const validationError = getMakerOrderValidationError({ ...formState, lang });
  if (validationError) {
    showToast(validationError, 'error');
    return;
  }

  const tokenMeta = supportedTokens[makerToken];
  let tokenAddress = tokenMeta?.address;
  if (!tokenMeta?.decimalsRequired) {
    showToast(
      lang === 'TR'
        ? 'Token metadata eksik: decimals bilgisi zorunludur.'
        : 'Token metadata missing: decimals is required.',
      'error'
    );
    return;
  }
  if (!tokenAddress) {
    showToast(
      lang === 'TR'
        ? `${makerToken} token adresi .env dosyasında tanımlı değil (VITE_${makerToken}_ADDRESS).`
        : `${makerToken} token address not configured in .env (VITE_${makerToken}_ADDRESS).`,
      'error'
    );
    return;
  }

  const cryptoAmt = parseFloat(makerAmount);
  if (!cryptoAmt || cryptoAmt <= 0) {
    showToast(lang === 'TR' ? 'Geçerli bir miktar girin.' : 'Enter a valid amount.', 'error');
    return;
  }

  if (!makerRate || parseFloat(makerRate) <= 0) {
    showToast(lang === 'TR' ? 'Kur fiyatı girilmeli.' : 'Enter an exchange rate.', 'error');
    return;
  }

  const canonicalPayoutProfile = canonicalizePayoutProfileDraft(payoutProfileDraft || {});
  const { selectedRiskEntry, isRestricted } = getRestrictedPaymentRiskEntry({
    paymentRiskConfig,
    canonicalPayoutProfile,
  });
  if (isRestricted) {
    showToast(
      lang === 'TR'
        ? 'Bu rail/country kombinasyonu availability config nedeniyle kısıtlı. Order oluşturulamadı.'
        : 'This rail/country pair is restricted by availability config. Order creation blocked.',
      'error'
    );
    return;
  }

  if (isContractLoading()) return;

  let didIncreaseAllowance = false;

  try {
    setIsContractLoading(true);

    const tokenDecimals = await getTokenDecimals(tokenAddress);
    const { parseUnits, keccak256, stringToHex } = await import('viem');
    const cryptoAmountRaw = parseUnits(String(cryptoAmt), tokenDecimals);

    // [TR] Frontend maker bond authority üretmez; kontrat authoritative hesap yapar.
    //      Approve aşamasında conservative upper-bound kullanırız: amount * 2.
    // [EN] Frontend does not author maker-bond authority; contract computes it.
    //      Use conservative upper-bound for approve: amount * 2.
    const requiredAllowance = cryptoAmountRaw * 2n;
    const rateNum = parseFloat(makerRate);
    const minFiat = parseFloat(makerMinLimit) || 0;
    const minFillUi = minFiat > 0 && rateNum > 0 ? (minFiat / rateNum) : cryptoAmt;
    const minFillAmountRaw = parseUnits(String(Math.max(0, minFillUi)), tokenDecimals);
    const boundedMinFill = minFillAmountRaw > cryptoAmountRaw ? cryptoAmountRaw : minFillAmountRaw;
    const orderRefSeed = `order:${address}:${makerToken}:${makerTier}:${cryptoAmountRaw.toString()}:${Date.now()}`;
    const orderRef = keccak256(stringToHex(orderRefSeed));

    const currentAllowance = await getAllowance(tokenAddress, address);
    if (currentAllowance < requiredAllowance) {
      setLoadingText(
        lang === 'TR'
          ? `Adım 1/2: ${makerToken} izni veriliyor...`
          : `Step 1/2: Approving ${makerToken}...`
      );
      await approveToken(tokenAddress, requiredAllowance);
      didIncreaseAllowance = true;
    }

    const normalizedSide = normalizeOrderSide(makerSide);
    if (normalizedSide === 'UNKNOWN') {
      throw new Error(lang === 'TR' ? 'Geçersiz order side. Order oluşturulamadı.' : 'Invalid order side. Order creation blocked.');
    }
    const { createFn } = resolveOrderActionFns(normalizedSide, { fillBuyOrder, fillSellOrder, createBuyOrder, createSellOrder, cancelBuyOrder, cancelSellOrder });
    const createLabel = normalizedSide === 'BUY_CRYPTO' ? 'Buy' : 'Sell';
    const selectedPaymentRiskLevel = String(selectedRiskEntry?.riskLevel || 'MEDIUM').toUpperCase();

    setLoadingText(
      lang === 'TR'
        ? `Adım 2/2: ${createLabel} order oluşturuluyor...`
        : `Step 2/2: Creating ${createLabel.toLowerCase()} order...`
    );
    await createFn(tokenAddress, cryptoAmountRaw, boundedMinFill, makerTier, orderRef, selectedPaymentRiskLevel);

    showToast(
      lang === 'TR'
        ? `✅ ${createLabel} order başarıyla oluşturuldu.`
        : `✅ ${createLabel} order created successfully.`,
      'success'
    );

    setShowMakerModal(false);
    resetForm();
  } catch (err) {
    console.error('handleCreateOrder error:', err);

    if (didIncreaseAllowance && tokenAddress) {
      try { await approveToken(tokenAddress, 0n); } catch (_) {}
    }

    let errorMessage = err.shortMessage || err.reason || err.message || (lang === 'TR' ? 'Order oluşturulamadı.' : 'Failed to create order.');
    if (errorMessage.includes('Efektif tier') || errorMessage.includes('effective tier')) {
      errorMessage += lang === 'TR'
        ? ' Not: Tier 1+ için ilk başarılı işlemden sonra 15 gün aktif dönem şartı da aranır.'
        : ' Note: Tier 1+ also requires a 15-day active period after first successful trade.';
    }

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
