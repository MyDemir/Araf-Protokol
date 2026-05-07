import React from 'react';
import {
  buildCreateOrderAction,
  getMakerOrderValidationError,
  getRestrictedPaymentRiskEntry,
  MAKER_ORDER_DEFAULTS,
} from '../../actions/orderCreationActions';

const FEE_ON_TRANSFER_WARNING = {
  TR: 'Not: Fee-on-transfer / deflasyonist tokenlar desteklenmez.',
  EN: 'Note: Fee-on-transfer / deflationary tokens are not supported.',
};

export const useMakerOrderForm = ({
  isPaused,
  requireSignedSessionForActiveWallet,
  setShowMakerModal,
  showToast,
  supportedTokens,
  address,
  lang,
  isContractLoading,
  setIsContractLoading,
  setLoadingText,
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
}) => {
  const [makerTier, setMakerTier] = React.useState(MAKER_ORDER_DEFAULTS.makerTier);
  const [makerAmount, setMakerAmount] = React.useState(MAKER_ORDER_DEFAULTS.makerAmount);
  const [makerRate, setMakerRate] = React.useState(MAKER_ORDER_DEFAULTS.makerRate);
  const [makerMinLimit, setMakerMinLimit] = React.useState(MAKER_ORDER_DEFAULTS.makerMinLimit);
  const [makerMaxLimit, setMakerMaxLimit] = React.useState(MAKER_ORDER_DEFAULTS.makerMaxLimit);
  const [makerFiat, setMakerFiat] = React.useState(MAKER_ORDER_DEFAULTS.makerFiat);
  const [makerToken, setMakerToken] = React.useState(MAKER_ORDER_DEFAULTS.makerToken);
  const [makerSide, setMakerSide] = React.useState(MAKER_ORDER_DEFAULTS.makerSide);

  const formState = React.useMemo(() => ({
    makerTier,
    makerAmount,
    makerRate,
    makerMinLimit,
    makerMaxLimit,
    makerFiat,
    makerToken,
    makerSide,
  }), [makerTier, makerAmount, makerRate, makerMinLimit, makerMaxLimit, makerFiat, makerToken, makerSide]);

  const resetMakerOrderForm = React.useCallback(() => {
    setMakerAmount(MAKER_ORDER_DEFAULTS.makerAmount);
    setMakerRate(MAKER_ORDER_DEFAULTS.makerRate);
    setMakerMinLimit(MAKER_ORDER_DEFAULTS.makerMinLimit);
    setMakerMaxLimit(MAKER_ORDER_DEFAULTS.makerMaxLimit);
    setMakerFiat(MAKER_ORDER_DEFAULTS.makerFiat);
    setMakerSide(MAKER_ORDER_DEFAULTS.makerSide);
  }, []);

  const validationError = React.useMemo(
    () => getMakerOrderValidationError({ ...formState, lang }),
    [formState, lang],
  );

  const canonicalPayoutProfile = React.useMemo(
    () => canonicalizePayoutProfileDraft(payoutProfileDraft || {}),
    [canonicalizePayoutProfileDraft, payoutProfileDraft],
  );

  const { selectedRiskEntry: payoutRiskEntry, isRestricted: isCreateTemporarilyDisabledByRisk } = React.useMemo(
    () => getRestrictedPaymentRiskEntry({ paymentRiskConfig, canonicalPayoutProfile }),
    [paymentRiskConfig, canonicalPayoutProfile],
  );

  const getFormState = React.useCallback(() => formState, [formState]);
  const isContractLoadingNow = React.useCallback(() => isContractLoading, [isContractLoading]);

  const handleCreateOrder = React.useMemo(() => buildCreateOrderAction({
    getFormState,
    resetForm: resetMakerOrderForm,
    requireSignedSessionForActiveWallet,
    supportedTokens,
    address,
    lang,
    isContractLoading: isContractLoadingNow,
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
  }), [
    getFormState,
    resetMakerOrderForm,
    requireSignedSessionForActiveWallet,
    supportedTokens,
    address,
    lang,
    isContractLoadingNow,
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
  ]);

  const handleOpenMakerModal = React.useCallback(() => {
    if (isPaused) {
      showToast(lang === 'TR' ? 'Sistem şu an bakım modundadır. Yeni order açılamaz.' : 'System is paused. Cannot create orders.', 'error');
      return;
    }
    if (!requireSignedSessionForActiveWallet()) return;
    setShowMakerModal(true);
    showToast(lang === 'TR' ? FEE_ON_TRANSFER_WARNING.TR : FEE_ON_TRANSFER_WARNING.EN, 'info');
  }, [isPaused, lang, requireSignedSessionForActiveWallet, setShowMakerModal, showToast]);

  return {
    ...formState,
    setMakerTier,
    setMakerAmount,
    setMakerRate,
    setMakerMinLimit,
    setMakerMaxLimit,
    setMakerFiat,
    setMakerToken,
    setMakerSide,
    resetMakerOrderForm,
    validationError,
    payoutRiskEntry,
    isCreateTemporarilyDisabledByRisk,
    handleCreateOrder,
    handleOpenMakerModal,
  };
};

export default useMakerOrderForm;
