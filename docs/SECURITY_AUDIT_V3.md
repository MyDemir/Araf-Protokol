# Araf Protocol — Kapsamlı Güvenlik & Tutarlılık Raporu v3

**Tarih:** 2026-03-14
**Kapsam:** ArafEscrow.sol (v2.0) · App.jsx (1670 satır) · useArafContract.js · Mimari Dokümanlar
**Tespit:** 5 KRİTİK · 7 YÜKSEK · 6 ORTA · 4 DÜŞÜK
**Testnet Hazırlık:** ❌ HAZIR DEĞİL — aşağıdaki kritik düzeltmeler gerekli

---

## YÖNETİCİ ÖZETİ

Araf Protocol'ün v2.0 akıllı kontratı **güvenlik açısından sağlam bir temel** sunmaktadır:
ReentrancyGuard, CEI deseni, EIP-712, Custom Error'lar ve Pausable mekanizması yerli yerinde.
Ancak **frontend (App.jsx) ile kontrat arasında ciddi fonksiyonel boşluklar** mevcuttur.
İlanı açmak, kilitlemek, ödeme bildirmek gibi işlem zincirinin kritik adımları ya hiç bağlı değil
ya da yalnızca UI state'i güncelleyen sahte (mock) fonksiyonlarla simüle edilmektedir.
Ek olarak, kullanıcının "**Sıfır Backend Bağımlılığı**" hedefi ile mevcut uygulama arasında
yapısal bir çelişki bulunmaktadır.

---

## BÖLÜM 1: KRİTİK HATALAR (Testnet'i Engelleyen)

### [KRIT-01] `createEscrow()` — Maker Modal Butonu Kontrata Bağlı Değil

**Dosya:** `frontend/src/App.jsx:922`
**Şiddet:** KRİTİK

```jsx
// MEVCUT (BOZUK):
<button className="w-full bg-emerald-600 ...">
  {lang === 'TR' ? 'Varlığı ve Teminatı Kilitle' : 'Lock Asset & Bond'}
</button>
// onClick TANIMLANMAMIŞ — kontrat çağrısı yok!
```

**Sorun:** "Varlığı ve Teminatı Kilitle" butonu onClick handler içermiyor.
`createEscrow(token, cryptoAmount, tier)` kontrat fonksiyonu **hiçbir zaman çağrılmıyor**.
Ayrıca ERC-20 `approve()` akışı (safeTransferFrom için zorunlu) tamamen eksik.

**Gerekli Akış:**
1. `IERC20(token).approve(ESCROW_ADDRESS, totalLock)` → cüzdan onayı
2. `createEscrow(tokenAddress, cryptoAmount, tier)` → kontrat çağrısı

---

### [KRIT-02] `lockEscrow()` — Taker "Satın Al" Akışı Kontrata Bağlı Değil

**Dosya:** `frontend/src/App.jsx:461-473`
**Şiddet:** KRİTİK

```jsx
// MEVCUT (BOZUK):
const handleStartTrade = (order) => {
  if (isBanned) { ... return; }
  setActiveTrade(order);
  setTradeState('LOCKED');   // Sadece UI state değişiyor
  setCurrentView('tradeRoom');
  // lockEscrow() ÇAĞRILMIYOR!
};
```

**Sorun:** Taker bir ilanı aldığında `lockEscrow(tradeId)` çağrılmıyor.
Ayrıca Taker bond için `approve()` akışı da eksik.

---

### [KRIT-03] `reportPayment()` — "Ödemeyi Yaptım" Butonu Kontrata Bağlı Değil

**Dosya:** `frontend/src/App.jsx:1419`
**Şiddet:** KRİTİK

```jsx
// MEVCUT (BOZUK):
<button onClick={() => { setTradeState('PAID'); setCooldownPassed(false); }}>
  {lang === 'TR' ? 'Ödemeyi Yaptım' : 'I have paid'}
</button>
// reportPayment(tradeId, ipfsHash) ÇAĞRILMIYOR!
```

**Sorun:** Taker "Ödemeyi Yaptım" dediğinde kontrat bilgilendirilmiyor.
On-chain 48 saatlik grace period **başlamıyor**.
`ipfsReceiptHash` kaydedilmiyor — itiraz durumunda Maker'ın delili yok.
`reportPayment` useArafContract.js'de export edilmiş ama **App.jsx'te destructure bile edilmemiyor**.

---

### [KRIT-04] `registerWallet()` — UI'da Hiç Yok

**Dosya:** `frontend/src/App.jsx` (tüm dosya)
**Şiddet:** KRİTİK

**Sorun:** Yeni kullanıcı Taker olabilmek için `registerWallet()` çağırmalıdır.
Anti-Sybil Shield `lockEscrow()` içinde `walletRegisteredAt[msg.sender] == 0` kontrolü yapar
ve `WalletTooYoung` hatasıyla revert eder.
UI'da bu adımı tetikleyen **hiçbir buton veya flow yoktur**.

---

### [KRIT-05] `useArafContract()` İki Kez Çağrılıyor — React Hook İhlali

**Dosya:** `frontend/src/App.jsx:79-90`
**Şiddet:** KRİTİK

```jsx
// MEVCUT (BOZUK):
const {
  releaseFunds, challengeTrade, autoRelease, pingMaker,
  pingTakerForChallenge, lockEscrow, cancelOpenEscrow,
  signCancelProposal, proposeOrApproveCancel,
} = useArafContract();                     // 1. çağrı

const { getReputation } = useArafContract(); // 2. çağrı — İKİNCİ instance!
```

**Sorun:** Aynı hook iki kez çağrılması iki ayrı `usePublicClient` / `useWalletClient`
instance'ı oluşturur. React StrictMode'da bu, cüzdan bağlantı tutarsızlıklarına ve
`getReputation` için yanlış publicClient referansına yol açar.

**Düzeltme:**
```jsx
// DOĞRU:
const {
  releaseFunds, challengeTrade, autoRelease, pingMaker,
  pingTakerForChallenge, lockEscrow, cancelOpenEscrow,
  signCancelProposal, proposeOrApproveCancel, getReputation,
} = useArafContract(); // Tek çağrı
```

---

## BÖLÜM 2: YÜKSEK ÖNEME SAHİP HATALAR

### [H-01] Polling `useEffect` ReferenceError — `fetchMyTrades` Scope Dışı

**Dosya:** `frontend/src/App.jsx:309-318`
**Şiddet:** YÜKSEK

```jsx
// MEVCUT (BOZUK):
useEffect(() => {
  if (currentView !== 'tradeRoom' || !jwtToken) return;
  const interval = setInterval(() => {
    fetchMyTrades(); // ReferenceError! Bu scope'ta tanımlı değil
  }, 15000);
  return () => clearInterval(interval);
}, [currentView, jwtToken, authenticatedFetch]);
```

**Sorun:** `fetchMyTrades` başka bir `useEffect` içinde `async function` olarak tanımlı;
dışarıdan erişilemez. Bu interval, runtime'da `ReferenceError` fırlatır ve ekran
hiçbir zaman güncellenmez.

---

### [H-02] `handleProposeCancel()` — EIP-712 İmzası ve Kontrat Çağrısı Eksik

**Dosya:** `frontend/src/App.jsx:509-512`
**Şiddet:** YÜKSEK

```jsx
// MEVCUT (SADECE UI MOCK):
const handleProposeCancel = () => {
  setCancelStatus('proposed_by_me');
  showToast('İptal teklifi gönderildi...', 'info');
  // signCancelProposal() ÇAĞRILMIYOR
  // proposeOrApproveCancel() ÇAĞRILMIYOR
};
```

**Sorun:** Gerçek mutual cancel akışı çalışmıyor. Her iki taraf da
`proposeOrApproveCancel(tradeId, deadline, sig)` çağırmadan iptal gerçekleşmez.
Mevcut haliyle bu buton tamamen dekoratif.

---

### [H-03] Bleeding Escrow Göstergesi Statik/Hardcoded

**Dosya:** `frontend/src/App.jsx:1529-1535`
**Şiddet:** YÜKSEK

```jsx
// MEVCUT (HARDCODED):
<span>{isTaker ? '10.1' : '6.2'}% / Gün</span>
// İlerleme çubuğu da statik: w-[20%] ve w-[10%]
```

**Sorun:** Kontrat `getCurrentAmounts(tradeId)` view fonksiyonu gerçek decay hesaplar
ama bu fonksiyon ABI'ye eklenmemiş ve hiç çağrılmıyor. Kullanıcı gerçek kayıplarını göremez.

**Eksik ABI girişi** (`useArafContract.js`'e eklenmeli):
```solidity
function getCurrentAmounts(uint256 _tradeId) view returns (
  uint256 cryptoRemaining,
  uint256 makerBondRemaining,
  uint256 takerBondRemaining,
  uint256 totalDecayed
)
```

---

### [H-04] Telegram Handle Hardcoded — PII'dan Okunmuyor

**Dosya:** `frontend/src/App.jsx:119, 1406`
**Şiddet:** YÜKSEK

```jsx
const [telegramHandle, setTelegramHandle] = useState('ahmet_tr'); // Statik test verisi!
```

Trade Room'da karşı tarafın iletişim linki bu sabit değerden oluşturuluyor.
Gerçek Taker/Maker Telegram bilgisi PIIDisplay bileşeninden alınmalı;
bu bileşen zaten `tradeId` ve `authToken` alıyor ama Telegram linki
ayrı statik state'ten okunuyor.

---

### [H-05] PII Güncelleme Endpoint'i Yanlış

**Dosya:** `frontend/src/App.jsx:686`
**Şiddet:** YÜKSEK

```jsx
// MEVCUT (YANLIŞ):
await authenticatedFetch(`${API_URL}/api/pii`, { method: 'PUT' });

// DOĞRU (backend route'ları incelendikten sonra):
await authenticatedFetch(`${API_URL}/api/pii/my`, { method: 'PUT' });
```

`/api/pii/my` route'u `PUT` metodunu destekliyor; `/api/pii` 404 döner.

---

### [H-06] `cooldownPassed` — Gerçek On-Chain Zaman Kontrolü Yok

**Dosya:** `frontend/src/App.jsx:1353-1354, 1508`
**Şiddet:** YÜKSEK

```jsx
// MEVCUT (SADECE SIMULATOR):
<button onClick={() => setCooldownPassed(!cooldownPassed)}>
  ⏱️ Simüle Et: 1 Saat İleri Sar
</button>

// Challenge butonu bu state'e bağlı:
disabled={!cooldownPassed || isContractLoading}
```

**Sorun:** `CHALLENGE_COOLDOWN = 1 hours` kontrolü yalnızca UI simulator butonuna bağlı.
Gerçek uygulamada `activeTrade.paidAt` timestamp'inden 1 saat geçip geçmediği
client-side hesaplanmalı veya kontrat revert'i handle edilmeli.

---

### [H-07] Dev/Test Panel Production'da Görünür

**Dosya:** `frontend/src/App.jsx:1201-1211, 1349-1357`
**Şiddet:** YÜKSEK

```jsx
// Dashboard'da:
<div className="...p-3 bg-slate-800 rounded-xl border border-purple-500/50...">
  <span>🛠️ UX Paneli:</span>  // Herkese görünür!
  // Role toggle, ban toggle...
</div>

// Trade Room'da:
<div className="...bg-slate-800 rounded-xl border border-slate-700...">
  <button>1. LOCKED</button><button>2. PAID</button><button>3. CHALLENGED</button>
  // Trade state simulator herkese görünür!
</div>
```

**Sorun:** Test panelleri production build'inde görünür. Gerçek kullanıcılar
kontrat durumunu bu butonlarla değiştirebileceğini düşünebilir (güvenlik algısı sorunu).

**Düzeltme:**
```jsx
{import.meta.env.DEV && (
  <div>🛠️ UX Paneli: ...</div>
)}
```

---

## BÖLÜM 3: ORTA ÖNEME SAHİP SORUNLAR

### [M-01] ERC-20 `approve()` Akışı Tamamen Eksik

**Şiddet:** ORTA (KRIT-01 ve KRIT-02 ile bağlantılı)

`createEscrow` ve `lockEscrow` kontrat fonksiyonları `safeTransferFrom` kullanır.
Bu fonksiyonun çalışması için kullanıcının önce `IERC20.approve(escrowAddress, amount)`
çağırması gerekir. UI'da bu onay adımını tetikleyen **hiçbir kod yoktur**.

---

### [M-02] SIWE Domain Backend'den Geliyor — Güven Sorunu

**Dosya:** `frontend/src/App.jsx:411`
**Şiddet:** ORTA

```jsx
const { nonce, siweDomain } = await nonceRes.json();
```

SIWE mesajındaki `domain` alanı backend'den alınıyor. Compromise edilmiş bir backend
farklı bir domain döndürerek kullanıcının başka bir site için geçerli SIWE imzası
oluşturmasına neden olabilir. `domain: window.location.host` kullanımı daha güvenlidir.

---

### [M-03] `getTrade()` View Fonksiyonu Hiç Kullanılmıyor

**Şiddet:** ORTA

`getTrade(uint256)` ABI'ye eklenmiş ama App.jsx'te hiçbir yerde çağrılmıyor.
Trade Room tamamen backend verisine güveniyor. Sıfır backend hedefiyle çelişiyor
ve manipüle edilmiş backend verisine karşı savunmasız.

---

### [M-04] `burnExpired()` — UI'da Yok

**Şiddet:** ORTA

Kontrat `burnExpired(tradeId)` fonksiyonunu export ediyor, ABI'de de var.
Ama UI'da bu işlemi tetikleyen hiçbir buton yok. BURNED state'indeki escrow'lar
sonsuza kadar askıda kalır.

---

### [M-05] `decayReputation()` Permissionless — Tasarım Riski

**Dosya:** `contracts/src/ArafEscrow.sol` (`decayReputation` fonksiyonu)
**Şiddet:** ORTA

```solidity
function decayReputation(address _wallet) external { ... }
```

Herhangi bir adres, herhangi bir cüzdanın reputation'ını decay edebilir.
180 gün temiz geçmiş sonrası `consecutiveBans` sıfırlama mekanizması
ancak `decayReputation` çağrıldığında tetikleniyor. Bu permissionless tasarım,
sistematik spam'e açık olabilir (her ne kadar hesap bazında 180 gün koşulu varsa da).

---

### [M-06] WalletConnect Devre Dışı — Mobil Kullanıcı Erişimi Yok

**Dosya:** `frontend/src/main.jsx:20`
**Şiddet:** ORTA

```jsx
// GEÇİCİ OLARAK UYUTULDU (403 Reown hatasını engellemek için)
// walletConnect({ projectId: '3fcc6b444f67d32e656910629a888c34' })
```

WalletConnect devre dışı bırakıldı. Mobil kullanıcılar (büyük P2P pazarın önemli segmenti)
MetaMask veya Coinbase Wallet dışında bağlanamıyor.

---

## BÖLÜM 4: DÜŞÜK ÖNEME SAHİP NOTLAR

### [L-01] Trade Room'da `activeTrade.onchainId` Null Olabilir

`handleStartTrade(order)` ile başlatılan işlemlerde `order.onchainId` backend verisine
dayanıyor (`l.onchain_escrow_id || null`). OPEN state'teki bir ilandaki `onchainId`,
backend event listener trade'i kaydetmeden null olabilir. `handleRelease`, `handlePingMaker`
vb. fonksiyonlar bu durumu `if (!activeTrade?.onchainId)` ile yakalar ama
`handleChallenge` ve `handleAutoRelease` için aynı guard tam değil.

---

### [L-02] Tier İlerleme Gereksinimleri UI'da Yanlış

**Dosya:** `frontend/src/App.jsx:1006-1011`
```jsx
const TIER_REQUIREMENTS = {
  1: { trades: 15, failed: 0 },
  2: { trades: 50, failed: 1 },
  3: { trades: 100, failed: 1 },
  4: { trades: 200, failed: 0 },
};
```

Kontrat dokümantasyonuna göre T1→T2 için "50 başarılı + 100.000 TRY hacim" gerekli.
Hacim koşulu UI'da gösterilmiyor. Kullanıcıya eksik bilgi veriliyor.

---

### [L-03] `sigNonces` Mapping İsim Uyumsuzluğu

**Kontrat:** `mapping(address => uint256) public sigNonces;`
**ABI'daki beklenti:** `sigNonces(address) view returns (uint256)` — doğru
Ancak `useArafContract.js` içinde `sigNonces` view çağrısı hiçbir yerde
aktif olarak kullanılmıyor (sadece `signCancelProposal` parametresi olarak
dışarıdan alınıyor). `getReputation` gibi önce nonce okunmalı.

---

### [L-04] `makerRate`, `makerMinLimit`, `makerMaxLimit` Boş İşleniyor

**Dosya:** `frontend/src/App.jsx:68-70`
Maker modalında toplanan `rate`, `minLimit`, `maxLimit` değerleri
kontrat çağrısında kullanılmıyor (kontrat bunları almıyor, doğru).
Ancak bu değerler backend'e de gönderilmiyor — listing backend'de
kayıt olmadan sadece on-chain ID ile kalacak.
**Sıfır backend hedefiyle bu zaten uyumlu**, ama UI bu alanları
toplamasına rağmen yok sayıyor.

---

## BÖLÜM 5: SıFıR BACKEND HEDEFİ — MİMARİ ÇATIŞMA

### Mevcut Backend Bağımlılıkları (Tümü Kaldırılmalı)

| API Çağrısı | Kullanım Yeri | Öncelik |
|---|---|---|
| `GET /api/auth/nonce` | SIWE login | Kaldırılabilir → on-chain nonce |
| `POST /api/auth/verify` | SIWE doğrulama | Kaldırılabilir → client-side |
| `POST /api/auth/refresh` | JWT yenileme | Kaldırılabilir → JWT yok |
| `GET /api/listings` | Pazar yeri ilanları | ⚠️ Kritik, alternatif gerekli |
| `GET /api/stats` | Protocol istatistikleri | `totalVolume`, `tradeCounter` on-chain |
| `GET /api/trades/my` | Aktif işlemler | `getTrade()` on-chain okuma |
| `GET /api/trades/history` | İşlem geçmişi | Event log okuma (Graph/RPC) |
| `GET /api/pii/my` | PII verisi | İstisna — şifreli off-chain gerekli |
| `POST /api/pii/my` | PII güncelleme | İstisna — şifreli off-chain gerekli |
| `POST /api/trades/{id}/chargeback-ack` | Chargeback onayı | Sadece on-chain yeterli |
| `POST /api/feedback` | Geri bildirim | Kaldırılabilir → Discord/Form |

### Tavsiye Edilen Sıfır-Backend Mimarisi

```
On-Chain (Kontrat):
├── Tüm trade state (OPEN/LOCKED/PAID/CHALLENGED/RESOLVED/BURNED)
├── Reputation ve tier verisi
├── Bond ve fee hesapları
└── totalVolume, tradeCounter (stats)

Pazar Yeri (Decentralized Alternatif):
├── The Graph Protocol → Event log indexing (EscrowCreated events)
└── veya: IPFS/Ceramic → Listing metadata

PII (Kaçınılmaz Off-Chain):
└── Sadece IPFS şifreli depolama (backend ihtiyacı minimale iner)
```

---

## BÖLÜM 6: KONTRAT vs APP.JSX FONKSİYON KAPSAMASI

| Kontrat Fonksiyonu | useArafContract.js | App.jsx'te Çağrılıyor | Durum |
|---|---|---|---|
| `registerWallet()` | ✅ Export | ❌ Hayır | **EKSİK UI** |
| `createEscrow()` | ✅ Export | ❌ Hayır | **BAĞLI DEĞİL** |
| `lockEscrow()` | ✅ Export | ❌ Hayır | **BAĞLI DEĞİL** |
| `reportPayment()` | ✅ Export | ❌ Hayır | **BAĞLI DEĞİL** |
| `releaseFunds()` | ✅ Export | ✅ `handleRelease` | OK |
| `challengeTrade()` | ✅ Export | ✅ `handleChallenge` | OK |
| `autoRelease()` | ✅ Export | ✅ `handleAutoRelease` | OK |
| `burnExpired()` | ✅ Export | ❌ Hayır | **EKSİK UI** |
| `pingMaker()` | ✅ Export | ✅ `handlePingMaker` | OK |
| `pingTakerForChallenge()` | ✅ Export | ✅ `handleChallenge` step 1 | OK |
| `proposeOrApproveCancel()` | ✅ Export | ❌ Sahte (mock only) | **BAĞLI DEĞİL** |
| `signCancelProposal()` | ✅ Export | ❌ Hayır | **EKSİK** |
| `getReputation()` | ✅ Export | ✅ useEffect | OK |
| `getTrade()` | ✅ ABI | ❌ Hayır | **KULLANILMIYOR** |
| `getCurrentAmounts()` | ❌ ABI'de Yok | ❌ Hayır | **ABI EKSİK + KULLANILMIYOR** |
| `sigNonces()` | ✅ ABI | ❌ Otomatik değil | EKSİK |
| `cancelOpenEscrow()` | ✅ Export | ✅ `handleDeleteOrder` | OK |
| `decayReputation()` | ❌ ABI'de Yok | ❌ Hayır | Dışarıdan çağrılabilir |

**Sonuç:** 18 fonksiyondan **4'ü tam çalışıyor**, **4'ü kısmen çalışıyor**, **10'u eksik/bağlı değil**.

---

## BÖLÜM 7: MİMARİ DOKÜMANLA TUTARLILIK ANALİZİ

### ✅ Tutarlı Olanlar
- 5-Tier bond sistemi (BPS oranları dokümana uygun)
- Bleeding Escrow decay oranları (42/26/34 BPS/saat)
- GRACE_PERIOD (48h), CHALLENGE_COOLDOWN (1h), MAX_BLEEDING (10 gün)
- EIP-712 mutual cancel yapısı
- Anti-Sybil Shield (wallet age, dust limit, self-trade ban)
- Ban eskalasyonu (30→60→120→365 gün)
- Temiz sayfa kuralı (180 gün)
- Ücret yapısı (0.1% taker + 0.1% maker)

### ❌ Tutarsız Olanlar

| Mimari Doküman | Kontrat/App.jsx Gerçeği |
|---|---|
| "Oracle-free, humanless" | App.jsx backend API'ye SIWE/listing/stats için bağımlı |
| "Happy Path: OPEN→LOCKED→PAID→RESOLVED" | LOCKED/PAID adımları UI'da kontrata bağlı değil |
| "Tier 0 trade limitleri off-chain" | App.jsx'te tier limit kontrolü yok (backend kaldırılırsa sınır kalkar) |
| "İşlem geçmişi on-chain event'lerden okunur" | App.jsx `/api/trades/history` API'sine bağımlı |
| "PII uçtan uca şifreli" | PIIDisplay bileşeni mevcut ama Telegram ayrı statik state'ten geliyor |

---

## BÖLÜM 8: TESTNET HAZIRLIK KONTROL LİSTESİ

### Zorunlu (Bunlar Olmadan Testnet Mümkün Değil)

- [ ] **[KRIT-01]** `createEscrow()` + ERC-20 `approve()` akışı UI'ya bağlanmalı
- [ ] **[KRIT-02]** `lockEscrow()` + ERC-20 `approve()` akışı UI'ya bağlanmalı
- [ ] **[KRIT-03]** `reportPayment(tradeId, ipfsHash)` "Ödemeyi Yaptım" butonuna bağlanmalı
- [ ] **[KRIT-04]** `registerWallet()` için "Cüzdanı Kaydet" adımı eklenmeli
- [ ] **[KRIT-05]** `useArafContract()` hook double-call düzeltilmeli
- [ ] **[H-01]** Polling useEffect'teki `fetchMyTrades` scope hatası düzeltilmeli
- [ ] **[H-03]** `getCurrentAmounts()` ABI'ye eklenmeli ve Bleeding display buna bağlanmalı
- [ ] **[H-07]** Dev panel `import.meta.env.DEV` guard'ına alınmalı
- [ ] `.env` dosyasında `VITE_ESCROW_ADDRESS` Base Sepolia deploy adresine ayarlanmalı
- [ ] Test USDT/USDC token'ı Base Sepolia'ya deploy edilmeli (veya mevcut test token kullanılmalı)
- [ ] `setSupportedToken(tokenAddress, true)` owner tarafından çağrılmalı

### Önerilir

- [ ] **[H-02]** `handleProposeCancel()` gerçek EIP-712 imzasına bağlanmalı
- [ ] **[H-04]** Telegram handle PIIDisplay verisinden okunmalı
- [ ] **[H-05]** PII PUT endpoint'i `/api/pii/my` olarak düzeltilmeli
- [ ] **[H-06]** `cooldownPassed` gerçek timestamp hesabına bağlanmalı
- [ ] **[M-04]** `burnExpired()` için UI butonu eklenmeli

---

## BÖLÜM 9: AKSİYON ÖNCELİK SIRASI

```
Sprint 1 (Testnet Minimum — 2-3 gün):
  1. useArafContract double-call düzelt (10 dk)
  2. Polling scope bug düzelt (15 dk)
  3. registerWallet UI akışı ekle (1 saat)
  4. createEscrow + approve akışı (3-4 saat)
  5. lockEscrow + approve akışı (2-3 saat)
  6. reportPayment bağla (1 saat)
  7. getCurrentAmounts ABI + Bleeding display (2 saat)
  8. Dev panel DEV guard (15 dk)

Sprint 2 (Testnet Tam Özellik — 3-5 gün):
  9. handleProposeCancel → EIP-712 gerçek akışı
  10. burnExpired UI
  11. getTrade on-chain okuma (backend'i kaldırmak için)
  12. The Graph veya RPC event okuma (listings için)
  13. cooldownPassed → gerçek zaman hesabı

Sprint 3 (Sıfır Backend — 1-2 hafta):
  14. SIWE → JWT'siz, imza doğrulama client-side
  15. Listings → The Graph veya on-chain event okuma
  16. Stats → on-chain totalVolume, tradeCounter
  17. PII → şifreli IPFS (Lit Protocol veya benzeri)
```

---

## SONUÇ

**Akıllı Kontrat (ArafEscrow.sol):** Güvenlik açısından solid. Audit bulgularına karşı
ReentrancyGuard, CEI, EIP-712, Pausable ile iyi korumalı.
Sıfır oracle, sıfır hakem — mimari tutarlı.

**Frontend (App.jsx):** İşlem zincirinin kritik adımları (%60) kontrata bağlı değil.
Testnet'te gerçek kullanıcılar on-chain hiçbir işlem yapamayacak.
UI simülatörleri (dev panel, cooldown butonları) temizlenmeden yayına alınamaz.

**Testnet Hazırlık Notu:** Yukarıdaki Sprint 1 listesi (8 madde) tamamlanmadan
**public testnet'e geçiş mümkün değildir**.
