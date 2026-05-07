import React from 'react';
import {
  getSettlementActionContext,
  validateSettlementProposalInput,
  validateSettlementTradeId,
} from './settlementActionModel';

const getErrorMessage = (err, lang) => (
  err?.shortMessage || err?.reason || err?.message || (lang === 'TR' ? 'Settlement işlemi başarısız.' : 'Settlement transaction failed.')
);

export const useSettlementActions = ({
  activeTrade,
  userRole,
  address,
  lang = 'EN',
  contractFns = {},
  fetchMyTrades,
  showToast,
  isContractLoading,
  setIsContractLoading,
}) => {
  const context = React.useMemo(
    () => getSettlementActionContext({ activeTrade, userRole, address }),
    [activeTrade, userRole, address],
  );

  const refreshTradesAfterTx = React.useCallback(async () => {
    await fetchMyTrades?.();
  }, [fetchMyTrades]);

  const runTx = React.useCallback(async (fn, successMessage) => {
    try {
      setIsContractLoading(true);
      await fn();
      showToast(successMessage, 'success');
      await refreshTradesAfterTx();
      return true;
    } catch (err) {
      showToast(getErrorMessage(err, lang), 'error');
      return false;
    } finally {
      setIsContractLoading(false);
    }
  }, [lang, refreshTradesAfterTx, setIsContractLoading, showToast]);

  const block = React.useCallback((message) => {
    showToast(message, 'error');
    return false;
  }, [showToast]);

  const requireTradeId = React.useCallback(() => {
    const error = validateSettlementTradeId({ tradeId: context.onchainTradeId, lang });
    if (error) return { error };
    return { tradeId: BigInt(context.onchainTradeId) };
  }, [context.onchainTradeId, lang]);

  const propose = React.useCallback(async ({ makerShareBps, expiresAt }) => {
    if (isContractLoading) return false;
    if (!context.canPropose) {
      return block(lang === 'TR' ? 'Settlement teklifi şu anda oluşturulamaz.' : 'Settlement proposal cannot be created now.');
    }
    const validationError = validateSettlementProposalInput({
      tradeId: context.onchainTradeId,
      makerShareBps,
      expiresAt,
      lang,
    });
    if (validationError) return block(validationError);
    return runTx(
      () => contractFns.proposeSettlement(BigInt(context.onchainTradeId), Number(makerShareBps), Number(expiresAt)),
      lang === 'TR' ? 'Settlement teklifi zincire gönderildi.' : 'Settlement proposal submitted on-chain.',
    );
  }, [block, context.canPropose, context.onchainTradeId, contractFns, isContractLoading, lang, runTx]);

  const accept = React.useCallback(async () => {
    if (isContractLoading) return false;
    if (!context.canAccept) return block(lang === 'TR' ? 'Settlement teklifi kabul edilemez.' : 'Settlement proposal cannot be accepted.');
    const { tradeId, error } = requireTradeId();
    if (error) return block(error);
    return runTx(
      () => contractFns.acceptSettlement(tradeId),
      lang === 'TR' ? 'Settlement kabul edildi ve işlem on-chain kapanacak.' : 'Settlement accepted; trade will close on-chain.',
    );
  }, [block, context.canAccept, contractFns, isContractLoading, lang, requireTradeId, runTx]);

  const reject = React.useCallback(async () => {
    if (isContractLoading) return false;
    if (!context.canReject) return block(lang === 'TR' ? 'Settlement teklifi reddedilemez.' : 'Settlement proposal cannot be rejected.');
    const { tradeId, error } = requireTradeId();
    if (error) return block(error);
    return runTx(
      () => contractFns.rejectSettlement(tradeId),
      lang === 'TR' ? 'Settlement teklifi reddedildi.' : 'Settlement proposal rejected.',
    );
  }, [block, context.canReject, contractFns, isContractLoading, lang, requireTradeId, runTx]);

  const withdraw = React.useCallback(async () => {
    if (isContractLoading) return false;
    if (!context.canWithdraw) return block(lang === 'TR' ? 'Settlement teklifi geri çekilemez.' : 'Settlement proposal cannot be withdrawn.');
    const { tradeId, error } = requireTradeId();
    if (error) return block(error);
    return runTx(
      () => contractFns.withdrawSettlement(tradeId),
      lang === 'TR' ? 'Settlement teklifi geri çekildi.' : 'Settlement proposal withdrawn.',
    );
  }, [block, context.canWithdraw, contractFns, isContractLoading, lang, requireTradeId, runTx]);

  const expire = React.useCallback(async () => {
    if (isContractLoading) return false;
    if (!context.canExpire) return block(lang === 'TR' ? 'Settlement teklifi süresi dolmuş olarak işaretlenemez.' : 'Settlement proposal cannot be marked expired.');
    const { tradeId, error } = requireTradeId();
    if (error) return block(error);
    return runTx(
      () => contractFns.expireSettlement(tradeId),
      lang === 'TR' ? 'Settlement teklifi süresi doldu olarak işaretlendi.' : 'Settlement proposal marked expired.',
    );
  }, [block, context.canExpire, contractFns, isContractLoading, lang, requireTradeId, runTx]);

  return React.useMemo(() => ({
    ...context,
    propose,
    accept,
    reject,
    withdraw,
    expire,
  }), [accept, context, expire, propose, reject, withdraw]);
};

export default useSettlementActions;
