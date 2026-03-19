# Araf Protocol — Aksiyon Raporu
**Testnet Öncesi Yapılması Gerekenler**

> Tarih: Mart 2026 | Kapsam: ArafEscrow.sol · Backend · Frontend

---

## İçindekiler

1. [Kritik — Testnet'i Bloklıyor](#1-kritik--testneti-blokliyor)
2. [Yüksek — Testnet'te Fonksiyonel Sorun](#2-yüksek--testnette-fonksiyonel-sorun)
3. [Orta — Sprint Sonrası](#3-orta--sprint-sonrası)
4. [Dikkat — Tasarım Kararları ve Kullanıcı Riski](#4-dikkat--tasarım-kararları-ve-kullanıcı-riski)

---

## 1. Kritik — Testnet'i Bloklıyor

### C-01 · `handleMint` faucet çalışmıyor
**Dosya:** `frontend/src/App.jsx` → `handleMint()` fonksiyonu

**Sorun:** `import.meta.env[VITE_MOCK_${tokenName}_ADDRESS]` arıyor. `.env.example`'da bu key yok; sadece `VITE_USDT_ADDRESS` ve `VITE_USDC_ADDRESS` var. Ek olarak `const address` satırı `useAccount()`'tan gelen `address` değişkeniyle aynı ismi kullanıyor (variable shadowing).

**Yapılacak:**
```jsx
// ESKİ — silinecek:
const address = import.meta.env[`VITE_MOCK_${tokenName}_ADDRESS`];

// YENİ:
const tokenAddr = SUPPORTED_TOKEN_ADDRESSES[tokenName];
if (!tokenAddr) {
    showToast(`${tokenName} token adresi .env dosyasında tanımlı değil.`, 'error');
    return;
}
await mintToken(tokenAddr);
```

---

### C-02 · CHALLENGED state'te "Serbest Bırak" sessiz çalışmıyor
**Dosya:** `frontend/src/App.jsx` → `handleRelease()` fonksiyonu

**Sorun:** Fonksiyon başında `if (!chargebackAccepted) return;` kontrolü var. Chargeback checkbox sadece PAID state UI'ında gösteriliyor. Maker PAID state'i görmeden (örneğin challenge açılmış bir trade'e profil üzerinden girildiğinde) CHALLENGED state'teyken Release butonuna basıldığında `chargebackAccepted = false` olduğu için sessizce hiçbir şey olmuyor. Toast yok, hata yok.

**Yapılacak:** Guard'ı state'e göre koşullu yap:
```jsx
// handleRelease() başına:
if (tradeState === 'PAID' && !chargebackAccepted) {
    showToast(lang === 'TR'
        ? 'Lütfen ters ibraz riskini kabul edin.'
        : 'Please acknowledge the chargeback risk.', 'error');
    return;
}
// CHALLENGED state'te bu kontrolü atla
```

---

### C-03 · PIIDisplay tradeId race condition — 404
**Dosya:** `frontend/src/App.jsx` → `handleStartTrade()` fonksiyonu

**Sorun:** `lockEscrow` transaction confirm olur olmaz hemen `/api/trades/my` çağrılıyor. Event listener `EscrowLocked` eventi henüz işlememiş olabilir (3–5 sn gecikme). `realTradeId = null` kalırsa `activeTrade.id = listing._id` oluyor. `PIIDisplay` bu ID ile `/api/pii/request-token/:tradeId` çağırıyor → 404.

**Yapılacak:** `/api/trades/by-escrow/:onchainId` endpoint'i üzerinden retry loop ekle:
```jsx
// lockEscrow başarısından sonra:
let realTradeId = null;
for (let attempt = 0; attempt < 6; attempt++) {
    try {
        const res = await authenticatedFetch(
            `${API_URL}/api/trades/by-escrow/${order.onchainId}`
        );
        if (res.ok) {
            const data = await res.json();
            realTradeId = data.trade?._id;
            if (realTradeId) break;
        }
    } catch (_) {}
    if (attempt < 5) await new Promise(r => setTimeout(r, 2000));
}
setActiveTrade({ ...order, id: realTradeId || order.id, onchainId: order.onchainId });
```

---

### C-04 · Tier amount limitleri kontrat enforce etmiyor — bypass edilebilir
**Dosya:** `contracts/src/ArafEscrow.sol` → `createEscrow()` fonksiyonu  
**İlgili:** `frontend/src/App.jsx` → `renderMakerModal()` validasyon bloğu

**Sorun:** Frontend Tier 0 için 150 USDT, Tier 1 için 1500 USDT vb. limit koyuyor. Kontrat bu limitleri enforce etmiyor. Frontend bypass edilerek doğrudan kontrat çağrılabilir. "Kod Kanundur" felsefesi gereği bu limitler on-chain olmalı.

**Yapılacak (seçenek A — önerilen):** Kontrata sabitler ve guard ekle:
```solidity
// ArafEscrow.sol — CONSTANTS bölümüne ekle:
uint256 public constant TIER_MAX_AMOUNT_TIER0 =    150 * 10**6; // 150 USDT (6 decimal)
uint256 public constant TIER_MAX_AMOUNT_TIER1 =   1500 * 10**6;
uint256 public constant TIER_MAX_AMOUNT_TIER2 =   7500 * 10**6;
uint256 public constant TIER_MAX_AMOUNT_TIER3 =  30000 * 10**6;
// Tier 4 = limitsiz

// createEscrow() içine ekle (mevcut check'lerin altına):
uint256 tierMax = _getTierMaxAmount(_tier);
if (tierMax > 0 && _cryptoAmount > tierMax) revert AmountExceedsTierLimit();

// Custom error ekle:
error AmountExceedsTierLimit();

// Internal helper:
function _getTierMaxAmount(uint8 _tier) internal pure returns (uint256) {
    if (_tier == 0) return TIER_MAX_AMOUNT_TIER0;
    if (_tier == 1) return TIER_MAX_AMOUNT_TIER1;
    if (_tier == 2) return TIER_MAX_AMOUNT_TIER2;
    if (_tier == 3) return TIER_MAX_AMOUNT_TIER3;
    return 0; // Tier 4 = limitsiz
}
```

**Yapılacak (seçenek B — geçici):** En azından backend `listings.js`'e validasyon ekle ve frontend validasyonuna yorum düş:
```js
// backend/scripts/routes/listings.js — POST handler'ına ekle:
const TIER_LIMITS = { 0: 150, 1: 1500, 2: 7500, 3: 30000 };
const tierLimit = TIER_LIMITS[value.tier];
if (tierLimit && value.limits.max > tierLimit) {
    return res.status(400).json({ error: `Tier ${value.tier} için maksimum limit ${tierLimit} USDT.` });
}
```

**Kontrat değişikliği yapılırsa test dosyasını da güncelle:**  
`contracts/test/ArafEscrow.test.js` → `AmountExceedsTierLimit` için negatif test case ekle.

---

## 2. Yüksek — Testnet'te Fonksiyonel Sorun

### H-01 · `vercel.json` placeholder URL
**Dosya:** `frontend/vercel.json`

**Sorun:** `destination: "https://<SENIN_FLY_IO_BACKEND_URL>.fly.dev/api/$1"` — deploy'a giden placeholder. Tüm API çağrıları çalışmaz.

**Yapılacak:** `<SENIN_FLY_IO_BACKEND_URL>` kısmını `fly.toml`'daki `app = "araf-protocol-backend"` adıyla değiştir:
```json
"destination": "https://araf-protocol-backend.fly.dev/api/$1"
```

---

### H-02 · `autoRelease` penalty dokümantasyon çelişkisi (%5 vs %2)
**Dosyalar:**
- `docs/ARCHITECTURE_TR.md` → Bölüm 7 (Uyuşmazlık Sistemi)
- `docs/ARCHITECTURE_EN.md` → Bölüm 7 (Dispute System)

**Sorun:** Her iki dokümanda "`AUTO_RELEASE_PENALTY_BPS` olarak %5'lik bir ihmal cezası" yazıyor. Kontrat `200 BPS = %2`, test dosyası da `200n` kullanıyor. Dokümantasyon güncel değil.

**Yapılacak:** Her iki dokümanda "%5" yazan tüm satırları "%2" ile güncelle. `ARCHITECTURE_TR.md`'de şu cümleyi bul:
```
Taker'ın teminatından %5'lik bir ihmal cezası
```
Değiştir:
```
her iki tarafın teminatından %2'lik bir ihmal cezası (Maker: %2, Taker: %2)
```
`ARCHITECTURE_EN.md`'de "5% negligence penalty" → "2% negligence penalty (Maker: 2%, Taker: 2%)"

---

### H-03 · Cooldown kalan süre gösterimi bozuk
**Dosya:** `frontend/src/App.jsx` → `sybilStatus` state ve buy butonu render

**Sorun:** `antiSybilCheck` ABI değişikliğiyle `cooldownRemaining` artık kontratdan gelmiyor. State'te `cooldownRemaining: 0` hard-coded. Pazar yeri buy butonunda "Bekleme (0s)" gösteriliyor — kullanıcı neden çalışmadığını anlayamıyor.

**Yapılacak:** Buy butonu label'ını düzelt, süre gösterme:
```jsx
// App.jsx — buy butonu içinde:
!isCooldownOk
    ? <><span>⏳</span> {lang === 'TR' ? 'Cooldown Aktif' : 'Cooldown Active'}</>
    : /* ... */
```

Süre göstermek istiyorsan kontrata `lastTradeAt` mapping'i okuyacak bir view fonksiyonu eklenebilir veya backend'den alınabilir. Şimdilik sadece label'ı düzelt.

---

### H-04 · `handleChallenge` sonrası UI gecikmesi (polling bekleme)
**Dosya:** `frontend/src/App.jsx` → `handleChallenge()` fonksiyonu

**Sorun:** Ping gönderildikten sonra `setActiveTrade(prev => ({ ...prev, challengePingedAt: new Date().toISOString() }))` eklenmişse sorun yok. Ama kontrol koduna bakıldığında CHALLENGED state'e geçişte `fetchMyTrades()` çağrısı yok. Polling 15 saniye beklerse kullanıcı hâlâ eski state görüyor.

**Yapılacak:** Her iki branch'ten sonra (ping ve challenge) `fetchMyTrades()` çağır:
```jsx
// pingTakerForChallenge başarısından sonra:
await pingTakerForChallenge(BigInt(activeTrade.onchainId));
setActiveTrade(prev => ({ ...prev, challengePingedAt: new Date().toISOString() }));
await fetchMyTrades(); // ← ekle
showToast(...);

// challengeTrade başarısından sonra:
await challengeTrade(BigInt(activeTrade.onchainId));
setTradeState('CHALLENGED');
setActiveTrade(prev => ({ ...prev, challengedAt: new Date().toISOString() }));
await fetchMyTrades(); // ← ekle
showToast(...);
```

---

## 3. Orta — Sprint Sonrası

### M-01 · DLQ LIFO davranışı — oldest event'ler işlenmeyebilir
**Dosya:** `backend/scripts/services/dlqProcessor.js`

**Sorun:** `lPush` ile ekleniyor (yeni event HEAD'e), `lRange(0, 9)` ile okunuyor (HEAD = en yeni). Event storm'unda eski başarısız event'ler asla işlenmeyebilir.

**Yapılacak:** `eventListener.js`'de DLQ'ya eklerken `rPush` kullan, `dlqProcessor.js`'de okurken `lRange(-10, -1)` ile en eski 10'u al:
```js
// eventListener.js — _addToDLQ():
await redis.rPush(DLQ_KEY, entry); // lPush yerine rPush

// dlqProcessor.js — processDLQ():
const entries = await redis.lRange(DLQ_KEY, 0, 9); // zaten doğru, rPush ile FIFO olur
```

---

### M-02 · `_onEscrowBurned` retry'da failure_score çift yazılabilir
**Dosya:** `backend/scripts/services/eventListener.js` → `_onEscrowBurned()`

**Sorun:** DLQ retry mekanizması bu handler'ı 3 kez deneyebilir. Her denemede `$inc: { failure_score: score }` çalışır. Başarılı yazım sonrasında network hatası oluşursa score çift hatta üç kat ekleniyor.

**Yapılacak:** `reputation_history` içinde aynı tradeId+type kombinasyonu var mı kontrol et:
```js
async _onEscrowBurned(event) {
    const { tradeId } = event.args;
    const trade = await Trade.findOneAndUpdate(
        { onchain_escrow_id: Number(tradeId) },
        { $set: { status: "BURNED", "timers.resolved_at": new Date() } },
        { new: true }
    );

    if (trade) {
        const scoreType = "burned";
        const score = FAILURE_SCORE_WEIGHTS[scoreType];
        const addresses = [trade.maker_address, trade.taker_address].filter(Boolean);

        for (const addr of addresses) {
            // Idempotency check — aynı tradeId için zaten yazılmış mı?
            const existing = await User.findOne({
                wallet_address: addr,
                "reputation_history": {
                    $elemMatch: { type: scoreType, tradeId: Number(tradeId) }
                }
            });
            if (existing) continue; // çift yazımı önle

            await User.findOneAndUpdate(
                { wallet_address: addr },
                {
                    $inc:  { "reputation_cache.failure_score": score },
                    $push: { reputation_history: { type: scoreType, score, date: new Date(), tradeId: Number(tradeId) } },
                }
            );
        }
    }
}
```

---

### M-03 · `clearMasterKeyCache` shutdown'a eklenmiş değil
**Dosyalar:**
- `backend/scripts/app.js` → `shutdown()` fonksiyonu
- `backend/scripts/services/encryption.js` → `clearMasterKeyCache()`

**Sorun:** Process kapanınca plaintext master key RAM'de tutulmaya devam ediyor (GC'ye bırakılıyor). `clearMasterKeyCache()` fonksiyonu var ama shutdown hook'una eklenmemiş.

**Yapılacak:**
```js
// app.js — shutdown() içine ekle:
const { clearMasterKeyCache } = require('./services/encryption');

const shutdown = async (signal) => {
    logger.info(`${signal} alındı. Graceful shutdown başlıyor...`);
    clearMasterKeyCache(); // ← ekle — plaintext key bellekten temizlenir
    clearInterval(dlqInterval);
    // ... geri kalan mevcut kod
```

---

### M-04 · `_onEscrowReleased` Tier 1+ CHALLENGED→RESOLVED için `firstSuccessfulTradeAt` güncellenmez
**Dosya:** `backend/scripts/services/eventListener.js` → `_onEscrowReleased()`

**Sorun:** `wasDisputed = true` iken maker'a failure_score yazılıyor ama `_updateReputation`'a eşdeğer iş yapılmıyor — `reputation_cache.total_trades` ve `success_rate` backend'de güncellenmez. Bu güncelleme `_onReputationUpdated` event'ine kalıyor. Kontrat her zaman bu event'i emit eder, dolayısıyla nihai sonuç doğru. Ama iki event arasında kısa bir pencerede UI yanlış değer gösterebilir. Kritik değil, bilgi notu.

---

## 4. Dikkat — Tasarım Kararları ve Kullanıcı Riski

Bu maddeler bug değil, kasıtlı tasarım kararları. Testnet'e geçmeden önce kullanıcılara açık communicated edilmesi gerekiyor.

### D-01 · `failedDisputes` hiçbir zaman azalmıyor

**Dosya:** `contracts/src/ArafEscrow.sol` → `_updateReputation()`

`decayReputation` sadece `consecutiveBans = 0` yapıyor. `failedDisputes` asla sıfırlanmıyor. Bir kullanıcı 16 `failedDisputes` biriktirirse, 200 başarılı işlem sonrası bile Tier 4 erişimi yok çünkü `failedDisputes <= 15` koşulu sağlanamıyor. Bu kasıtlı: "Ceza kalıcıdır." Ama testnet onboarding materyallerinde net belirtilmeli.

---

### D-02 · BURNED sonucunda her iki tarafa da `failedDisputes++`

**Dosya:** `contracts/src/ArafEscrow.sol` → `burnExpired()`

Her iki taraf da reputation cezası alıyor. Bir taraf dürüst olsa bile 10 gün boyunca iletişim kesildiğinde her ikisi de `failed` sayıyor. Yeni kullanıcılara "Bu sistemde itirazı uzatmak her zaman her iki tarafa zarar verir" mesajı net verilmeli.

---

### D-03 · Cooldown kalan süre on-chain'den okunamıyor

**Dosya:** `contracts/src/ArafEscrow.sol` → `lastTradeAt` mapping

`lastTradeAt[wallet]` public mapping olarak var ama ne `antiSybilCheck` view fonksiyonu ne de ayrı bir getter bu bilgiyi döndürüyor. Frontend cooldown bitiş zamanını hesaplayamıyor. Kullanıcı "neden alamıyorum" diye soruyor.

**Gerekirse eklenecek view fonksiyonu:**
```solidity
function getCooldownRemaining(address _wallet) external view returns (uint256) {
    uint256 last = lastTradeAt[_wallet];
    if (last == 0) return 0;
    uint256 cooldownEnd = last + TIER0_TRADE_COOLDOWN;
    if (block.timestamp >= cooldownEnd) return 0;
    return cooldownEnd - block.timestamp;
}
```

---

### D-04 · Backend Relayer private key — "Zero Private Key" değil, "Quasi-Zero Key"

**Dosya:** `backend/scripts/jobs/reputationDecay.js`

`RELAYER_PRIVATE_KEY` env var'ı kullanılıyor. `decayReputation` on-chain çağrısı için bu cüzdan gas ödüyor. Architecture dokümanında "Quasi-Zero Key (Testnet)" olarak belgelenmiş, mainnet'te Gelato/Chainlink Automation'a taşınacak. `.env.example`'da `RELAYER_PRIVATE_KEY` eksik — developer bunu manuel eklemek zorunda. `.env.example`'a yorum satırıyla ekle:

```bash
# Reputation decay job için relayer cüzdanı
# Sadece decayReputation() çağırabilir, fon hareketi yapamaz.
# Mainnet'te Gelato Automation ile değiştirilecek.
RELAYER_PRIVATE_KEY=0x_BURAYA_AYRI_BIR_CUZDAN_ANAHTARI_EKLE
```

---

### D-05 · `ipfsReceiptHash` — gerçek IPFS değil, HTTP URL veya SHA-256

**Dosya:** `backend/scripts/routes/trades.js` → receipt upload endpoint (eksik)  
**İlgili:** `frontend/src/App.jsx` → `handleFileUpload()`

`handleFileUpload` `/api/receipts/upload` endpoint'ini çağırıyor. Bu endpoint backend'de mevcut değil. `paymentIpfsHash` boş kalırsa `handleReportPayment` çalışmıyor. Testnet için ya bu endpoint oluşturulmalı ya da kullanıcıdan manuel hash girişine izin verilmeli.

**Geçici çözüm:** `handleFileUpload` yerine manuel input:
```jsx
<input
    type="text"
    placeholder="Dekont URL veya hash giriniz"
    value={paymentIpfsHash}
    onChange={e => setPaymentIpfsHash(e.target.value)}
/>
```

---

## Özet Aksiyon Tablosu

| Kod | Öncelik | Dosya | İş |
|-----|---------|-------|----|
| C-01 | 🔴 Kritik | `App.jsx` | handleMint env var düzelt |
| C-02 | 🔴 Kritik | `App.jsx` | handleRelease CHALLENGED guard |
| C-03 | 🔴 Kritik | `App.jsx` | handleStartTrade retry loop |
| C-04 | 🔴 Kritik | `ArafEscrow.sol` | Tier amount limit on-chain |
| H-01 | 🟠 Yüksek | `vercel.json` | Fly.io URL placeholder |
| H-02 | 🟠 Yüksek | `ARCHITECTURE_TR/EN.md` | %5 → %2 penalty güncelle |
| H-03 | 🟠 Yüksek | `App.jsx` | Cooldown label düzelt |
| H-04 | 🟠 Yüksek | `App.jsx` | handleChallenge sonrası fetchMyTrades |
| M-01 | 🟡 Orta | `dlqProcessor.js` | FIFO sırası |
| M-02 | 🟡 Orta | `eventListener.js` | failure_score idempotency |
| M-03 | 🟡 Orta | `app.js` | clearMasterKeyCache shutdown |
| M-04 | 🟡 Orta | `eventListener.js` | CHALLENGED→RESOLVED gap (bilgi) |
| D-01 | ℹ️ Bilgi | `ArafEscrow.sol` | failedDisputes kalıcı — doc |
| D-02 | ℹ️ Bilgi | `ArafEscrow.sol` | BURNED her iki tarafa rep ceza |
| D-03 | ℹ️ Bilgi | `ArafEscrow.sol` | Cooldown getter eklenebilir |
| D-04 | ℹ️ Bilgi | `reputationDecay.js` | .env.example RELAYER_PRIVATE_KEY |
| D-05 | ℹ️ Bilgi | `App.jsx` | receipts/upload endpoint eksik |
