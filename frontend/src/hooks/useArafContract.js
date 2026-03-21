/**
 * useArafContract — Kontrat Etkileşim Hook'u (H-07 Fix + Güvenlik Güncellemeleri)
 *
 * ABI, deploy scripti tarafından otomatik oluşturulan
 * frontend/src/abi/ArafEscrow.json'dan okunur.
 *
 * Desteklenen işlemler:
 * - registerWallet / createEscrow / cancelOpenEscrow / lockEscrow
 * - reportPayment / releaseFunds / challengeTrade / autoRelease / burnExpired
 * - EIP-712 cancel: signCancelProposal → proposeOrApproveCancel
 *
 * Güvenlik Güncellemeleri:
 * CON-02 Fix: VITE_ESCROW_ADDRESS tanımsızsa anlamlı hata mesajı
 * CON-09 Fix: Chain ID doğrulaması — yanlış ağda işlem göndermeyi engeller
 *
 * AUDIT FIX E-01: getReputation view fonksiyonunda ESCROW_ADDRESS guard eklendi.
 *
 * K-03 Fix: ABI uyumsuzlukları giderildi.
 * - getReputation: 6 değer → 5 değer (firstSuccessfulTradeAt kaldırıldı)
 * - antiSybilCheck: 4 değer → 3 değer (cooldownRemaining kaldırıldı, parametre adları düzeltildi)
 * - getFirstSuccessfulTradeAt: ayrı kontrat fonksiyonu olarak eklendi
 *
 * Kullanım (App.jsx'te):
 * const { releaseFunds, signCancelProposal, proposeOrApproveCancel } = useArafContract();
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
  'function decayReputation(address _wallet)',

  // --- View Fonksiyonları (App.jsx'te kullanılanlar) ---
  // K-03 Fix: 5 return value — önceki ABI'de olmayan firstSuccessfulTradeAt kaldırıldı
  'function getReputation(address _wallet) view returns (uint256 successful, uint256 failed, uint256 bannedUntil, uint256 consecutiveBans, uint8 effectiveTier)',
  // K-03 Fix: 3 return value — önceki ABI'de olmayan cooldownRemaining kaldırıldı, parametre adları kontratla eşleştirildi
  'function antiSybilCheck(address _wallet) view returns (bool aged, bool funded, bool cooldownOk)',
  // K-03 Fix: firstSuccessfulTradeAt artık ayrı kontrat fonksiyonundan okunur
  'function getFirstSuccessfulTradeAt(address _wallet) view returns (uint256)',
  // DÜZELTME BURADA YAPILDI: tuple() yerine (()) kullanıldı
  'function getTrade(uint256 _tradeId) view returns ((uint256 id, address maker, address taker, address tokenAddress, uint256 cryptoAmount, uint256 makerBond, uint256 takerBond, uint8 tier, uint8 state, uint256 lockedAt, uint256 paidAt, uint256 challengedAt, string ipfsReceiptHash, bool cancelProposedByMaker, bool cancelProposedByTaker, uint256 pingedAt, bool pingedByTaker, uint256 challengePingedAt, bool challengePingedByMaker))',

  // --- EIP-712 için Gerekli View Fonksiyonları ---
  'function sigNonces(address) view returns (uint256)',
  'function domainSeparator() view returns (bytes32)',

  // [H-03 Fix]: getCurrentAmounts ABI'ye eklendi — Bleeding Escrow gerçek decay hesabı için.
  'function getCurrentAmounts(uint256 _tradeId) view returns (uint256 cryptoRemaining, uint256 makerBondRemaining, uint256 takerBondRemaining, uint256 totalDecayed)',
  'function paused() view returns (bool)',
]);

// [KRIT-01/02 Fix]: ERC-20 approve ABI — createEscrow ve lockEscrow öncesi safeTransferFrom için zorunlu.
// Escrow kontratına izin vermeden transferFrom çağrısı revert eder.
const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
]);

const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS;

// CON-09 Fix: Desteklenen chain ID'ler — Base Mainnet ve Base Sepolia
const SUPPORTED_CHAINS = {
  8453:  "Base Mainnet",
  84532: "Base Sepolia",
  31337: "Hardhat Local", // Yerel test ağı da listeye eklendi
};

// AUDIT FIX E-01: Kontrat adresi geçerlilik kontrolü — hem write hem read fonksiyonları için
const _isValidAddress = ESCROW_ADDRESS && ESCROW_ADDRESS !== "0x0000000000000000000000000000000000000000";

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
      if (!_isValidAddress) {
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
      // DÜZELTME: Revert hatalarını daha okunabilir hale getir
      const errorMessage = error.shortMessage || error.reason || error.message || "Bilinmeyen Kontrat Hatası";
      
      // [TR] Hatayı sessizce backend log dosyasına gönder (Kullanıcı arayüzünü dondurmaz)
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
      fetch(`${apiUrl}/logs/client-error`, {
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

  const pingMaker = useCallback((tradeId) =>
    writeContract("pingMaker", [tradeId]), [writeContract]);

  const pingTakerForChallenge = useCallback((tradeId) =>
    writeContract("pingTakerForChallenge", [tradeId]), [writeContract]);

  const decayReputation = useCallback((wallet) =>
    writeContract("decayReputation", [wallet]), [writeContract]);

  // ── ERC-20 Token Onayı ───────────────────────────────────────────────────

  /**
   * [KRIT-01/02 Fix]: ERC-20 approve — createEscrow ve lockEscrow öncesi zorunlu.
   *
   * Kontrat safeTransferFrom kullanır; bu işlem için önce token sahibinin
   * ESCROW_ADDRESS'e yeterli allowance vermesi gerekir.
   *
   * @param {string}  tokenAddress   USDT/USDC adresi
   * @param {bigint}  amount         Onaylanacak miktar (token decimals cinsinden)
   * @returns {Promise<Receipt>}
   */
  const approveToken = useCallback(async (tokenAddress, amount) => {
    if (!walletClient) throw new Error("Cüzdan bağlı değil.");
    _validateChain();
    if (!_isValidAddress) throw new Error("VITE_ESCROW_ADDRESS tanımlı değil.");

    try {
      const hash = await walletClient.writeContract({
        address: getAddress(tokenAddress),
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [getAddress(ESCROW_ADDRESS), amount],
      });
      return await publicClient.waitForTransactionReceipt({ hash });
    } catch (error) {
      // DÜZELTME: Token Onayı iptallerini backend'e logla
      const errorMessage = error.shortMessage || error.message || "Bilinmeyen Onay Hatası";
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
      fetch(`${apiUrl}/logs/client-error`, {
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
   * Testnet Faucet Entegrasyonu: Token kontratından test bakiyesi basar.
   */
  const mintToken = useCallback(async (tokenAddress) => {
    if (!walletClient) throw new Error("Cüzdan bağlı değil.");
    _validateChain();
    
    try {
      const hash = await walletClient.writeContract({
        address: getAddress(tokenAddress),
        abi: parseAbi(['function mint()']), // Sabit parametresiz mint işlemi
        functionName: 'mint',
      });
      return await publicClient.waitForTransactionReceipt({ hash });
    } catch (error) {
       // DÜZELTME: Faucet iptallerini backend'e logla
       const errorMessage = error.shortMessage || error.message || "Bilinmeyen Faucet Hatası";
       const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
       fetch(`${apiUrl}/logs/client-error`, {
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
    decayReputation,
    // EIP-712 Cancel
    signCancelProposal,
    proposeOrApproveCancel,
    // [H-03 Fix]: getCurrentAmounts — Bleeding Escrow fazında gerçek decay değerlerini okur.
    getCurrentAmounts: useCallback(
      async (tradeId) => {
        if (!_isValidAddress) return null;
        try {
          return await publicClient.readContract({
            address: getAddress(ESCROW_ADDRESS),
            abi: ArafEscrowABI,
            functionName: 'getCurrentAmounts',
            args: [BigInt(tradeId)],
          });
        } catch (err) {
          console.error('[ArafContract] getCurrentAmounts hatası:', err.message);
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
    // K-03 Fix: antiSybilCheck artık 3 değer döndürüyor (aged, funded, cooldownOk)
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
    /**
     * AUDIT FIX E-01: getReputation view fonksiyonunda ESCROW_ADDRESS guard eklendi.
     * ÖNCEKİ: ESCROW_ADDRESS undefined olduğunda getAddress(undefined) hata fırlatıyordu.
     * writeContract wrapper'ında guard vardı ama getReputation doğrudan export ediliyordu.
     * ŞİMDİ: _isValidAddress kontrolü ile guard eklendi.
     * Adres geçersizse null döner — caller tarafında handle edilmeli.
     *
     * K-03 Fix: 5 return value — önceki ABI'de yanlışlıkla eklenen firstSuccessfulTradeAt kaldırıldı.
     */
    getReputation: useCallback(
      async (address) => {
        // AUDIT FIX E-01: Guard — ESCROW_ADDRESS tanımsızsa null döndür
        if (!_isValidAddress) {
          console.warn("[ArafContract] getReputation: ESCROW_ADDRESS tanımsız, null döndürülüyor.");
          return null;
        }
        try {
          return await publicClient.readContract({
            address: getAddress(ESCROW_ADDRESS),
            abi: ArafEscrowABI,
            functionName: 'getReputation',
            args: [getAddress(address)],
          });
        } catch (err) {
          console.error("[ArafContract] getReputation hatası:", err.message);
          return null;
        }
      },
      [publicClient]
    ),
    /**
     * K-03 Fix: firstSuccessfulTradeAt artık ayrı kontrat fonksiyonundan okunur.
     * Önceki ABI getReputation'a yanlışlıkla 6. parametre olarak eklemişti —
     * bu kontrat ile uyumsuzluk yaratıp tüm reputation fetch'ini null döndürüyordu.
     */
    getFirstSuccessfulTradeAt: useCallback(
      async (address) => {
        if (!_isValidAddress) return 0n;
        try {
          return await publicClient.readContract({
            address: getAddress(ESCROW_ADDRESS),
            abi: ArafEscrowABI,
            functionName: 'getFirstSuccessfulTradeAt',
            args: [getAddress(address)],
          });
        } catch (err) {
          console.error("[ArafContract] getFirstSuccessfulTradeAt hatası:", err.message);
          return 0n;
        }
      },
      [publicClient]
    ),
    // [KRIT-01/02 Fix]: Token onayı — createEscrow ve lockEscrow öncesi zorunlu
    mintToken,
    approveToken,
    getAllowance,
    // [M-03]: getTrade on-chain okuma — backend bağımlılığını azaltır
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
  };
}
