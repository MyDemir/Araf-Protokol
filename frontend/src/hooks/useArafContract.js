/**
 * useArafContract — Kontrat Etkileşim Hook'u (H-07 Fix + Güvenlik Güncellemeleri)
 *
 * ABI, deploy scripti tarafından otomatik oluşturulan
 * frontend/src/abi/ArafEscrow.json'dan okunur.
 *
 * Desteklenen işlemler:
 *   - registerWallet / createEscrow / cancelOpenEscrow / lockEscrow
 *   - reportPayment / releaseFunds / challengeTrade / autoRelease / burnExpired
 *   - EIP-712 cancel: signCancelProposal → proposeOrApproveCancel
 *
 * Güvenlik Güncellemeleri:
 *   CON-02 Fix: VITE_ESCROW_ADDRESS tanımsızsa anlamlı hata mesajı
 *   CON-09 Fix: Chain ID doğrulaması — yanlış ağda işlem göndermeyi engeller
 *
 * Kullanım (App.jsx'te):
 *   const { releaseFunds, signCancelProposal, proposeOrApproveCancel } = useArafContract();
 */

import { useCallback } from 'react';
import { usePublicClient, useWalletClient, useChainId } from 'wagmi';
import { parseAbi, getAddress } from 'viem';

// GÜVENLİK İYİLEŞTİRMESİ: ABI'yi doğrudan burada tanımlayarak harici JSON dosyasına
// olan bağımlılığı ortadan kaldırıyoruz. Bu, hook'u daha taşınabilir ve
// "Kod Kanundur" felsefesine daha uygun hale getirir. Frontend, kontratın
// arayüzünü anlamak için hiçbir dış dosyaya güvenmez.
const ArafEscrowABI = parseAbi([
  // --- Write Fonksiyonları (App.jsx'te kullanılanlar) ---
  'function registerWallet()',
  'function createEscrow(address _token, uint256 _cryptoAmount, uint8 _tier)',
  'function cancelOpenEscrow(uint256 _tradeId)',
  'function lockEscrow(uint256 _tradeId)',
  'function reportPayment(uint256 _tradeId, string calldata _ipfsHash)',
  'function releaseFunds(uint256 _tradeId)',
  'function challengeTrade(uint256 _tradeId)',
  'function autoRelease(uint256 _tradeId)',
  'function burnExpired(uint256 _tradeId)',
  'function proposeOrApproveCancel(uint256 _tradeId, uint256 _deadline, bytes calldata _sig)',
  'function pingMaker(uint256 _tradeId)',
  'function pingTakerForChallenge(uint256 _tradeId)', // Gelecekteki kullanım için eklenebilir

  // --- View Fonksiyonları (App.jsx'te kullanılanlar) ---
  'function getReputation(address _wallet) view returns (uint256 successful, uint256 failed, uint256 bannedUntil, uint256 consecutiveBans, uint8 effectiveTier)',
  'function getTrade(uint256 _tradeId) view returns (tuple(uint256 id, address maker, address taker, address tokenAddress, uint256 cryptoAmount, uint256 makerBond, uint256 takerBond, uint8 tier, uint8 state, uint256 lockedAt, uint256 paidAt, uint256 challengedAt, string ipfsReceiptHash, bool cancelProposedByMaker, bool cancelProposedByTaker, uint256 pingedAt, bool pingedByTaker, uint256 challengePingedAt, bool challengePingedByMaker))',

  // --- EIP-712 için Gerekli View Fonksiyonları ---
  'function sigNonces(address) view returns (uint256)',
  'function domainSeparator() view returns (bytes32)',
]);

const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS;

// CON-09 Fix: Desteklenen chain ID'ler — Base Mainnet ve Base Sepolia
const SUPPORTED_CHAINS = {
  8453:  "Base Mainnet",
  84532: "Base Sepolia",
};

export function useArafContract() {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const chainId = useChainId();

  /**
   * CON-09 Fix: Chain ID doğrulama yardımcısı.
   * Kullanıcı yanlış ağdayken (Ethereum Mainnet, Polygon vs.) transaction
   * göndermesini engeller. Belirsiz hata mesajları yerine net yönlendirme verir.
   *
   * @throws {Error} Desteklenmeyen ağ algılandığında
   */
  const _validateChain = useCallback(() => {
    if (!SUPPORTED_CHAINS[chainId]) {
      const supportedNames = Object.values(SUPPORTED_CHAINS).join(" veya ");
      throw new Error(
        `Yanlış ağ! Cüzdanınız şu an Chain ID ${chainId} üzerinde. ` +
        `Araf Protocol sadece ${supportedNames} üzerinde çalışır. ` +
        `Lütfen cüzdanınızdan ağı değiştirin.`
      );
    }
  }, [chainId]);

  /**
   * @dev Temel kontrat çağrısı yardımcısı
   *
   * CON-02 Fix: ESCROW_ADDRESS kontrolü güçlendirildi — tanımsızsa veya
   * sıfır adresse anlamlı hata mesajı fırlatılır.
   *
   * CON-09 Fix: Her işlem öncesi chain ID doğrulanır.
   */
  const writeContract = useCallback(async (functionName, args = []) => {
    const preflightChecks = () => {
      // 1. Cüzdan bağlantı kontrolü
      if (!walletClient) {
        throw new Error("Cüzdan bağlı değil. Lütfen cüzdanınızı bağlayın.");
      }
      // 2. Kontrat adresi yapılandırma kontrolü (CON-02 Fix)
      if (!ESCROW_ADDRESS || ESCROW_ADDRESS === "0x0000000000000000000000000000000000000000") {
        throw new Error(
          "Kontrat adresi yapılandırılmamış. " +
          "VITE_ESCROW_ADDRESS .env dosyasında geçerli bir adres olarak tanımlı olmalı."
        );
      }
      // 3. Ağ doğrulama kontrolü (CON-09 Fix)
      _validateChain();
    };

    try {
      // İşlem göndermeden önce tüm kontrolleri yap
      preflightChecks();

      const hash = await walletClient.writeContract({
        // GÜVENLİK İYİLEŞTİRMESİ: Adresin geçerli ve checksum formatında olduğundan emin ol.
        address: getAddress(ESCROW_ADDRESS),
        abi:     ArafEscrowABI,
        functionName,
        args,
      });

      // İşlem onayını bekle
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return receipt;
    } catch (error) {
      // Hataları daha kullanıcı dostu bir şekilde yakalayıp yeniden fırlatabiliriz
      // veya bir bildirim sistemine gönderebiliriz.
      console.error(`[ArafContract] ${functionName} işlemi başarısız:`, error.message);
      throw error; // Hatanın üst katmanlara da iletilmesi için
    }
  }, [walletClient, publicClient, _validateChain]); // Sabitler dependency array'den kaldırıldı.

  // ── Kontrat Fonksiyonları ─────────────────────────────────────────────────

  const registerWallet = useCallback(() =>
    writeContract("registerWallet"), [writeContract]);

  const createEscrow = useCallback((token, cryptoAmount, tier) =>
    writeContract("createEscrow", [token, cryptoAmount, tier]), [writeContract]);

  // C-02 Fix: OPEN escrow'u iptal etmek için
  const cancelOpenEscrow = useCallback((tradeId) =>
    writeContract("cancelOpenEscrow", [tradeId]), [writeContract]);

  const lockEscrow = useCallback((tradeId) =>
    writeContract("lockEscrow", [tradeId]), [writeContract]);

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

  // EKSİK FONKSİYON: App.jsx'in ihtiyaç duyduğu pingMaker fonksiyonu.
  const pingMaker = useCallback((tradeId) =>
    writeContract("pingMaker", [tradeId]), [writeContract]);

  // YENİ: Simetrik ping mekanizması - Maker'ın itiraz öncesi Taker'ı uyarması için
  const pingTakerForChallenge = useCallback((tradeId) =>
    writeContract("pingTakerForChallenge", [tradeId]), [writeContract]);

  // ── EIP-712 Cancel İmzalama ───────────────────────────────────────────────

  /**
   * EIP-712 cancel proposal imzası oluşturur.
   *
   * SEC-08 Fix: Deadline artık maksimum 7 gün ile sınırlandırıldı.
   * Saldırgan sonsuz deadline ile imza oluşturmasını engeller.
   * Kontrat tarafında da bu kontrolün yapılması önerilir.
   *
   * @param {number} tradeId   - On-chain trade ID
   * @param {number} nonce     - Signer's current sigNonces value
   * @param {number} [deadlineOverride] - Opsiyonel: custom deadline (saniye)
   * @returns {Promise<{signature: string, deadline: number}>}
   */
  const signCancelProposal = useCallback(async (tradeId, nonce, deadlineOverride) => {
    if (!walletClient) throw new Error("Cüzdan bağlı değil");
    _validateChain();

    // SEC-08 Fix: Deadline üst limiti — maksimum 7 gün
    const MAX_DEADLINE_SECONDS = 7 * 24 * 60 * 60; // 7 gün
    const now = Math.floor(Date.now() / 1000);
    const requestedDeadline = deadlineOverride || (now + 3600); // Varsayılan: 1 saat

    // Deadline'ın makul aralıkta olduğundan emin ol
    if (requestedDeadline <= now) {
      throw new Error("Deadline geçmiş bir zamana ayarlanamaz.");
    }
    if (requestedDeadline > now + MAX_DEADLINE_SECONDS) {
      throw new Error(
        `Deadline çok uzak. Maksimum ${MAX_DEADLINE_SECONDS / 86400} gün sonrası kabul edilir.`
      );
    }

    const deadline = requestedDeadline;

    const domain = {
      name: "ArafEscrow",
      version: "1",
      chainId,
      // GÜVENLİK İYİLEŞTİRMESİ: Adresin geçerli ve checksum formatında olduğundan emin ol.
      verifyingContract: getAddress(ESCROW_ADDRESS),
    };

    const types = {
      CancelProposal: [
        { name: "tradeId",  type: "uint256" },
        { name: "proposer", type: "address" },
        { name: "nonce",    type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const message = {
      tradeId:  BigInt(tradeId),
      proposer: walletClient.account.address,
      nonce:    BigInt(nonce),
      deadline: BigInt(deadline),
    };

    const signature = await walletClient.signTypedData({
      domain,
      types,
      primaryType: "CancelProposal",
      message,
    });

    return { signature, deadline };
  }, [walletClient, chainId, _validateChain]);

  /**
   * Kontrat'a cancel proposal gönderir veya onaylar.
   * Her iki taraf da imzaladığında iptal gerçekleşir.
   */
  // KRİTİK HATA DÜZELTMESİ: Argüman sırası kontrat ile eşleşmeli (tradeId, deadline, signature) -> Düzeltildi.
  const proposeOrApproveCancel = useCallback((tradeId, deadline, signature) =>
    writeContract("proposeOrApproveCancel", [tradeId, BigInt(deadline), signature]),
  [writeContract]);

  return {
    // Temel işlemler
    registerWallet,
    createEscrow,
    cancelOpenEscrow,
    lockEscrow,
    reportPayment,
    releaseFunds,
    challengeTrade,
    autoRelease,
    burnExpired,
    pingMaker, // App.jsx için export listesine eklendi
    pingTakerForChallenge, // YENİ: App.jsx için export listesine eklendi
    // EIP-712 Cancel
    signCancelProposal,
    proposeOrApproveCancel,
    /**
     * EKSİK FONKSİYON: App.jsx'in ihtiyaç duyduğu getReputation view fonksiyonu.
     * Bu bir 'write' değil, 'read' işlemi olduğu için publicClient kullanılır.
     */
    getReputation: useCallback(
      (address) => publicClient.readContract({ address: getAddress(ESCROW_ADDRESS), abi: ArafEscrowABI, functionName: 'getReputation', args: [getAddress(address)] }),
      [publicClient]
    ),
  };
}
