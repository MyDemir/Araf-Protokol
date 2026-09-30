import { keccak256, stringToHex } from 'viem';
import { normalizeOrderSide, resolveOrderActionFns, resolvePaymentRiskEntry } from '../orderUiModel';
import { buildApiUrl } from '../apiConfig';
import { fmtNum } from '../copy';
import { computeCreateAllowance } from './allowanceMath';
import { computeMinFillRaw, parseDecimalToUnits } from './decimalUnits';

export const MAKER_ORDER_DEFAULTS = {
  makerTier: 1,
  makerAmount: '',
  makerRate: '',
  makerMinLimit: '',
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

/**
 * [TR] Kontrattaki token-bazlı tier limitlerini (base-unit) UI birimine çevirir.
 *      Config yoksa MAKER_TIER_MAX_AMOUNTS fallback'i kullanılır.
 * [EN] Converts on-chain per-token tier limits (base units) to UI units; falls back to defaults.
 */
export const resolveTierMaxAmounts = (tokenPolicy) => {
  const decimals = Number(tokenPolicy?.decimals);
  const limits = Array.isArray(tokenPolicy?.tierMaxAmountsBaseUnit) ? tokenPolicy.tierMaxAmountsBaseUnit : [];
  if (!Number.isInteger(decimals) || decimals <= 0 || decimals > 18 || limits.length < 4) return MAKER_TIER_MAX_AMOUNTS;
  const out = {};
  for (let tier = 0; tier < 4; tier += 1) {
    const value = Number(limits[tier]) / 10 ** decimals;
    // [TR] Kontrat: tierMax == 0 → limit yok (_createOrder yalnız tierMax > 0 iken kontrol eder).
    //      Eskiden 0 varsayılan küçük limite düşüyor ve geçerli emirleri engelliyordu.
    // [EN] On-chain 0 means "no cap"; it used to fall back to the small default and block valid orders.
    out[tier] = Number.isFinite(value) && value > 0 ? value : (Number(limits[tier]) === 0 ? Infinity : MAKER_TIER_MAX_AMOUNTS[tier]);
  }
  return out;
};

export const getMakerOrderValidationError = ({
  makerAmount,
  makerTier,
  makerRate,
  makerMinLimit,
  makerFiat,
  makerSide = 'SELL_CRYPTO',
  makerToken = 'USDT',
  tokenPolicy = null,
  tierMaxAmounts = MAKER_TIER_MAX_AMOUNTS,
  lang = 'EN',
}) => {
  const cryptoAmtNum = parseFloat(makerAmount) || 0;
  const rateNum = parseFloat(makerRate) || 0;
  const minLimNum = parseFloat(makerMinLimit) || 0;
  const totalFiatValue = cryptoAmtNum * rateNum;
  const tierMax = tierMaxAmounts?.[makerTier];

  // [TR] Kontrat token yön politikası (getTokenConfig): kapalı yön TokenDirectionNotAllowed ile revert eder.
  // [EN] Contract token direction policy; a closed direction reverts with TokenDirectionNotAllowed.
  if (tokenPolicy && tokenPolicy.supported === false) return lang === 'TR' ? `${makerToken} şu an kontratta desteklenmiyor.` : `${makerToken} is not supported by the contract right now.`;
  if (tokenPolicy && makerSide === 'SELL_CRYPTO' && tokenPolicy.allowSellOrders === false) return lang === 'TR' ? `${makerToken} için satış emri şu an kapalı.` : `Sell orders are closed for ${makerToken}.`;
  if (tokenPolicy && makerSide === 'BUY_CRYPTO' && tokenPolicy.allowBuyOrders === false) return lang === 'TR' ? `${makerToken} için alış emri şu an kapalı.` : `Buy orders are closed for ${makerToken}.`;
  if (!makerAmount || cryptoAmtNum <= 0) return lang === 'TR' ? 'Order miktarını giriniz.' : 'Enter order amount.';
  if (makerTier < 4 && Number.isFinite(tierMax) && cryptoAmtNum > tierMax) {
    const formatted = fmtNum(tierMax, lang);
    return lang === 'TR'
      ? `Tier ${makerTier} maksimum emir limiti ${formatted} ${makerToken}.`
      : `Tier ${makerTier} max order limit is ${formatted} ${makerToken}.`;
  }
  if (!makerRate || rateNum <= 0) return lang === 'TR' ? 'Kur fiyatını giriniz.' : 'Enter exchange rate.';
  // [TR] Min limit opsiyoneldir (boşsa emir tek seferde dolar). Max limit kontratta karşılığı olmayan
  //      eski bir alandır; yalnız girilmişse tutarlılık kontrol edilir.
  // [EN] Min limit is optional (empty = single fill). Max limit has no on-chain meaning; only
  //      validated for consistency when provided.
  if (makerMinLimit && minLimNum <= 0) return lang === 'TR' ? 'Minimum limit sıfırdan büyük olmalı.' : 'Min limit must be greater than zero.';
  if (makerMinLimit && minLimNum > totalFiatValue) return lang === 'TR' ? `Min limit toplam değeri (${totalFiatValue.toFixed(2)} ${makerFiat}) aşamaz.` : `Min limit exceeds total fiat (${totalFiatValue.toFixed(2)} ${makerFiat}).`;
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
  authenticatedFetch = null,
  tierMaxAmounts = MAKER_TIER_MAX_AMOUNTS,
  tokenPolicy = null,
  // [TR] Tam approve tutarı için: backend bondMap + cüzdan itibarı (yoksa muhafazakâr üst sınır kullanılır).
  bondMap = null,
  getReputation = null,
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
    makerFiat,
  } = formState;

  const validationError = getMakerOrderValidationError({ ...formState, tierMaxAmounts, tokenPolicy, lang });
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

  try {
    setIsContractLoading(true);

    const tokenDecimals = await getTokenDecimals(tokenAddress);
    // [TR] Dize tabanlı ayrıştırma: parseFloat/parseUnits(String(x)) üstel gösterimde ("1e-7") hatalıydı.
    const cryptoAmountRaw = parseDecimalToUnits(makerAmount, tokenDecimals);
    if (cryptoAmountRaw === null || cryptoAmountRaw <= 0n) {
      throw new Error(
        lang === 'TR'
          ? `Geçerli bir miktar girin (en fazla ${tokenDecimals} ondalık, üstel gösterim yok).`
          : `Enter a valid amount (up to ${tokenDecimals} decimals, no exponent notation).`
      );
    }
    const rateNum = parseFloat(makerRate);
    const minFillAmountRaw = computeMinFillRaw({
      minFiat: makerMinLimit,
      rate: makerRate,
      totalAmountRaw: cryptoAmountRaw,
      tokenDecimals,
    });
    if (minFillAmountRaw === null) {
      throw new Error(lang === 'TR' ? 'Kur veya minimum limit geçerli bir ondalık sayı değil.' : 'Rate or min limit is not a valid decimal number.');
    }
    const boundedMinFill = minFillAmountRaw > cryptoAmountRaw ? cryptoAmountRaw : minFillAmountRaw;
    const orderRefSeed = `order:${address}:${makerToken}:${makerTier}:${cryptoAmountRaw.toString()}:${Date.now()}`;
    const orderRef = keccak256(stringToHex(orderRefSeed));

    const normalizedSide = normalizeOrderSide(makerSide);
    if (normalizedSide === 'UNKNOWN') {
      throw new Error(lang === 'TR' ? 'Geçersiz order side. Order oluşturulamadı.' : 'Invalid order side. Order creation blocked.');
    }

    // [TR] Kontrat: sell → tutar + maker teminatı; buy → yalnız taker teminatı (tier + itibara göre, aşağı yuvarlı).
    //      Tam tutar onaylanır; başarısızlıkta otomatik approve(0) istenmez (kullanıcıya ikinci cüzdan onayı yükü).
    // [EN] Approve the exact contract requirement; no automatic approve(0) rollback on failure.
    let reputation = null;
    if (typeof getReputation === 'function') {
      try { reputation = await getReputation(address); } catch (_) { reputation = null; }
    }
    const requiredAllowance = computeCreateAllowance({
      side: normalizedSide,
      totalAmountRaw: cryptoAmountRaw,
      tier: makerTier,
      bondMap,
      reputation,
    });

    const currentAllowance = await getAllowance(tokenAddress, address);
    if (currentAllowance < requiredAllowance) {
      setLoadingText(
        lang === 'TR'
          ? `Adım 1/2: ${makerToken} izni veriliyor...`
          : `Step 1/2: Approving ${makerToken}...`
      );
      await approveToken(tokenAddress, requiredAllowance);
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

    // [TR] Kur ve fiat zincire yazılmaz; pazar yerinde fiyat görünmesi için backend'e bildirilir.
    //      Başarısız olursa emir yine geçerlidir, yalnız fiyat gösterimi eksik kalır.
    // [EN] Rate/fiat are not on-chain; publish them so the marketplace can show a price.
    let marketMetaSaved = true;
    if (typeof authenticatedFetch === 'function') {
      try {
        const metaRes = await authenticatedFetch(buildApiUrl('orders/market-meta'), {
          method: 'POST',
          body: JSON.stringify({ orderRef, fiatCurrency: makerFiat || 'TRY', exchangeRate: rateNum }),
        });
        marketMetaSaved = Boolean(metaRes?.ok);
      } catch (_) {
        marketMetaSaved = false;
      }
    }

    showToast(
      marketMetaSaved
        ? (lang === 'TR' ? `${createLabel} order oluşturuldu.` : `${createLabel} order created.`)
        : (lang === 'TR' ? `Order oluşturuldu, ancak kur bilgisi kaydedilemedi.` : `Order created, but the rate could not be saved.`),
      marketMetaSaved ? 'success' : 'info'
    );

    setShowMakerModal(false);
    resetForm();
  } catch (err) {
    console.error('handleCreateOrder error:', err);

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
