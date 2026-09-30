/**
 * useArafContract — Kontrat Etkileşim Hook'u
 *
 * ABI, runtime'da generated JSON artifact'e bağlı değildir;
 * main branch yaklaşımıyla inline minimal parseAbi tanımı kullanılır.
 *
 * Desteklenen işlemler:
 * - registerWallet
 * - createSellOrder / fillSellOrder / cancelSellOrder
 * - createBuyOrder / fillBuyOrder / cancelBuyOrder
 * - reportPayment / releaseFunds / challengeTrade / autoRelease / burnExpired / expirePaymentWindow
 * - Karşılıklı iptal: her taraf kendi proposeOrApproveCancel(tradeId) işlemini gönderir (imza yok)
 *
 * Kullanım (App.jsx'te):
 * const { releaseFunds, proposeOrApproveCancel } = useArafContract();
 */

import { useCallback } from 'react';
import { usePublicClient, useWalletClient, useChainId, useAccount } from 'wagmi';
import { parseAbi, getAddress, decodeEventLog } from 'viem';
import { resolveClientErrorLogUrl } from '../app/apiConfig';
import { getSupportedChainsMap, isMintTokenEnabled } from '../app/chainPolicy';
import { ARAF_CONTRACT_ERROR_ABI, decorateContractError } from '../app/contractErrors';

const ArafEscrowABI = parseAbi([
  'function registerWallet()',
  'function createSellOrder(address _token, uint256 _totalAmount, uint256 _minFillAmount, uint8 _tier, bytes32 _orderRef, uint8 _paymentRiskLevel) returns (uint256 orderId)',
  'function fillSellOrder(uint256 _orderId, uint256 _fillAmount, bytes32 _childListingRef) returns (uint256 tradeId)',
  'function cancelSellOrder(uint256 _orderId)',
  'function createBuyOrder(address _token, uint256 _totalAmount, uint256 _minFillAmount, uint8 _tier, bytes32 _orderRef, uint8 _paymentRiskLevel) returns (uint256 orderId)',
  'function fillBuyOrder(uint256 _orderId, uint256 _fillAmount, bytes32 _childListingRef) returns (uint256 tradeId)',
  'function cancelBuyOrder(uint256 _orderId)',
  'function reportPayment(uint256 _tradeId, string _ipfsHash)',
  'function releaseFunds(uint256 _tradeId)',
  'function challengeTrade(uint256 _tradeId)',
  'function autoRelease(uint256 _tradeId)',
  'function burnExpired(uint256 _tradeId)',
  'function expirePaymentWindow(uint256 _tradeId)',
  'function proposeOrApproveCancel(uint256 _tradeId)',
  'function proposeSettlement(uint256 _tradeId, uint16 _makerShareBps, uint64 _expiresAt)',
  'function rejectSettlement(uint256 _tradeId)',
  'function withdrawSettlement(uint256 _tradeId)',
  'function expireSettlement(uint256 _tradeId)',
  'function acceptSettlement(uint256 _tradeId)',
  'function pingMaker(uint256 _tradeId)',
  'function pingTakerForChallenge(uint256 _tradeId)',
  'function decayReputation(address _wallet)',
  'function getReputation(address _wallet) view returns (uint256 successful, uint256 failed, uint256 bannedUntil, uint256 consecutiveBans, uint8 effectiveTier, uint256 manualReleaseCount, uint256 autoReleaseCount, uint256 mutualCancelCount, uint256 disputedResolvedCount, uint256 burnCount, uint256 disputeWinCount, uint256 disputeLossCount, uint256 partialSettlementCount, uint256 riskPoints, uint256 lastPositiveEventAt, uint256 lastNegativeEventAt)',
  'function antiSybilCheck(address _wallet) view returns (bool aged, bool funded, bool cooldownOk)',
  'function getCooldownRemaining(address _wallet) view returns (uint256)',
  'function walletRegisteredAt(address) view returns (uint256)',
  'function getFeeConfig() view returns (uint256 currentTakerFeeBps, uint256 currentMakerFeeBps)',
  'function getFirstSuccessfulTradeAt(address _wallet) view returns (uint256)',
  'function getTrade(uint256 _tradeId) view returns ((uint64 id, uint64 parentOrderId, address maker, address taker, address tokenAddress, uint256 cryptoAmount, uint256 makerBond, uint256 takerBond, uint16 takerFeeBpsSnapshot, uint16 makerFeeBpsSnapshot, uint8 tier, uint8 paymentRiskLevelSnapshot, uint8 state, uint64 lockedAt, uint64 paidAt, uint64 challengedAt, bool cancelProposedByMaker, bool cancelProposedByTaker, uint64 pingedAt, bool pingedByTaker, uint64 challengePingedAt, bool challengePingedByMaker))',
  'function getSettlementProposal(uint256 _tradeId) view returns ((uint256 id, uint256 tradeId, address proposer, uint16 makerShareBps, uint16 takerShareBps, uint64 proposedAt, uint64 expiresAt, uint8 state))',
  'function getOrder(uint256 _orderId) view returns ((uint64 id, address owner, uint8 side, address tokenAddress, uint256 totalAmount, uint256 remainingAmount, uint256 minFillAmount, uint256 remainingMakerBondReserve, uint256 remainingTakerBondReserve, uint16 takerFeeBpsSnapshot, uint16 makerFeeBpsSnapshot, uint8 tier, uint8 paymentRiskLevel, uint8 state, bytes32 orderRef))',
  'function getCurrentAmounts(uint256 _tradeId) view returns (uint256 currentCrypto, uint256 currentMakerBond, uint256 currentTakerBond, uint256 totalDecayed)',
  'function paused() view returns (bool)',
  'event OrderCreated(uint256 indexed orderId, address indexed owner, uint8 side, address token, uint256 totalAmount, uint256 minFillAmount, uint8 tier, uint8 paymentRiskLevel, bytes32 orderRef)',
  'event OrderFilled(uint256 indexed orderId, uint256 indexed tradeId, address indexed filler, uint256 fillAmount, uint256 remainingAmount, uint8 paymentRiskLevelSnapshot, bytes32 childListingRef)',
  // [TR] Custom error tanımları: bunlar olmadan viem revert nedenini çözemez ("execution reverted").
  // [EN] Custom error fragments: without them viem cannot decode revert reasons.
  ...ARAF_CONTRACT_ERROR_ABI,
]);

// ERC-20 approve ABI — create/fill order akışlarında safeTransferFrom için zorunlu.
// Escrow kontratına izin vermeden transferFrom çağrısı revert eder.
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  ...ARAF_CONTRACT_ERROR_ABI,
]);

/**
 * [TR] viem waitForTransactionReceipt revert olmuş tx'i de "başarılı" döndürür; status kontrol edilmezse
 *      UI zincirde başarısız olan işlemi tamamlandı sanar.
 * [EN] viem returns a receipt for reverted txs too; without a status check the UI reports false success.
 */
export function assertReceiptSucceeded(receipt, functionName = 'transaction') {
  if (receipt && receipt.status && receipt.status !== 'success') {
    const err = new Error(`${functionName} zincirde başarısız oldu (reverted).`);
    err.shortMessage = err.message;
    err.receipt = receipt;
    throw err;
  }
  return receipt;
}

/**
 * [TR] viem çoklu dönüşü dizi olarak verir; UI isimli alan bekliyor. Tek normalize nokta.
 * [EN] viem returns multi-output reads as arrays; UI expects named fields.
 */
export function normalizeCurrentAmounts(raw) {
  if (!raw) return null;
  const pick = (name, index) => {
    const value = Array.isArray(raw) ? raw[index] : raw?.[name];
    try { return BigInt(value ?? 0); } catch { return 0n; }
  };
  const currentCrypto = pick('currentCrypto', 0);
  const currentMakerBond = pick('currentMakerBond', 1);
  const currentTakerBond = pick('currentTakerBond', 2);
  const totalDecayed = pick('totalDecayed', 3);
  return {
    currentCrypto,
    currentMakerBond,
    currentTakerBond,
    totalDecayed,
    makerBondRemaining: currentMakerBond,
    takerBondRemaining: currentTakerBond,
  };
}

const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS;

// [TR] V3 kontrat authority tuple sırası — frontend bu sırayı açıkça doğrular.
// [EN] V3 contract-authority tuple order — frontend validates this explicitly.
const REPUTATION_V3_KEYS = [
  'successful',
  'failed',
  'bannedUntil',
  'consecutiveBans',
  'effectiveTier',
  'manualReleaseCount',
  'autoReleaseCount',
  'mutualCancelCount',
  'disputedResolvedCount',
  'burnCount',
  'disputeWinCount',
  'disputeLossCount',
  'partialSettlementCount',
  'riskPoints',
  'lastPositiveEventAt',
  'lastNegativeEventAt',
];

const toBigIntSafe = (value, fallback = 0n) => {
  try {
    return BigInt(value ?? fallback);
  } catch {
    return fallback;
  }
};

const PAYMENT_RISK_LEVEL_TO_ENUM = { LOW: 0, MEDIUM: 1, HIGH: 2, RESTRICTED: 3 };

function normalizePaymentRiskLevelInput(rawLevel) {
  if (typeof rawLevel === 'number' && Number.isInteger(rawLevel) && rawLevel >= 0 && rawLevel <= 3) return rawLevel;
  const normalized = String(rawLevel || 'MEDIUM').toUpperCase();
  return PAYMENT_RISK_LEVEL_TO_ENUM[normalized] ?? PAYMENT_RISK_LEVEL_TO_ENUM.MEDIUM;
}

export function normalizeTradeIdOrThrow(tradeId) {
  try {
    if (tradeId === null || tradeId === undefined || String(tradeId).trim() === '') {
      throw new Error('Trade ID boş olamaz.');
    }
    const normalized = BigInt(tradeId);
    if (normalized <= 0n) throw new Error('Trade ID pozitif olmalı.');
    return normalized;
  } catch {
    throw new Error('Geçersiz tradeId. Lütfen işlemi yenileyin.');
  }
}

export function normalizeMakerShareBpsOrThrow(makerShareBps) {
  const value = Number(makerShareBps);
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error('makerShareBps 0-10000 aralığında tam sayı olmalı.');
  }
  return value;
}

export function normalizeUnixSecondsOrThrow(expiresAt) {
  const value = Number(expiresAt);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('expiresAt geçerli bir Unix saniye değeri olmalı.');
  }
  return BigInt(Math.trunc(value));
}

export function normalizeV3Reputation(rawReputation) {
  if (!rawReputation || (typeof rawReputation !== 'object' && !Array.isArray(rawReputation))) {
    return null;
  }

  const normalized = {};
  for (let i = 0; i < REPUTATION_V3_KEYS.length; i += 1) {
    const key = REPUTATION_V3_KEYS[i];
    const namedValue = rawReputation?.[key];
    const tupleValue = Array.isArray(rawReputation) ? rawReputation[i] : undefined;
    const resolved = typeof namedValue !== 'undefined' ? namedValue : tupleValue;

    // [TR] Varsayım yok: alanlardan biri bile eksikse stale/malformed response kabul ederiz.
    // [EN] No assumptions: any missing field means stale/malformed response.
    if (typeof resolved === 'undefined') {
      return null;
    }
    normalized[key] = toBigIntSafe(resolved, 0n);
  }

  return normalized;
}

export function normalizeTokenDecimalsOrThrow(rawDecimals) {
  const normalized = Number(rawDecimals);
  if (!Number.isInteger(normalized) || normalized <= 0 || normalized > 18) {
    throw new Error("Invalid token decimals");
  }
  return normalized;
}

/**
 * [TR] OrderFilled eventini escrow adresi + beklenen orderId ile sıkı filtreler.
 * [EN] Strictly filters OrderFilled by escrow address + expected orderId.
 */
export function extractOrderFilledArgs(receipt, expectedOrderId, escrowAddress = ESCROW_ADDRESS) {
  if (!receipt?.logs?.length || !escrowAddress) return null;

  const normalizedEscrow = getAddress(escrowAddress);
  const expected = BigInt(expectedOrderId);

  for (const log of receipt.logs) {
    try {
      if (!log?.address || getAddress(log.address) !== normalizedEscrow) continue;

      const decoded = decodeEventLog({
        abi: ArafEscrowABI,
        data: log.data,
        topics: log.topics,
        strict: false,
      });

      if (decoded?.eventName !== 'OrderFilled') continue;
      if (BigInt(decoded?.args?.orderId ?? -1) !== expected) continue;
      return decoded.args || null;
    } catch (_) {
      // malformed/unrelated log
    }
  }

  return null;
}


//Kontrat adresi geçerlilik kontrolü — hem write hem read fonksiyonları için
const _isValidAddress = ESCROW_ADDRESS && ESCROW_ADDRESS !== "0x0000000000000000000000000000000000000000";

/**
 * [TR] Ağ kontrolü CÜZDANIN gerçek zincirine bakar. wagmi useChainId() cüzdanın değil yapılandırmanın (config)
 *      aktif zincirini döndürür; cüzdan yanlış ağdayken bile "doğru" görünürdü. useAccount().chainId cüzdanın
 *      zinciridir. Backend deployment zinciri biliniyorsa onunla da eşleşmelidir.
 * [EN] The network guard checks the WALLET's real chain. useChainId() returns the config's chain, so a wallet on
 *      the wrong network still looked fine. Also compares with the backend deployment chain when known.
 * @returns {string|null} hata mesajı; null = uygun
 */
export function resolveChainMismatch({ walletChainId, expectedChainId = null, supportedChains = {} }) {
  const chain = Number(walletChainId);
  const supportedNames = Object.values(supportedChains).join(' veya ');
  if (walletChainId === null || walletChainId === undefined || !Number.isFinite(chain) || !supportedChains[chain]) {
    return `Yanlış ağ! Cüzdanınız şu an Chain ID ${walletChainId ?? 'bilinmiyor'} üzerinde. ` +
      `Araf Protocol sadece ${supportedNames} üzerinde çalışır. ` +
      `Lütfen cüzdanınızdan ağı değiştirin.`;
  }
  const expected = Number(expectedChainId);
  if (Number.isFinite(expected) && expected > 0 && expected !== chain) {
    return `Yanlış ağ! Bu dağıtım Chain ID ${expected} üzerinde çalışıyor, cüzdanınız ${chain} üzerinde. ` +
      `Lütfen cüzdanınızdan ağı değiştirin.`;
  }
  return null;
}

/**
 * [TR] Okuma hataları varsayılan değerle maskelenmez: bilinmeyen durum çağırana hata olarak iletilir.
 * [EN] Read failures are surfaced to the caller instead of being masked by defaults.
 */
const requireEscrowConfigured = () => {
  if (!_isValidAddress) throw new Error('VITE_ESCROW_ADDRESS tanımlı değil.');
};

export function useArafContract({ expectedChainId = null } = {}) {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const configChainId = useChainId();
  const account = useAccount();
  // [TR] Cüzdan bağlı değilse (chainId yok) config zincirine düşülür; yazma zaten walletClient ister.
  const chainId = account?.chainId ?? configChainId;
  const supportedChains = getSupportedChainsMap();

  /*
   * @throws {Error} Desteklenmeyen ağ algılandığında
   */
  const _validateChain = useCallback(() => {
    const message = resolveChainMismatch({ walletChainId: chainId, expectedChainId, supportedChains });
    if (message) throw new Error(message);
  }, [chainId, expectedChainId, supportedChains]);

  /**
   * @dev Temel kontrat çağrısı yardımcisi ve Her işlem öncesi chain ID doğrulanır.
   */
  const writeContract = useCallback(async (functionName, args = []) => {
    const preflightChecks = () => {
      //Cüzdan bağlantı kontrolü
      if (!walletClient) {
        throw new Error("Cüzdan bağlı ancak imzalı oturum bulunmuyor olabilir. Lütfen aktif cüzdanla yeniden giriş yapın.");
      }
      //Kontrat adresi yapılandırma kontrolü (CON-02 Fix)
      if (!_isValidAddress) {
        throw new Error(
          "Kontrat adresi yapılandırılmamış. " +
          "VITE_ESCROW_ADDRESS .env dosyasında geçerli bir adres olarak tanımlı olmalı."
        );
      }
      //Ağ doğrulama kontrolü (CON-09 Fix)
      _validateChain();
    };

    let submittedHash = null;
    try {
      // İşlem göndermeden önce tüm kontrolleri yap
      preflightChecks();

      const hash = await walletClient.writeContract({
        //Adresin geçerli ve checksum formatında olduğundan emin ol.
        address: getAddress(ESCROW_ADDRESS),
        abi:     ArafEscrowABI,
        functionName,
        args,
      });

      submittedHash = hash;
      // [TR] Pending tx hash'ini sakla — sayfa yenilense bile işlem izi kaybolmasın
      // [EN] Persist pending tx hash so refresh does not lose transaction trace
      if (typeof window !== "undefined") {
        localStorage.setItem("araf_pending_tx", JSON.stringify({
          hash,
          functionName,
          createdAt: Date.now(),
          chainId,
          escrow: getAddress(ESCROW_ADDRESS),
        }));
      }

      // İşlem onayını bekle
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (typeof window !== "undefined") {
        localStorage.removeItem("araf_pending_tx");
      }
      return assertReceiptSucceeded(receipt, functionName);
    } catch (error) {
      // [TR] Kesin başarısız olan işlemin izi silinir; aksi halde yenilemede "bekleyen işlem onaylandı" kurtarması
      //      başarısız işlemi de başarı gibi gösterirdi. Yalnız bu çağrının kaydı silinir; sonucu belirsiz
      //      (zaman aşımı) işlemler kurtarma için saklanır.
      // [EN] Definitively failed txs drop their pending record; timeouts keep it (outcome unknown).
      if (submittedHash && typeof window !== "undefined" && !/Timeout|NotFound/i.test(String(error?.name || ''))) {
        try {
          const stored = JSON.parse(localStorage.getItem("araf_pending_tx") || 'null');
          if (stored?.hash === submittedHash) localStorage.removeItem("araf_pending_tx");
        } catch {
          localStorage.removeItem("araf_pending_tx");
        }
      }
      decorateContractError(error);
      //Revert hatalarını daha okunabilir hale getir
      const errorMessage = error.shortMessage || error.reason || error.message || "Bilinmeyen Kontrat Hatası";
      
      //Hatayı sessizce backend log dosyasına gönder (Kullanıcı arayüzünü dondurmaz)
      const logUrl = resolveClientErrorLogUrl();
      fetch(logUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: "ERROR",
          message: `[CONTRACT-REVERT] ${functionName}: ${errorMessage}`,
          url: window.location.href,
          wallet: walletClient?.account?.address
        })
      }).catch(() => {}); // Log atılamazsa sessiz kal, döngüye girme

      console.error(`[ArafContract] ${functionName} işlemi başarısız:`, errorMessage);
      throw error; // Hatanın üst katmanlara da iletilmesi için
    }
  }, [walletClient, publicClient, _validateChain, chainId]); // Sabitler dependency array'den kaldırıldı.

  // ── Kontrat Fonksiyonları ─────────────────────────────────────────────────

  const registerWallet = useCallback(() =>
    writeContract("registerWallet"), [writeContract]);

  const createSellOrder = useCallback(
    (token, totalAmount, minFillAmount, tier, orderRef, paymentRiskLevel = "MEDIUM") =>
      writeContract("createSellOrder", [token, totalAmount, minFillAmount, tier, orderRef, normalizePaymentRiskLevelInput(paymentRiskLevel)]),
    [writeContract]
  );

  const fillSellOrder = useCallback(
    async (orderId, fillAmount, childTradeRef) => {
      const receipt = await writeContract("fillSellOrder", [orderId, fillAmount, childTradeRef]);
      const args = extractOrderFilledArgs(receipt, orderId, ESCROW_ADDRESS);
      return {
        receipt,
        tradeId: args?.tradeId ? BigInt(args.tradeId) : null,
      };
    },
    [writeContract]
  );

  const cancelSellOrder = useCallback(
    (orderId) => writeContract("cancelSellOrder", [orderId]),
    [writeContract]
  );

  const createBuyOrder = useCallback(
    (token, totalAmount, minFillAmount, tier, orderRef, paymentRiskLevel = "MEDIUM") =>
      writeContract("createBuyOrder", [token, totalAmount, minFillAmount, tier, orderRef, normalizePaymentRiskLevelInput(paymentRiskLevel)]),
    [writeContract]
  );

  const fillBuyOrder = useCallback(
    async (orderId, fillAmount, childTradeRef) => {
      const receipt = await writeContract("fillBuyOrder", [orderId, fillAmount, childTradeRef]);
      const args = extractOrderFilledArgs(receipt, orderId, ESCROW_ADDRESS);
      return {
        receipt,
        tradeId: args?.tradeId ? BigInt(args.tradeId) : null,
      };
    },
    [writeContract]
  );

  const cancelBuyOrder = useCallback(
    (orderId) => writeContract("cancelBuyOrder", [orderId]),
    [writeContract]
  );

  const reportPayment = useCallback((tradeId, ipfsHash) =>
    writeContract("reportPayment", [tradeId, ipfsHash]), [writeContract]);

  const releaseFunds = useCallback((tradeId) =>
    writeContract("releaseFunds", [tradeId]), [writeContract]);

  const challengeTrade = useCallback((tradeId) =>
    writeContract("challengeTrade", [tradeId]), [writeContract]);

  const autoRelease = useCallback((tradeId) =>
    writeContract("autoRelease", [tradeId]), [writeContract]);

  const burnExpired = useCallback((tradeId) =>
    writeContract("burnExpired", [tradeId]), [writeContract]);

  const pingMaker = useCallback((tradeId) =>
    writeContract("pingMaker", [tradeId]), [writeContract]);

  const pingTakerForChallenge = useCallback((tradeId) =>
    writeContract("pingTakerForChallenge", [tradeId]), [writeContract]);

  const decayReputation = useCallback((wallet) =>
    writeContract("decayReputation", [wallet]), [writeContract]);

  // ── Partial Settlement (Faz 2 Core) ──
  /**
   * [TR] On-chain split settlement teklifi oluşturur.
   * [EN] Creates an on-chain split settlement proposal.
   */
  const proposeSettlement = useCallback((tradeId, makerShareBps, expiresAt) =>
    writeContract("proposeSettlement", [
      normalizeTradeIdOrThrow(tradeId),
      normalizeMakerShareBpsOrThrow(makerShareBps),
      normalizeUnixSecondsOrThrow(expiresAt),
    ]), [writeContract]);

  /**
   * [TR] Karşı taraf aktif settlement teklifini reddeder.
   * [EN] Counterparty rejects active settlement proposal.
   */
  const rejectSettlement = useCallback((tradeId) =>
    writeContract("rejectSettlement", [normalizeTradeIdOrThrow(tradeId)]), [writeContract]);

  /**
   * [TR] Teklif sahibi aktif settlement teklifini geri çeker.
   * [EN] Proposer withdraws active settlement proposal.
   */
  const withdrawSettlement = useCallback((tradeId) =>
    writeContract("withdrawSettlement", [normalizeTradeIdOrThrow(tradeId)]), [writeContract]);

  /**
   * [TR] Süresi dolmuş settlement teklifini expire eder.
   * [EN] Expires a timed-out settlement proposal.
   */
  const expireSettlement = useCallback((tradeId) =>
    writeContract("expireSettlement", [normalizeTradeIdOrThrow(tradeId)]), [writeContract]);

  /**
   * [TR] Karşı taraf aktif settlement teklifini kabul edip split payout'u finalize eder.
   * [EN] Counterparty accepts active settlement proposal and finalizes split payout.
   */
  const acceptSettlement = useCallback((tradeId) =>
    writeContract("acceptSettlement", [normalizeTradeIdOrThrow(tradeId)]), [writeContract]);

  // ── ERC-20 Token Onayı ──
  /**
   *ERC-20 approve — create/fill order akışlarında zorunlu.
   *
   * Kontrat safeTransferFrom kullanır; bu işlem için önce token sahibinin
   * ESCROW_ADDRESS'e yeterli allowance vermesi gerekir.
   *
   * @param {string}  tokenAddress   USDT/USDC adresi
   * @param {bigint}  amount         Onaylanacak miktar (token decimals cinsinden)
   * @returns {Promise<Receipt>}
   */
  const approveToken = useCallback(async (tokenAddress, amount) => {
    if (!walletClient) throw new Error("İşlem için aktif wallet client bulunamadı. Cüzdan bağlantınızı ve oturum imzanızı kontrol edin.");
    _validateChain();
    if (!_isValidAddress) throw new Error("VITE_ESCROW_ADDRESS tanımlı değil.");

    try {
      const hash = await walletClient.writeContract({
        address: getAddress(tokenAddress),
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [getAddress(ESCROW_ADDRESS), amount],
      });
      return assertReceiptSucceeded(await publicClient.waitForTransactionReceipt({ hash }), 'approve');
    } catch (error) {
      decorateContractError(error);
      // Token Onayı iptallerini backend'e logla
      const errorMessage = error.shortMessage || error.message || "Bilinmeyen Onay Hatası";
      const logUrl = resolveClientErrorLogUrl();
      fetch(logUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: "ERROR",
          message: `[TOKEN-APPROVE-REVERT] ${errorMessage}`,
          url: window.location.href,
          wallet: walletClient.account.address
        })
      }).catch(() => {});
      throw error;
    }
  }, [walletClient, publicClient, _validateChain]);

  /**
   * Token kontratından test bakiyesi basar.
   */
  const mintToken = useCallback(async (tokenAddress) => {
    if (!walletClient) throw new Error("İşlem için aktif wallet client bulunamadı. Cüzdan bağlantınızı ve oturum imzanızı kontrol edin.");
    if (!isMintTokenEnabled()) {
      throw new Error("Production ortamında test faucet (mint) devre dışıdır. Lütfen Base Mainnet üzerinde gerçek token kullanın.");
    }
    _validateChain();
    
    try {
      const hash = await walletClient.writeContract({
        address: getAddress(tokenAddress),
        abi: parseAbi(['function mint()']), // Sabit parametresiz mint işlemi
        functionName: 'mint',
      });
      return assertReceiptSucceeded(await publicClient.waitForTransactionReceipt({ hash }), 'mint');
    } catch (error) {
       // Faucet iptallerini backend'e logla
       const errorMessage = error.shortMessage || error.message || "Bilinmeyen Faucet Hatası";
       const logUrl = resolveClientErrorLogUrl();
       fetch(logUrl, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           level: "ERROR",
           message: `[FAUCET-REVERT] ${errorMessage}`,
           url: window.location.href,
           wallet: walletClient.account.address
         })
       }).catch(() => {});
       throw error;
    }
  }, [walletClient, publicClient, _validateChain]);
 /**
   * Mevcut allowance'ı okur — approve gerekip gerekmediğini anlamak için.
   * @param {string} tokenAddress
   * @param {string} ownerAddress
   * @returns {Promise<bigint>}
   */
  const getAllowance = useCallback(async (tokenAddress, ownerAddress) => {
    if (!_isValidAddress) return BigInt(0);
    try {
      return await publicClient.readContract({
        address: getAddress(tokenAddress),
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [getAddress(ownerAddress), getAddress(ESCROW_ADDRESS)],
      });
    } catch {
      return BigInt(0);
    }
  }, [publicClient]);

  /**
   * Token decimals değerini on-chain okur.
   * Decimals okunamazsa veya güvenli aralık dışındaysa işlem bloklanır.
   *
   * @param {string} tokenAddress
   * @returns {Promise<number>}
   */
  const getTokenDecimals = useCallback(async (tokenAddress) => {
    if (!_isValidAddress) {
      throw new Error("Escrow contract address is not configured.");
    }

    try {
      const decimals = await publicClient.readContract({
        address: getAddress(tokenAddress),
        abi: ERC20_ABI,
        functionName: 'decimals',
      });

      return normalizeTokenDecimalsOrThrow(decimals);
    } catch (error) {
      throw new Error(error?.message || "Token decimals could not be read safely.");
    }
  }, [publicClient]);

  // ── EIP-712 Cancel İmzalama ───────────────────────────────────────────────

  /**
   * Karşılıklı iptal onayı. Her taraf kendi işlemini gönderir; ikinci onay iptali yürütür.
   * msg.sender kimliği kanıtladığı için ayrı bir EIP-712 imzası gerekmez.
   * [EN] Mutual-cancel consent. Each party sends its own tx; the second consent executes the cancel.
   */
  const proposeOrApproveCancel = useCallback((tradeId) =>
    writeContract("proposeOrApproveCancel", [BigInt(tradeId)]),
  [writeContract]);

  /**
   * LOCKED trade'de ödeme penceresi (48 saat) dolduysa kilidi çözer.
   * [EN] Unwinds a LOCKED trade once the 48h payment window has passed.
   */
  const expirePaymentWindow = useCallback((tradeId) =>
    writeContract("expirePaymentWindow", [BigInt(tradeId)]),
  [writeContract]);

  return {
    // Temel işlemler
    registerWallet,
    createSellOrder,
    fillSellOrder,
    cancelSellOrder,
    createBuyOrder,
    fillBuyOrder,
    cancelBuyOrder,
    reportPayment,
    releaseFunds,
    challengeTrade,
    autoRelease,
    burnExpired,
    expirePaymentWindow,
    pingMaker, // App.jsx için export listesine eklendi
    pingTakerForChallenge, //App.jsx için export listesine eklendi
    decayReputation,
    proposeOrApproveCancel,
    proposeSettlement,
    rejectSettlement,
    withdrawSettlement,
    expireSettlement,
    acceptSettlement,
  
    getCurrentAmounts: useCallback(
      async (tradeId) => {
        if (!_isValidAddress) return null;
        try {
          return normalizeCurrentAmounts(await publicClient.readContract({
            address: getAddress(ESCROW_ADDRESS),
            abi: ArafEscrowABI,
            functionName: 'getCurrentAmounts',
            args: [BigInt(tradeId)],
          }));
        } catch (err) {
          console.error('[ArafContract] getCurrentAmounts hatası:', err.message);
          return null;
        }
      },
      [publicClient]
    ),
    getSettlementProposal: useCallback(
      async (tradeId) => {
        if (!_isValidAddress) return null;
        try {
          return await publicClient.readContract({
            address: getAddress(ESCROW_ADDRESS),
            abi: ArafEscrowABI,
            functionName: 'getSettlementProposal',
            args: [BigInt(tradeId)],
          });
        } catch (err) {
          console.error('[ArafContract] getSettlementProposal hatası:', err.message);
          return null;
        }
      },
      [publicClient]
    ),
    getPaused: useCallback(
      async () => {
        if (!_isValidAddress) return null;
        try {
          return await publicClient.readContract({
            address: getAddress(ESCROW_ADDRESS),
            abi: ArafEscrowABI,
            functionName: 'paused',
          });
        } catch (err) {
          console.error("[ArafContract] paused okuma hatası:", err.message);
          return null;
        }
      },
      [publicClient]
    ),
    //antiSybilCheck artık 3 değer döndürüyor (aged, funded, cooldownOk)
    antiSybilCheck: useCallback(
      async (address) => {
        if (!_isValidAddress) return null;
        try {
          return await publicClient.readContract({
            address: getAddress(ESCROW_ADDRESS),
            abi: ArafEscrowABI,
            functionName: 'antiSybilCheck',
            args: [getAddress(address)],
          });
        } catch (err) {
          console.error("[ArafContract] antiSybilCheck hatası:", err.message);
          return null;
        }
      },
      [publicClient]
    ),
    getCooldownRemaining: useCallback(
      async (address) => {
        requireEscrowConfigured();
        return publicClient.readContract({
          address: getAddress(ESCROW_ADDRESS),
          abi: ArafEscrowABI,
          functionName: 'getCooldownRemaining',
          args: [getAddress(address)],
        });
      },
      [publicClient]
    ),
    getWalletRegisteredAt: useCallback(
      async (address) => {
        // [TR] Hata 0n'e çevrilmez: 0n "kayıtsız" demektir; okunamayan durum çağırana fırlatılır.
        requireEscrowConfigured();
        return publicClient.readContract({
          address: getAddress(ESCROW_ADDRESS),
          abi: ArafEscrowABI,
          functionName: 'walletRegisteredAt',
          args: [getAddress(address)],
        });
      },
      [publicClient]
    ),
    getTakerFeeBps: useCallback(
      async () => {
        requireEscrowConfigured();
        const feeConfig = await publicClient.readContract({
          address: getAddress(ESCROW_ADDRESS),
          abi: ArafEscrowABI,
          functionName: 'getFeeConfig',
        });
        const takerFee = typeof feeConfig?.currentTakerFeeBps !== 'undefined'
          ? feeConfig.currentTakerFeeBps
          : feeConfig?.[0];
        if (takerFee === undefined || takerFee === null) throw new Error('getFeeConfig yanıtı geçersiz.');
        return BigInt(takerFee);
      },
      [publicClient]
    ),
    /**
     * Adres geçersizse null döner — caller tarafında handle edilmeli.
     */
    getReputation: useCallback(
      async (address) => {
        // Guard — ESCROW_ADDRESS tanımsızsa null döndür
        if (!_isValidAddress) {
          console.warn("[ArafContract] getReputation: ESCROW_ADDRESS tanımsız, null döndürülüyor.");
          return null;
        }
        try {
          const rawReputation = await publicClient.readContract({
            address: getAddress(ESCROW_ADDRESS),
            abi: ArafEscrowABI,
            functionName: 'getReputation',
            args: [getAddress(address)],
          });
          const normalized = normalizeV3Reputation(rawReputation);
          if (!normalized) {
            console.error('[ArafContract] getReputation V3 response malformed or stale shape detected.');
            return null;
          }
          return normalized;
        } catch (err) {
          console.error("[ArafContract] getReputation hatası:", err.message);
          return null;
        }
      },
      [publicClient]
    ),
    
    getFirstSuccessfulTradeAt: useCallback(
      async (address) => {
        requireEscrowConfigured();
        return publicClient.readContract({
          address: getAddress(ESCROW_ADDRESS),
          abi: ArafEscrowABI,
          functionName: 'getFirstSuccessfulTradeAt',
          args: [getAddress(address)],
        });
      },
      [publicClient]
    ),
    //Token onayı — create/fill order akışlarında zorunlu
    mintToken,
    approveToken,
    getAllowance,
    getTokenDecimals,
    //getTrade on-chain okuma — backend bağımlılığını azaltır
    getTrade: useCallback(
      async (tradeId) => {
        if (!_isValidAddress) return null;
        try {
          return await publicClient.readContract({
            address: getAddress(ESCROW_ADDRESS),
            abi: ArafEscrowABI,
            functionName: 'getTrade',
            args: [BigInt(tradeId)],
          });
        } catch (err) {
          console.error('[ArafContract] getTrade hatası:', err.message);
          return null;
        }
      },
      [publicClient]
    ),
    getOrder: useCallback(
      async (orderId) => {
        if (!_isValidAddress) return null;
        try {
          return await publicClient.readContract({
            address: getAddress(ESCROW_ADDRESS),
            abi: ArafEscrowABI,
            functionName: 'getOrder',
            args: [BigInt(orderId)],
          });
        } catch (err) {
          console.error('[ArafContract] getOrder hatası:', err.message);
          return null;
        }
      },
      [publicClient]
    ),
  };
}
