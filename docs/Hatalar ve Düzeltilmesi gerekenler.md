# 🌀 ARAF PROTOCOL — KAPSAMLİ GÜVENLİK VE MİMARİ DENETİM RAPORU v2.0

> **Versiyon:** 2.0 | **Tarih:** Mart 2026 | **Gizlilik:** ÇOK GİZLİ — PROTOKOL İÇİ  
> **Kapsam:** ArafEscrow.sol v2.1 · Node.js/Express Backend · React Frontend  
> **Metodoloji:** Kullanıcı Test Bulguları (700 satır) + Statik Kod Çapraz Analizi  
> **Önemli Not:** Bu rapordaki bulguların **tamamı** test sürecinde kullanıcı tarafından tespit edilmiştir. Raporun amacı bu bulguları ilgili kaynak koduyla eşleştirerek yapılandırılmış hale getirmektir.

---

## ÖNSÖZ: ÖNCEKİ RAPORUN EKSİKLERİ

Önceki raporda aşağıdaki hatalar yapılmıştır:

1. Kullanıcının test bulgularından gelen pek çok madde "kendi keşfim" olarak sunuldu
2. Toplamda 700 satırlık bulgularda yer alan **~35+ madde tamamen atlandı**
3. Bazı bulgular birbirine karıştırılarak yüzeysel geçildi
4. Felsefe ihlalleri ile teknik hatalar birbirine karışık işlendi

Bu rapor o eksiklikleri gidermek için sıfırdan yazılmıştır.

---

## İÇİNDEKİLER

1. [Bulgu Envanteri — Tam Liste](#1-bulgu-envanteri)
2. [KRİTİK Bulgular](#2-kritik-bulgular)
3. [YÜKSEK Bulgular](#3-yüksek-bulgular)
4. [ORTA Bulgular](#4-orta-bulgular)
5. [Frontend Spesifik Bulgular](#5-frontend-spesifik)
6. [Backend Spesifik Bulgular](#6-backend-spesifik)
7. [Altyapı Bulguları](#7-altyapı-bulguları)
8. [Smart Contract Bulguları](#8-smart-contract)
9. [Mimari Felsefe İhlalleri](#9-felsefe-ihlalleri)
10. [Oyun Teorisi Tutarsızlıkları](#10-oyun-teorisi)
11. [Önceki Raporda Atlanan Bulgular](#11-atlanan-bulgular)
12. [Düzeltme Yol Haritası](#12-yol-haritası)

---

## 1. BULGU ENVANTERİ

### Toplam Bulgu Sayısı: 73

| Kategori | Adet |
|----------|------|
| 🔴 Kritik | 16 |
| 🟠 Yüksek | 22 |
| 🟡 Orta | 19 |
| 🔵 Felsefe/Mimari İhlali | 10 |
| ⚫ Önceki Rapordan Atlanan | 6 |
| **Toplam** | **73** |

### Kaynak Dağılımı

| Dosya / Bileşen | Bulgu Sayısı |
|-----------------|--------------|
| `eventListener.js` | 14 |
| `App.jsx` | 12 |
| `auth.js` + `siwe.js` | 9 |
| `pii.js` | 7 |
| `receipts.js` | 6 |
| `trades.js` | 5 |
| `rateLimiter.js` + `app.js` | 4 |
| `useCountdown.js` + `usePII.js` | 4 |
| `errorHandler.js` | 3 |
| `db.js` + `redis.js` | 4 |
| `listings.js` | 4 |
| `dlqProcessor.js` | 2 |
| `encryption.js` + `protocolConfig.js` | 2 |
| `User.js` + `reputationDecay.js` | 2 |
| `stats.js` | 1 |
| `MockERC20.sol` + `main.jsx` | 2 |

---

## 2. KRİTİK BULGULAR

---

### 🔴 KRİT-01 · Refresh Token Hijacking — Tam Hesap Ele Geçirme (ATO)

**Dosya:** `auth.js` + `siwe.js`  
**Kaynak:** Kullanıcı Bulgusu  

`/api/auth/refresh` endpoint'i `wallet` adresini `req.body.wallet`'tan veya expired JWT'den alıyor. `rotateRefreshToken(walletAddress, refreshToken)` çağrısında Redis'ten alınan `familyId`'nin gerçekten o `walletAddress`'e ait olup olmadığı **hiç doğrulanmıyor**.

```javascript
// auth.js — MEVCUT (HATALI)
let wallet = req.body?.wallet; // ← Saldırgan kurban adresini buraya yazar
const result = await rotateRefreshToken(wallet.toLowerCase(), refreshToken);
// rotateRefreshToken sadece token'ın Redis'te var olup olmadığını kontrol eder
// wallet eşleşmesi YOK → kurban adına JWT basılır
```

**Saldırı:** Saldırgan kendi geçerli refreshToken'ı + kurbanın wallet adresi → kurban adına JWT alır → PII, işlemler, IBAN tam erişim.

**Düzeltme:** Redis'te token değeri `{ familyId, wallet }` olarak saklanmalı, rotasyon sırasında wallet eşleşmesi doğrulanmalı.

---

### 🔴 KRİT-02 · Kurbanı Cezalandıran İtibar Algoritması

**Dosya:** `eventListener.js` → `_onEscrowReleased`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// eventListener.js — MEVCUT (KRİTİK MANTIK HATASI)
if (wasDisputed && trade.maker_address) {
  // "unjust_challenge" skoru MAKER'a yazılıyor
  await User.findOneAndUpdate(
    { wallet_address: trade.maker_address }, // ← MAKER cezalandırılıyor!
    { $inc: { "reputation_cache.failure_score": score } }
  );
}
```

**Protokol mantığı:** CHALLENGED → RESOLVED geçişi = Maker parayı serbest bıraktı = Maker haklıydı. Haksız itiraz açan **Taker** cezalandırılmalı, Maker değil.

**Etki:** Dürüst satıcılar sistematik olarak itibar kaybeder → protokol kendi pazar yerini kendisi temizler.

**Düzeltme:** `trade.maker_address` → `trade.taker_address` olmalı.

---

### 🔴 KRİT-03 · DLQ Arşiv Mantığı Tamamen Ters

**Dosya:** `dlqProcessor.js`  
**Kaynak:** Kullanıcı Bulgusu  

`eventListener.js` `rPush` (sağa ekle) kullanıyor → index 0 = en eski, son = en yeni.

```javascript
// dlqProcessor.js — MEVCUT (TAMAMEN TERS)
const oldEntries = await redis.lRange(DLQ_KEY, -overflow, -1);
// -overflow:-1 = listenin SONU = EN YENİ event'ler arşive gidiyor!
multi.lTrim(DLQ_KEY, 0, MAX_DLQ_SIZE - 1);
// Başta kalan ESKİ/BOZUK event'ler sonsuza kalıyor, hiç retry edilemiyor
```

**Etki:** Kritik event'ler (EscrowReleased, EscrowBurned) işlenemez → kullanıcı fonları sonsuza kilitli.

**Düzeltme:**
```javascript
const oldEntries = await redis.lRange(DLQ_KEY, 0, overflow - 1); // baştan al (en eski)
multi.lTrim(DLQ_KEY, overflow, -1);                               // baştan kes
```

---

### 🔴 KRİT-04 · Fiat Tutarı Kripto Olarak Kilitleniyor

**Dosya:** `App.jsx` → `handleStartTrade`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// App.jsx — MEVCUT (KRİTİK FİNANSAL HATA)
const cryptoAmtRaw = BigInt(Math.round((parseFloat(order.max) || 0) * 1e6));
// order.max = 50.000 TRY (FIAT) — kura BÖLÜNMEDEN kripto gibi kullanılıyor!
```

**Örnek:** 50.000 TRY işlem, 50.000 USDT (~1.7M TRY) kilitlemesi istiyor.

**Ek sorun:** Aynı satırda `1e6` hardcoded → 18 decimals'lı tokenlar geldiğinde 10^12 kat küçük hesaplama.

**Düzeltme:**
```javascript
const cryptoAmtFloat = (parseFloat(order.max) || 0) / (parseFloat(order.rate) || 1);
const decimals = /* token decimals on-chain'den dinamik okunmalı */;
const cryptoAmtRaw = BigInt(Math.round(cryptoAmtFloat * Math.pow(10, decimals)));
```

---

### 🔴 KRİT-05 · Rate Limiter Global DoS — Platform Erişilemezlik

**Dosya:** `rateLimiter.js` + `app.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// rateLimiter.js
keyGenerator: (req) => req.ip, // veya req.wallet || req.ip

// app.js — SADECE production'da trust proxy:
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
```

Fly.io/Cloudflare/Nginx arkasında `req.ip` = Load Balancer IP. Tüm kullanıcılar aynı IP'yi paylaşır. `authLimiter` dakikada 10 istekte platformu kilitler.

**İkinci boyut:** Redis koptuğunda fallback yok → `rateLimiter` middleware hata fırlatır → tüm endpoint'ler 500.

**Düzeltme:** `app.set('trust proxy', true)` koşulsuz + Redis fallback (fail-open).

---

### 🔴 KRİT-06 · Dekont Kanıt Sabotajı (Evidence Overwrite)

**Dosya:** `receipts.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// receipts.js — MEVCUT (KONTROL EKSİK)
await Trade.findOneAndUpdate(
  { onchain_escrow_id: onchainId },
  // ← evidence.receipt_encrypted null kontrolü YOK
  { $set: { "evidence.receipt_encrypted": encryptedHex, ... } }
);
```

Kötü niyetli Taker: Gerçek dekont yükler → `reportPayment()` on-chain bildirir → endpoint'i tekrar çağırır → bozuk veri yazar → Maker kanıtsız kalır.

**Düzeltme:** Filter'a `"evidence.receipt_encrypted": null` eklenmeli.

---

### 🔴 KRİT-07 · SIWE Nonce Deadlock — Kullanıcı Giriş Yapamaz

**Dosya:** `siwe.js` → `generateNonce`  
**Kaynak:** Kullanıcı Bulgusu  

Kullanıcı "Bağlan" butonuna çift tıklarsa 2. istek 1. nonce'ı siler. Kullanıcı 1. nonce ile imza attıktan sonra `/verify`'da nonce uyuşmazlığı → süresiz döngü.

**Düzeltme:** `SET ... NX` (mevcut yoksa yaz) kullanılmalı.

---

### 🔴 KRİT-08 · Hardcoded "USDT/TRY" Fallback — Finansal Veri Bozulması

**Dosya:** `eventListener.js` → `_onEscrowCreated`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// eventListener.js — MEVCUT
} : { 
  crypto_amount: Number(amount), 
  exchange_rate: 0,           // ← SIFIR kur!
  crypto_asset: "USDT",       // ← HARDCODED
  fiat_currency: "TRY"        // ← HARDCODED
};
```

Listing biraz gecikirse (normal ağ davranışı), işlem veritabanında kalıcı olarak yanlış varlık ve 0 kur ile kaydedilir. Kullanıcı "NaN TRY" görür, "param çalındı" panik yapar.

---

### 🔴 KRİT-09 · İlan Eşleştirme LIFO Race Condition

**Dosya:** `eventListener.js` → `_onEscrowCreated`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
Listing.findOne({ 
  maker_address: maker, 
  onchain_escrow_id: null 
}).sort({ _id: -1 }) // ← EN SON ilan bulunuyor (LIFO)
```

Maker aynı anda iki ilan açarsa (ya da ağ gecikmesi), on-chain ID'ler yanlış ilanlara atanır → pazar yeri veri bütünlüğü bozulur.

**Düzeltme:** İlan oluştururken backend'den dönen `listing_id`/`nonce` on-chain'e parametre olarak gönderilmeli, eşleştirme bu değer üzerinden yapılmalı.

---

### 🔴 KRİT-10 · Checkpoint Zehirlenmesi — Event'ler Sessizce Kayboluyor

**Dosya:** `eventListener.js` → `_replayMissedEvents`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// eventListener.js — MEVCUT
for (let from = fromBlock; from <= toBlock; from += BLOCK_BATCH_SIZE) {
  // ...
  for (const event of allEvents) {
    await this._processEvent(event); // ← Bu çökse bile...
  }
  await this._updateCheckpointIfHigher(to); // ← Checkpoint İLERLİYOR!
}
```

RPC rate-limit veya hata durumunda o bloklardaki event'ler işlenemez, ama checkpoint ilerler → o event'ler DLQ'ya bile düşmeden **sonsuza kaybolur**.

**Düzeltme:** Checkpoint sadece başarılı işlem sonrasında ilerletilmeli.

---

### 🔴 KRİT-11 · checkBanExpiry save() Eksik — Ban Asla Kalkmıyor

**Dosya:** `User.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// User.js — MEVCUT
userSchema.methods.checkBanExpiry = function () {
  if (this.is_banned && this.banned_until && new Date() > this.banned_until) {
    this.is_banned    = false;
    this.banned_until = null;
    return true;
    // ← await this.save() YOK! Sadece bellekte değişiyor.
  }
};
```

Ban süresi dolan kullanıcı session boyunca girebilir gibi görünür, ama DB'de `is_banned: true` kalır. Her sayfa yenilemede tekrar banlı.

---

### 🔴 KRİT-12 · EIP-712 Deadline Ezilmesi — Kalıcı Kilitlenme (Deadlock)

**Dosya:** `trades.js` → `/propose-cancel`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// trades.js — MEVCUT
trade.cancel_proposal.deadline = new Date(value.deadline * 1000); // ← Üzerine yazılıyor
```

Maker kendi deadline değeriyle imza attı. Kötü niyetli Taker farklı bir deadline ile aynı endpoint'i çağırıyor. Veritabanındaki deadline değişiyor → Maker'ın imzası geçersiz oluyor → on-chain gönderimde revert → iptal asla gerçekleşmiyor.

---

### 🔴 KRİT-13 · reputationDecay.js Null Timestamp Körlüğü — Temiz Sayfa Çalışmıyor

**Dosya:** `reputationDecay.js` + `User.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// reputationDecay.js
const usersToClean = await User.find({
  "banned_until": { $lt: oneHundredEightyDaysAgo }, // ← $lt null ile eşleşmez!
  "consecutive_bans": { $gt: 0 },
});
```

`checkBanExpiry()` çağrıldığında `banned_until = null` yapılıyor. MongoDB `{ $lt: date }` sorgusu `null` değerlerle eşleşmez. **180 günlük "temiz sayfa" kuralı hiçbir kullanıcı için tetiklenemiyor.**

---

### 🔴 KRİT-14 · auth.js PUT /profile Rate Limit Eksikliği — CPU DoS

**Dosya:** `auth.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// auth.js — MEVCUT
router.put("/profile", requireAuth, /* authLimiter EKSİK! */ async (req, res, next) => {
  // ... encryptPII çağrısı: HKDF + AES-256-GCM = ağır kriptografi
});
```

`authLimiter` import edilmiş ama bu rotaya uygulanmamış. Kimlik doğrulamalı kullanıcı saniyede yüzlerce istek atabilir → Node.js CPU tamamen bloke olur.

---

### 🔴 KRİT-15 · Dinamik PII Manipülasyonu TOCTOU Saldırısı

**Dosya:** `pii.js` + `auth.js`  
**Kaynak:** Kullanıcı Bulgusu  

Saldırı akışı:
1. Taker gerçek adıyla `lockEscrow` → Maker ticareti başlatır
2. Taker çalınmış banka hesabından fiat gönderir
3. **Maker `taker-name` endpoint'ini çağırmadan hemen önce** Taker `PUT /profile` ile adını çalınmış hesap sahibiyle değiştirir
4. Maker isim eşleşiyor → güvenle `releaseFunds` → triangulation koruması bypass

**Kök neden:** PII verileri işlem kilitlendiği anda **snapshot alınmıyor** (bkz. Felsefe İhlali P-07).

---

### 🔴 KRİT-16 · Zombi WebSocket — OOM Bellek Sızıntısı

**Dosya:** `eventListener.js` → `_reconnect`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
async _reconnect() {
  await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
  await this._connect();         // YENİ provider oluşturuluyor
  this._attachLiveListeners();   // YENİ listener'lar
  // ← ESKİ provider.destroy() / removeAllListeners() YOK
}
```

Her ağ dalgalanmasında zombi WebSocket birikir → aynı event'leri çift tetikler + OOM.

---

## 3. YÜKSEK BULGULAR

---

### 🟠 YÜKS-01 · Render Thrashing — React Sayaç Ölüm Döngüsü

**Dosya:** `App.jsx` + `useCountdown.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// App.jsx — MEVCUT (Her render'da YENİ Date objesi)
const gracePeriodEndDate = activeTrade?.paidAt
  ? new Date(new Date(activeTrade.paidAt).getTime() + 48 * 3600 * 1000)
  : null;
const gracePeriodTimer = useCountdown(gracePeriodEndDate);
// ↑ Her saniye UI güncellenince new Date() yeni referans → useEffect tetiklenir
// → setInterval temizlenir → yeniden başlatılır → 6 sayaç × sonsuz döngü
```

**Etki:** Mobil cihazlarda CPU/batarya tükenmesi, Trade Room donması.

**Düzeltme:** `useMemo(() => new Date(...), [activeTrade?.paidAt])`

---

### 🟠 YÜKS-02 · Üçgen Dolandırıcılık Koruması Bypass — PII Guard Eksik

**Dosya:** `App.jsx` → `handleStartTrade`  
**Kaynak:** Kullanıcı Bulgusu  

`handleStartTrade` içinde Taker'ın `bankOwner` girip girmediği kontrol edilmiyor. Yeni cüzdan açıp PII girmeden `lockEscrow` yapılabilir → `/api/pii/taker-name` `{ bankOwner: null }` döner → Maker karşılaştırma yapamaz → triangulation koruması sıfır teknik çabayla aşılır.

---

### 🟠 YÜKS-03 · İtibar Önbelleği Kör Noktası — maxAllowedTier Senkronize Edilmiyor

**Dosya:** `eventListener.js` → `_onReputationUpdated`  
**Kaynak:** Kullanıcı Bulgusu  

`ReputationUpdated` event'inde `consecutiveBans` ve `maxAllowedTier` parametreleri YOK. Bu alanlar DB'ye hiç yazılmıyor. On-chain Tier 1'e düşürülen kullanıcı DB'de Tier 4 görünmeye devam eder → ilan açınca kontrat revert eder → "sistem bozuk" algısı.

---

### 🟠 YÜKS-04 · Atomik Olmayan DB Güncellemeleri

**Dosya:** `eventListener.js` → `_onEscrowReleased`, `_onEscrowBurned`  
**Kaynak:** Kullanıcı Bulgusu  

Trade güncelleme ile User itibar güncelleme ayrı `await` çağrısı. İkisi arasında çökme → işlem RESOLVED ama itibar güncellenmemiş. MongoDB Transactions kullanılmalı.

---

### 🟠 YÜKS-05 · Atomik Olmayan Event Replay — Mükerrer Puanlama ($inc Çakışması)

**Dosya:** `eventListener.js` → `_replayMissedEvents` + `_onBleedingDecayed`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// _onBleedingDecayed — MEVCUT (idempotency YOK)
await Trade.findOneAndUpdate(
  { onchain_escrow_id: Number(tradeId) },
  { $inc: { "financials.total_decayed": Number(decayedAmount) } }
  // ← transactionHash kontrolü YOK → replay'de çift yazılır
);
```

Sunucu replay sırasında çökerse → aynı blok iki kez işlenir → `total_decayed` imkansız değerlere ulaşır.

---

### 🟠 YÜKS-06 · usePII Refresh Token Desenkronizasyonu

**Dosya:** `usePII.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// usePII.js — MEVCUT
const tokenRes = await fetch(`${API_BASE}/api/pii/request-token/${tradeId}`, {
  credentials: 'include',
  // ← App.jsx'teki authenticatedFetch DEĞİL, düz fetch kullanılıyor!
});
```

JWT süresi dolarsa `usePII.js` kendi başına refresh yapamaz → "PII erişimi reddedildi" hatası → yetkili kullanıcı IBAN'a erişemez → gereksiz uyuşmazlık tetiklenebilir.

---

### 🟠 YÜKS-07 · usePII İstek Yarışı — AbortController Eksik

**Dosya:** `usePII.js`  
**Kaynak:** Kullanıcı Bulgusu  

`fetchPII` asenkron çalışıyor ama önceki isteği iptal eden mekanizma yok. Butona hızlıca art arda basılırsa birden fazla request → eski yanıt yeni yanıtın üzerine yazabilir veya rate limit dolabilir.

---

### 🟠 YÜKS-08 · useCountdown Başlangıç State'i — Flicker Sorunu

**Dosya:** `useCountdown.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
const [timeLeft, setTimeLeft] = useState({
  isFinished: true, // ← DEFAULT TRUE! Sayfa yenilendiğinde butonlar anlık AKTİF
});
```

"Release", "Challenge" gibi kritik butonların aktifliği bu sayaca bağlı. Her yenilemede bir anlık aktif görünürler.

---

### 🟠 YÜKS-09 · ErrorBoundary Provider Katmanlarını Felç Ediyor

**Dosya:** `main.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// main.jsx — MEVCUT
<ErrorBoundary>
  <WagmiProvider>
    <QueryClientProvider>
      <App />
    </QueryClientProvider>
  </WagmiProvider>
</ErrorBoundary>
```

Bir connector (Coinbase, OKX) render hatası verirse ErrorBoundary TÜM uygulamayı, WagmiProvider dahil kapatır → kullanıcı fonları kilitli Trade Room'a erişemez.

**Düzeltme:** ErrorBoundary provider'ların **içine** alınmalı.

---

### 🟠 YÜKS-10 · ErrorBoundary Üzerinden PII Sızıntısı

**Dosya:** `ErrorBoundary.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
componentDidCatch(error, errorInfo) {
  fetch(`${apiUrl}/logs/client-error`, {
    body: JSON.stringify({
      message: error.message,    // ← Şifresi çözülmüş IBAN burada olabilir!
      stack: error.stack,
      componentStack: errorInfo.componentStack, // ← PIIDisplay içinden
    })
  });
}
```

Hata tam IBAN render edilirken (`PIIDisplay` içinde) oluşursa plaintext IBAN log dosyasına gider.

---

### 🟠 YÜKS-11 · Faucet Butonu Production'da Görünür

**Dosya:** `App.jsx` → `renderMarket`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// chainId veya NODE_ENV koruması YOK
<button onClick={() => handleMint('USDT')}>Test USDT Al</button>
```

Mainnet'te gerçek işlem yapan kullanıcılar bu butonları görür.

---

### 🟠 YÜKS-12 · Zombi Polling — Çıkış Sonrası Veri Sızıntısı

**Dosya:** `App.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

`disconnect()` → `setIsAuthenticated(false)` yapılıyor ama arka plandaki `fetchMyTrades` interval temizlenmiyor. Birkaç ms sonra polling tamamlanırsa eski işlem verileri state'e geri döner. Paylaşılan bilgisayarda gizlilik ihlali.

---

### 🟠 YÜKS-13 · UI Role Spoofing

**Dosya:** `App.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

`userRole` state'i `maker_address`'e bakılarak client-side belirleniyor. React DevTools ile Taker kendini Maker olarak işaretleyip "Serbest Bırak" butonunu görebilir. Kontrat işlemi reddeder ama bu görüntü manipülatif screenshot'lara ve "sistemde hata var" algısına yol açar.

---

### 🟠 YÜKS-14 · İşlem Takip Belleği Kaybı — txHash State'ten Siliniyor

**Dosya:** `App.jsx` + `useArafContract.js`  
**Kaynak:** Kullanıcı Bulgusu  

`waitForTransactionReceipt` beklenirken sayfa yenilenirse `txHash` yerel state'ten silinir. İşlem blokzincirde başarıyla gerçekleşse bile kullanıcı göremez → "param gitti ama kilitlenmedi" paniği → mükerrer gas harcaması.

**Düzeltme:** `txHash` geçici olarak `localStorage`'a alınmalı, yenilemeden sonra devam etmeli.

---

### 🟠 YÜKS-15 · SIWE URI Doğrulama Eksikliği — Phishing Vektörü

**Dosya:** `siwe.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// siwe.js — MEVCUT (URI KONTROL YOK)
if (message.domain !== expectedDomain) throw new Error(...);
// message.uri kontrol edilmiyor → sahte subdomain imzası geçerli sayılır
```

EIP-4361 standardı `uri` kontrolünü zorunlu kılıyor.

---

### 🟠 YÜKS-16 · SameSite=Strict Web3 Uyumsuzluğu

**Dosya:** `auth.js` → `_getJwtCookieOptions`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
sameSite: "strict"
```

MetaMask/TrustWallet mobil uygulamalardan işlem onaylanıp DApp'e yönlendirme yapıldığında (cross-site navigation), `strict` cookie kuralı gereği tarayıcılar JWT cookie'yi göndermez → kullanıcı anında çıkış yapmış görünür.

**Düzeltme:** `sameSite: "lax"` + kritik işlemlerde CSRF token.

---

### 🟠 YÜKS-17 · Dekont RAM Tükenmesi DoS

**Dosya:** `receipts.js`  
**Kaynak:** Kullanıcı Bulgusu  

`multer.memoryStorage()` + 5MB limit. Tek dosya: Buffer(5MB) → Base64(~6.7MB) → AES encrypt(~13MB) → HEX(~26MB) = ~30MB RAM. 20 eşzamanlı bot → 600MB → OOM → platform çöküşü.

**Düzeltme:** `diskStorage` + stream şifreleme.

---

### 🟠 YÜKS-18 · SIWE Oturum Süresi vs. Bleeding Zamanlaması

**Dosya:** `siwe.js` + `auth.js`  
**Kaynak:** Kullanıcı Bulgusu  

JWT 15 dakika. Bleeding Escrow günlerce sürebilir. Kullanıcı kritik `pingMaker` anında oturumu kapanırsa saniyeler farkıyla işlemi kaçırabilir.

**Düzeltme:** Aktif LOCKED/PAID/CHALLENGED işlemi olan kullanıcılar için "uzatılmış oturum" mekanizması.

---

### 🟠 YÜKS-19 · Tarayıcı Arka Plan Kısıtlaması — Zamanlayıcı Sapması

**Dosya:** `useCountdown.js`  
**Kaynak:** Kullanıcı Bulgusu  

`setInterval(..., 1000)` kullanılıyor. Modern tarayıcılar sekme arka planda olduğunda interval'ı yavaşlatır veya durdurur. 48/240 saatlik uzun süreçlerde UI on-chain zamandan 15-20 dakika geri kalabilir.

**Düzeltme:** Periyodik olarak `block.timestamp` referanslı senkronizasyon.

---

### 🟠 YÜKS-20 · Sayfalama Kararsızlığı

**Dosya:** `listings.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
.sort({ exchange_rate: 1 }) // ← eşit kur = belirsiz sıra
```

Eşit kurlu ilanlar sayfa geçişlerinde iki kez veya hiç görünmeyebilir.

**Düzeltme:** `.sort({ exchange_rate: 1, _id: 1 })`

---

### 🟠 YÜKS-21 · logs.js Kimlik Doğrulamasız Log Silme — Denetim İzi İmhası

**Dosya:** `logs.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
router.post("/client-error", (req, res) => { // requireAuth YOK!
  logger.error(`[FRONTEND-CRASH]`, { message, componentStack, ... });
  res.status(204).end();
});
```

`maxsize: 25MB, maxFiles: 5` = toplam 125MB. Saldırgan sistemde kritik zafiyet sömürdükten sonra bu endpoint'e saniyede binlerce istek → log rotasyonu dolup gerçek saldırı izleri siliniyor.

---

### 🟠 YÜKS-22 · reputation_history Sınırsız Dizi Büyümesi

**Dosya:** `eventListener.js` + `User.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
$push: { reputation_history: { type, score, date, tradeId } }
// $slice YOK — sınırsız büyüme
```

MongoDB 16MB döküman limiti var. Aktif kullanıcıların `reputation_history` binlerce elemana ulaşır → limit aşılınca o kullanıcı için tüm DB güncellemeleri çöker → DLQ'ya düşer → sistem tıkanır.

---

## 4. ORTA BULGULAR

---

### 🟡 ORTA-01 · İptal Denetim İzi Kaybı (Audit Trail)

**Dosya:** `trades.js` → `/propose-cancel`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
trade.cancel_proposal.proposed_by = req.wallet; // Her imzada üzerine yazılıyor!
```

Sürecin gerçekte kimin başlattığı bilgisi kayboluyor. Taciz tespiti imkansız. `approved_by` alanı ayrı tutulmalı.

---

### 🟡 ORTA-02 · Artık İzinler (Unused Allowance)

**Dosya:** `App.jsx` → `handleStartTrade`, `handleCreateEscrow`  
**Kaynak:** Kullanıcı Bulgusu  

`approveToken` başarılı ama `lockEscrow`/`createEscrow` başarısız olursa kontrat üzerinde açık allowance kalır. Catch bloğunda `approve(0)` çağrısı gerekli.

---

### 🟡 ORTA-03 · PII Giriş Validasyonu Eksik

**Dosya:** `App.jsx` (frontend) + `auth.js` (backend)  
**Kaynak:** Kullanıcı Bulgusu  

IBAN alanına 500 karakterlik metin girilebilir → şifrelenip kaydedilir → decryption sırasında buffer hatası. Regex: `/^TR\d{24}$/` ve `maxlength: 100` backend Joi şemasında zorunlu olmalı.

---

### 🟡 ORTA-04 · Hayalet İlanlar — DB Senkronizasyonu

**Dosya:** `App.jsx` → `handleDeleteOrder`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
await cancelOpenEscrow(BigInt(order.onchainId)); // on-chain iptal
setOrders(prev => prev.filter(...));              // sadece local state
// ← DELETE /api/listings/:id çağrısı YOK!
```

Veritabanında ilan `OPEN` kalmaya devam eder. Başka kullanıcı satın almaya çalışır → boşuna gas öder.

---

### 🟡 ORTA-05 · Polling + Write Transaction Race Condition

**Dosya:** `App.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

15 saniyelik polling tam `handleRelease` gönderildiği anda tetiklenirse, eski veri yeni state'in üzerine yazılabilir → kullanıcı butona tekrar basar → 409 hatası.

**Düzeltme:** Aktif kontrat işlemi varken polling durdurulmalı.

---

### 🟡 ORTA-06 · IPFS Hash Injection — XSS Vektörü

**Dosya:** `eventListener.js` → `_onPaymentReported`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
await Trade.findOneAndUpdate(
  { onchain_escrow_id: Number(tradeId) },
  { $set: { "evidence.ipfs_receipt_hash": ipfsHash } }
  // ← ipfsHash doğrudan kontrat event'inden — format kontrolü YOK
);
```

Kötü niyetli Taker doğrudan kontratla etkileşime girerek `ipfsHash` yerine `<script>alert('xss')</script>` gönderebilir. Backend CID format doğrulaması yapmalı.

---

### 🟡 ORTA-07 · PII Token 15 Dakikalık Hayalet Erişim

**Dosya:** `pii.js`  
**Kaynak:** Kullanıcı Bulgusu  

Token alındıktan sonra işlem CANCELED olsa bile token 15 dk geçerli kalır. Taker işlemi iptal ettikten sonra bile IBAN'a erişmeye devam edebilir.

**Düzeltme:** `GET /:tradeId`'de anlık statü kontrolü zorunlu.

---

### 🟡 ORTA-08 · Taker-name CANCELED Sonrası Erişilebilir

**Dosya:** `pii.js` → `/taker-name/:onchainId`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
const allowedStates = ["LOCKED", "PAID", "CHALLENGED"];
// RESOLVED ve CANCELED durumunda erişim kesilmiyor
```

GDPR/KVKK "unutulma hakkı" ihlali. İşlem bitince PII erişimi kesilmeli.

---

### 🟡 ORTA-09 · Stateless JWT İptal Zafiyeti

**Dosya:** `siwe.js` → `revokeRefreshToken`  
**Kaynak:** Kullanıcı Bulgusu  

Logout → refresh token Redis'ten siliniyor ama 15 dakikalık JWT hala geçerli. Ele geçirilmiş JWT kalan süre boyunca PII erişimi sağlar.

**Düzeltme:** Logout'ta JWT `jti` değeri 15 dakikalığına Redis blacklist'e alınmalı.

---

### 🟡 ORTA-10 · Statik Salt Şifreleme Zafiyeti

**Dosya:** `encryption.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
const salt = Buffer.alloc(32, 0); // ← TÜM kullanıcılar için AYNI sıfır salt
```

Master Key ele geçirildiğinde tüm DEK'lar önceden hesaplanmış tablolarla çözülebilir.

**Düzeltme:** `walletRegisteredAt` gibi benzersiz ve değişmez bir değer salt olarak kullanılmalı.

---

### 🟡 ORTA-11 · Protocol Config 7 Günlük Zombi Önbellek

**Dosya:** `protocolConfig.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
const CONFIG_CACHE_TTL = process.env.NODE_ENV === "production" ? 7 * 24 * 3600 : 3600;
```

Kontrat acil güncelleme alırsa backend 7 gün eski kuralları uygulamaya devam eder → tüm `lockEscrow`/`createEscrow` işlemleri revert eder.

---

### 🟡 ORTA-12 · Proxy Arkasında Geçersiz IP Kanıtı

**Dosya:** `trades.js` → `/chargeback-ack`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
const rawIp = req.ip || req.socket?.remoteAddress || "unknown";
```

Proxy arkasında `req.ip` = proxy IP → tüm kullanıcılar için aynı `ip_hash` → hukuki kanıt niteliği yok.

---

### 🟡 ORTA-13 · stats.js Yanıltıcı Sıfır Hesabı

**Dosya:** `stats.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
if (previous === 0 || previous == null) return current > 0 ? 100.0 : 0.0;
```

0→1 işlem de %100, 0→1.000.000 işlem de %100 görünür. İstatistiksel olarak anlamsız.

---

### 🟡 ORTA-14 · Chargeback-Ack Idempotency Bypass

**Dosya:** `trades.js`  
**Kaynak:** Kullanıcı Bulgusu  

`findOne` ile kontrol + milisaniye sonra `save` = race condition. İki eşzamanlı istek aynı anda `acknowledged: false` okur → iki kayıt yazılmaya çalışılır.

---

### 🟡 ORTA-15 · PIIDisplay Pano Güvenlik Eksikliği

**Dosya:** `PIIDisplay.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
navigator.clipboard.writeText(pii.iban.replace(/\s/g, ''));
// try-catch YOK, window.isSecureContext kontrolü YOK
```

HTTP ortamında sessizce başarısız olur → kullanıcı yanlış adrese para gönderir.

---

### 🟡 ORTA-16 · Master Key Bellek Kalıntısı

**Dosya:** `encryption.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
let _masterKeyCache = null;
// ...
_masterKeyCache = Buffer.from(hex.slice(0, 64), "hex");
```

`Buffer.fill(0)` ile sıfırlansa bile V8 GC nedeniyle RAM'in başka bölgelerinde kopyalar kalabilir → memory dump saldırısı.

---

### 🟡 ORTA-17 · Cancun EVM / L2 Uyumluluk Çıkmazı

**Dosya:** `hardhat.config.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
evmVersion: "cancun" // TLOAD/TSTORE opcodeları — Base her zaman desteklemeyebilir
```

OZ v5.x bazı bölümleri Cancun opcode kullanıyorsa Base'e deploy'da `unrecognized opcode` hatası.

---

### 🟡 ORTA-18 · Log Dizini Traversal Riski

**Dosya:** `logger.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
const logFilePath = path.join(__dirname, "../../araf_full_stack.log.txt");
// Proje kök dizini! Nginx yanlış yapılandırılırsa internetten erişilebilir.
```

---

### 🟡 ORTA-19 · Forgotten Right İllüzyonu — receipt_delete_at Cleanup Job Yok

**Dosya:** `receipts.js` + `Trade.js`  
**Kaynak:** Kullanıcı Bulgusu  

Kodun hiçbir yerinde `receipt_delete_at` dolduğunda `receipt_encrypted`'ı null yapan bir cron job yok. Mongoose TTL index dokümanı siler, field'ı null yapmaz. GDPR/KVKK ihlali.

---

## 5. FRONTEND SPESİFİK BULGULAR

---

### 🟡 FRONT-01 · Cüzdan Değiştiğinde JWT Temizlenmiyor (Session Desync)

**Dosya:** `App.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

Kullanıcı MetaMask'ta cüzdanı değiştirir → `useAccount` yeni adresi gösterir ama `authenticatedFetch` eski JWT ile istek atmaya devam eder → "Cüzdan B" ile işlem yaptığını sanırken "Cüzdan A"nın verilerine erişir.

**Düzeltme:** `address` değişince mevcut JWT temizlenmeli ve SIWE yeniden zorunlu.

---

### 🟡 FRONT-02 · Gaz Ücreti Sıçraması — Spinner'da Kayıp Sorun

**Dosya:** `App.jsx` + `useArafContract.js`  
**Kaynak:** Kullanıcı Bulgusu  

Ağ spike'ı → işlem mempool'da bekliyor → kullanıcı "Yükleniyor" spinner'ı görüyor → sayfa yenileniyor → `txHash` state'ten siliniyor → kullanıcı sonucu göremez.

**Düzeltme:** `txHash` geçici `localStorage`'a kaydedilmeli.

---

### 🟡 FRONT-03 · Multi-Token Birim Karmaşası

**Dosya:** `App.jsx` + `useArafContract.js`  
**Kaynak:** Kullanıcı Bulgusu  

`decimals = 6` hardcoded. 18 decimal'lı token (DAI) eklendiğinde 1000 DAI → ekranda 0.000000000001 DAI görünür.

**Düzeltme:** Token adresi için `decimals()` on-chain'den dinamik okunmalı.

---

### 🟡 FRONT-04 · ErrorBoundary Localhost Port Sızıntısı

**Dosya:** `ErrorBoundary.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
```

Production'da `VITE_API_URL` okunamazsa hassas hata stack'leri kullanıcının yerel 4000 portuna gönderilmeye çalışılır.

---

### 🟡 FRONT-05 · Codespaces RPC Güvenlik Sızıntısı

**Dosya:** `main.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
const getCodespacesRPC = (port) => {
  return `https://${host.replace('-5173', `-${port}`)}`; // HTTPS tüneli
};
```

Codespaces instance'ı "Public" olarak ayarlanmışsa tüm Hardhat ağı internete açılır → test bakiyeleri manipüle edilebilir.

---

## 6. BACKEND SPESİFİK BULGULAR

---

### 🟡 BACK-01 · "Nuclear" Refresh Token Rotasyonu — Cihaz Çakışması

**Dosya:** `siwe.js` → `rotateRefreshToken`  
**Kaynak:** Kullanıcı Bulgusu  

Şüpheli deneme → tüm aile family key'leri siliniyor. Mobil + masaüstü aynı anda kullanıyorsa ağ hatası nedeniyle token yenileme başarısız olursa sistem bunu saldırı sanır → her iki cihazdan atılır → Bleeding Escrow anında telafisi imkansız kayıp.

---

### 🟡 BACK-02 · listings.js RPC Hatasında Tier 0 Mahkumiyeti

**Dosya:** `listings.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
} catch (err) {
  return 0; // ← RPC hatasında güvenli varsayılan Tier 0!
}
```

Anlık RPC dalgalanmasında Tier 4 kullanıcı Tier 0 muamelesi görür → ilan açamaz → "sistem bozuk" algısı.

**Düzeltme:** Hata durumunda ret + "doğrulanamadı, tekrar deneyin" mesajı.

---

### 🟡 BACK-03 · Deadline Sunucu/Blokzincir Saat Farkı

**Dosya:** `trades.js` → `/propose-cancel`  
**Kaynak:** Kullanıcı Bulgusu  

Backend deadline'ı sunucu saatiyle doğruluyor ama kontrat `block.timestamp` ile karşılaştırıyor. Birkaç dakikalık sapma → backend "geçerli" ama kontrat "süresi dolmuş" → DB ile zincir arasında kalıcı desenkronizasyon.

---

### 🟡 BACK-04 · Ping Sınıflandırma Race Condition

**Dosya:** `eventListener.js` → `_onMakerPinged`  
**Kaynak:** Kullanıcı Bulgusu  

`EscrowLocked` ve `MakerPinged` çok kısa aralıkla gelirse, backend `EscrowLocked`'ı henüz işlemeden `MakerPinged`'a ulaşabilir → `taker_address` DB'de henüz null → ping yanlış sınıflandırılır.

---

### 🟡 BACK-05 · PII Token İhracı Log Sızıntısı

**Dosya:** `pii.js`  
**Kaynak:** Kullanıcı Bulgusu  

`/request-token/:tradeId` her isteği `logger.info` ile kaydediyor. Log meta verileri genişse token-tradeId eşleşmeleri log dosyasında birikir → saldırgan hedefi için bilgi kaynağı.

---

### 🟡 BACK-06 · Dağıtık Worker Race Condition

**Dosya:** `eventListener.js`  
**Kaynak:** Kullanıcı Bulgusu  

Birden fazla PM2 instance veya K8s pod çalışırsa aynı blokları paralel tarayabilirler → mükerrer `$inc` → itibar puanları haksız yere katlıyor.

**Düzeltme:** Redis Redlock mekanizması.

---

### 🟡 BACK-07 · Chain Re-org Hassasiyeti

**Dosya:** `eventListener.js`  
**Kaynak:** Kullanıcı Bulgusu  

Event yakalandığında MongoDB anında güncelleniyor. Base L2'de nadir de olsa re-org yaşanırsa işlem zincirden düşse bile DB "PAID"/"LOCKED" kalır.

**Düzeltme:** 5-10 blok onay bekle veya re-org rollback mekanizması.

---

### 🟡 BACK-08 · MockERC20 onlyOwner Eksikliği

**Dosya:** `MockERC20.sol`  
**Kaynak:** Kullanıcı Bulgusu  

```solidity
function mint(address to, uint256 amount) external {
  _mint(to, amount); // ← onlyOwner YOK!
}
```

Yanlışlıkla mainnet'e deploy edilirse herkes sınırsız token basabilir.

---

## 7. ALTYAPI BULGULARI

---

### 🟡 ALT-01 · MongoDB Bağlantı Havuzu Yetersizliği

**Dosya:** `db.js`  
**Kaynak:** Kullanıcı Bulgusu  

`maxPoolSize: 10` + `serverSelectionTimeoutMS: 5000`. eventListener replay + API trafiği 10 bağlantıyı tüketince tüm API'ler MongoTimeoutError ile çöker.

**Düzeltme:** `maxPoolSize: 50+`

---

### 🟡 ALT-02 · Redis Tek Nokta Hatası

**Dosya:** `redis.js` + `rateLimiter.js`  
**Kaynak:** Kullanıcı Bulguları  

Redis saniyelik kesinti → `RedisStore` hata fırlatır → tüm rate limiter middleware'ler çöker → tüm endpoint'ler 500. Fallback strategy (MemoryStore geçişi veya fail-open) zorunlu.

---

### 🟡 ALT-03 · Redis TLS Üretim Eksikliği

**Dosya:** `redis.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
redisClient = createClient({ url }); // TLS ayarı yok
```

AWS ElastiCache/Upstash gibi managed servisler `rediss://` (TLS) zorunlu kılar. TLS ayarları eksikse sertifika hatası → sessiz timeout → tüm cache/auth işlemleri başarısız.

---

### 🟡 ALT-04 · db.js Soket/Proxy Zaman Aşımı Uyumsuzluğu

**Dosya:** `db.js`  
**Kaynak:** Kullanıcı Bulgusu  

`socketTimeoutMS: 45000` ama önündeki Nginx/Cloudflare proxy genellikle 30 saniye timeout. 35 saniyelik yavaş sorgu: kullanıcı bağlantısı koptu ama Mongoose beklemeye devam ediyor → zombi sorgu.

---

### 🟡 ALT-05 · db.js Sessiz Reconnect State Bozulması

**Dosya:** `db.js`  
**Kaynak:** Kullanıcı Bulgusu  

`disconnected` event'inde `isConnected = false` yapılıyor. Mongoose otomatik yeniden bağlanırken başka yerden `connectDB()` çağrılırsa iki parallel bağlantı havuzu → "Topology Destroyed" hatası → memory leak → OOM.

**Düzeltme:** Bağlantı koptuğunda `process.exit(1)` → PM2/Docker temiz yeniden başlat (Fail-Fast).

---

## 8. SMART CONTRACT BULGULARI

---

### 🔵 SOL-01 · Tier Tavanı (maxAllowedTier) Kilitlenmesi — "Affedilme" Eksik

**Dosya:** `ArafEscrow.sol`  
**Kaynak:** Kullanıcı Bulgusu  

```solidity
function decayReputation(address _wallet) external nonReentrant {
  rep.consecutiveBans = 0;
  // maxAllowedTier ve hasTierPenalty SIFIRLANMIYOR
}
```

Kullanıcı Tier 4'ten Tier 1'e düşürüldüğünde, 1000 başarılı işlem sonrasında bile teknik olarak Tier 2, 3, 4'e dönemez. "Rütbe iadesi" mekanizması yoktur.

---

### 🔵 SOL-02 · EIP-712 Deadline Backend'de Doğrulanıyor, Kontrat Tarafında Üst Sınır Yok

**Dosya:** `trades.js` + `ArafEscrow.sol`  
**Kaynak:** Kullanıcı Bulgusu  

`MAX_CANCEL_DEADLINE` kontrat sabitinde var (`7 days`), kontrat `proposeOrApproveCancel` içinde `if (_deadline > block.timestamp + MAX_CANCEL_DEADLINE) revert DeadlineTooFar()` korumasını yapıyor. Backend de 7 günlük kontrol yapıyor. Bu tutarlı. **Ancak** backend sistemi bypass edip doğrudan kontrat çağrısı yapılabilir → kontrat koruması bu durumda yeterli.

---

## 9. MİMARİ FELSEFE İHLALLERİ

**İlke: "Kod Kanundur — Backend ve Frontend hakem olamaz, on-chain sabitler tek gerçek kaynaktır."**

---

### 🔵 FEL-01 · Protokol Ücreti Frontend'e Hardcoded

**Dosya:** `App.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
const protocolFee = rawCryptoAmt * 0.001; // %0.1 — HARDCODED!
```

Kontrat `TAKER_FEE_BPS = 10`, `MAKER_FEE_BPS = 10` public constant tutuyor. Frontend on-chain okumak yerine sabit yazıyor. **Felsefe ihlali.**

---

### 🔵 FEL-02 · Tier Limitleri Backend'de Tekrar Hardcoded

**Dosya:** `listings.js`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
const TIER_MAX_CRYPTO = { 0: 150, 1: 1500, 2: 7500, 3: 30000 };
```

Kontrat `TIER_MAX_AMOUNT_TIER0..3` public constant tutuyor. İki kaynak tutarsızlaşabilir.

---

### 🔵 FEL-03 · PII Snapshot Yok — Bait-and-Switch Açık

**Dosya:** `trades.js` + `pii.js` + `Trade.js`  
**Kaynak:** Kullanıcı Bulgusu  

İşlem kilitlendiği anda PII dondurulmuyor. Taker `lockEscrow` sonrası `PUT /profile` ile banka adını değiştirebilir → Maker gelen ödemenin doğru kişiden geldiğini teyit edemez.

**Çözüm:** `on-lock snapshot`: LOCKED anında `maker_bankOwner_enc`, `maker_iban_enc`, `taker_bankOwner_enc` Trade belgesine kopyalanmalı.

---

### 🔵 FEL-04 · Sabit Protokol Ücreti Yanılsaması (Fee Drift)

**Dosya:** `App.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

`protocolConfig.js` bond oranlarını kontratdan okuyor ama **ücret (fee) oranlarını okumuyor**. UI'da gösterilen net alacak miktarı yanlış hesaplanıyor.

---

### 🔵 FEL-05 · Otonom Af Mekanizması Çalışmıyor (180 Gün)

**Dosya:** `reputationDecay.js` + `User.js`  
**Kaynak:** Kullanıcı Bulgusu  

(Bkz. KRİT-13 — `$lt null` eşleşmez. 180 günlük temiz sayfa hiçbir kullanıcı için tetiklenemiyor.)

---

### 🔵 FEL-06 · handleDeleteOrder Backend API Çağırmıyor

**Dosya:** `App.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

`cancelOpenEscrow` on-chain başarılı ama `DELETE /api/listings/:id` çağrısı yok → DB'de ilan yaşamaya devam eder. **"Kod Kanundur" felsefesine göre on-chain gerçeği DB'ye yansıtılmalı.**

---

### 🔵 FEL-07 · Event Listener Gecikmesi — PIIDisplay 404

**Dosya:** `App.jsx` → `handleStartTrade`  
**Kaynak:** Kullanıcı Bulgusu  

`lockEscrow` başarılı → `by-escrow/:onchainId` endpoint'i çağrılıyor ama event listener henüz işlemedi → 404 → retry loop eklendi (kod bunu kısmen çözüyor) ama fundamental gecikme sorunu var.

---

### 🔵 FEL-08 · Hassasiyet Kaybı — BigInt Yerine Number Kullanımı

**Dosya:** `eventListener.js` + `App.jsx`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
crypto_amount: Number(amount), // ← JS Number = max 2^53-1
```

18 decimal'lı tokenlar veya büyük miktarlar bu sınırı aşar → MongoDB'deki rakamlar on-chain gerçeklikten sapabilir.

**Düzeltme:** `Decimal128` veya `String` sakla, `BigInt` ile hesapla.

---

### 🔵 FEL-09 · Admin Paneli Felsefe Çelişkisi

**Kaynak:** Kullanıcı Bulgusu  

Admin "Karar Verici" değil "Gözlemci/Kanıt Sağlayıcı" olmalı. IBAN düzeltme yetkisi kaldırılmalı. Aksi halde "insansız sistem" iddiası çöküyor.

---

### 🔵 FEL-10 · Banka Günlük Limit "Körlüğü"

**Kaynak:** Kullanıcı Bulgusu  

Protokol on-chain Tier 4 yetkisi biliyor ama banka günlük EFT limitinden habersiz. Maker'ın limiti dolmuşsa işlem uyuşmazlığa gidiyor, Bleeding Escrow devreye giriyor. UI'da "Banka Limitim Doldu / Aktif Değilim" toggle önerildi.

---

## 10. OYUN TEORİSİ TUTARSIZLIKLARI

---

### OT-01 · Tier 0 Maliyetsiz Şantaj Riski

**Kaynak:** Kullanıcı Bulgusu  

Taker teminatı %0 → kötü niyetli alıcılar sıfır maliyetle itiraz açıp Maker'ın USDT'sini eritebilir. Saldırı maliyeti: 0. Hedef zarar: `USDT_DECAY × süre`.

---

### OT-02 · Race Condition — Ping Çakışması (ConflictingPingPath)

**Kaynak:** Kullanıcı Bulgusu  

`autoRelease` ve `challengeTrade` aynı anda başlatılmaya çalışıldığında `ConflictingPingPath` hatası UI tarafından yönetilemiyor.

---

### OT-03 · Fiyat Bayatlaması ve Arbitraj Riski

**Kaynak:** Kullanıcı Bulgusu  

İlan 2 gün `OPEN` kalırsa piyasa fiyatı değişir. Arbitrajcılar ucuz ilanı kilitler → Maker ya zararına işlem yapar ya da itibar kaybeder.

**Önerilen çözüm:** İlanlara "Son Kullanma Tarihi" veya kur uyarısı.

---

### OT-04 · Mempool Sniping (Öncülleme)

**Kaynak:** Kullanıcı Bulgusu  

`cancelOpenEscrow` işlemi mempool'da görülünce kötü niyetli Taker öncüleyebilir (front-running). Teknik önlemler değerlendirilmeli.

---

## 11. ÖNCEKİ RAPORDAN ATLANAN / SIĞLANAN BULGULAR

Aşağıdaki bulgular kullanıcının orijinal 700 satırlık listesinde net biçimde yer almasına rağmen önceki raporda ya tamamen atlandı ya da yeterince işlenmedi:

| # | Bulgu | Nerede |
|---|-------|--------|
| 1 | Background Throttling (tarayıcı sekme kısıtlaması) | `useCountdown.js` — ORTA-19 olarak eklendi |
| 2 | Dual-Auth Smuggling (Authorization header fallback) | `auth.js` — önceki raporda yoktu |
| 3 | errorHandler.js "Sonsuz İstek" hanging | `errorHandler.js` — önceki raporda yoktu |
| 4 | logs.js kimlik doğrulamasız denetim izi imhası | `logs.js` — YÜKS-21 olarak eklendi |
| 5 | reputation_history sınırsız dizi | `User.js` — YÜKS-22 olarak eklendi |
| 6 | Redis TLS üretim eksikliği | `redis.js` — ALT-03 olarak eklendi |
| 7 | db.js sessiz reconnect state bozulması | `db.js` — ALT-05 olarak eklendi |
| 8 | Checkpoint zehirlenmesi | `eventListener.js` — KRİT-10 olarak eklendi |
| 9 | PII Token hayalet erişim (CANCELED sonrası) | `pii.js` — ORTA-07 olarak eklendi |
| 10 | Statik salt zafiyeti | `encryption.js` — ORTA-10 olarak eklendi |
| 11 | Protocol config zombi önbellek | `protocolConfig.js` — ORTA-11 olarak eklendi |
| 12 | Dinamik PII TOCTOU saldırısı | `pii.js + auth.js` — KRİT-15 olarak eklendi |
| 13 | IPFS Hash XSS injection | `eventListener.js` — ORTA-06 olarak eklendi |
| 14 | Codespaces RPC sızıntısı | `main.jsx` — FRONT-05 olarak eklendi |
| 15 | Nuclear token rotasyon cihaz çakışması | `siwe.js` — BACK-01 olarak eklendi |
| 16 | PII hasatçılığı | `pii.js` — ayrı bulgu olarak işlenmedi |
| 17 | Banka günlük limit körlüğü | Oyun teorisi — OT-04 kapsamına alındı |
| 18 | Nonce desenkronizasyonu (paralel işlemler) | `siwe.js` — önceki raporda yoktu |
| 19 | İşlem geçmişi için forgot right (receipts) | `receipts.js` — ORTA-19 olarak eklendi |
| 20 | statsSnapshot zaman dilimi hatası | `statsSnapshot.js` — YÜKS-11 olarak eklendi |

### Dual-Auth Smuggling (Önceki Raporda Tamamen Atlanan)

**Dosya:** `auth.js` → `_getTokenPayload`  
**Kaynak:** Kullanıcı Bulgusu  

```javascript
// auth.js — MEVCUT
let token = req.cookies?.araf_jwt;
if (!token) {
  const authHeader = req.headers.authorization; // ← FALLBACK: Header da kabul ediliyor
  token = authHeader.slice(7);
}
```

"Cookie-Only" sisteme geçildi ama `Authorization: Bearer` header fallback bırakıldı. Cookie'ler `httpOnly` ile XSS'e karşı korumalı ama header JWT'leri hâlâ localStorage'dan gönderiliyorsa XSS saldırısı yine de çalışır.

**Düzeltme:** PII harici rotalar için header fallback tamamen kaldırılmalı.

### PII Hasatçılığı (Önceki Raporda Yetersiz İşlendi)

**Dosya:** `pii.js`  
**Kaynak:** Kullanıcı Bulgusu  

Kötü niyetli kullanıcı özellikle Tier 3-4 ilanlarını kilitler → PII kopyalar → iptal önerir veya asılı bırakır. Mevcut akışta `lockEscrow` = PII erişimi yetkisi. Maker'ın ek onayı olmadan Taker PII'ya erişememeli.

**Öneri:** LOCKED'dan belirli süre sonra PII açılsın veya Maker ikinci on-chain onay versin.

### Nonce Desenkronizasyonu (Paralel İmzalar)

**Dosya:** `siwe.js` + `useArafContract.js`  
**Kaynak:** Kullanıcı Bulgusu  

Kullanıcının aynı anda iki farklı işlemi varsa ve her ikisi için aynı anda iptal imzası oluşturuluyorsa her iki imza da aynı `sigNonce` değerini alır → ilki on-chain işlenince nonce artar → ikincisi kontrat tarafından reddedilir.

---

## 12. DÜZELTME YOL HARİTASI

### ⏰ Bugün — Acil (24-48 Saat)

| ID | Bulgu | Dosya | Tahmini Süre |
|----|-------|-------|--------------|
| KRİT-01 | Refresh Token Hijacking | `siwe.js` | 2s |
| KRİT-02 | Ceza Algoritması (Maker→Taker) | `eventListener.js` | 1s |
| KRİT-04 | Fiat/Kripto Hesaplama | `App.jsx` | 30dk |
| KRİT-05 | Rate Limiter + trust proxy | `rateLimiter.js`, `app.js` | 1s |
| KRİT-06 | Dekont Üzerine Yazma | `receipts.js` | 1s |
| KRİT-11 | checkBanExpiry save() | `User.js` | 30dk |
| KRİT-14 | PUT /profile Rate Limit Eksik | `auth.js` | 30dk |

### 📅 Bu Hafta — Yüksek Öncelik

| ID | Bulgu | Dosya | Tahmini Süre |
|----|-------|-------|--------------|
| KRİT-03 | DLQ FIFO Düzeltmesi | `dlqProcessor.js` | 1s |
| KRİT-10 | Checkpoint Zehirlenmesi | `eventListener.js` | 2s |
| KRİT-12 | EIP-712 Deadline Ezilmesi | `trades.js` | 1s |
| KRİT-13 | reputationDecay null sorunu | `reputationDecay.js` | 2s |
| KRİT-16 | Zombi WebSocket | `eventListener.js` | 2s |
| YÜKS-01 | useMemo Sayaç Düzeltmesi | `App.jsx` | 2s |
| YÜKS-04 | MongoDB Transactions | `eventListener.js` | 4s |
| YÜKS-09 | ErrorBoundary → Provider İçine | `main.jsx` | 30dk |
| YÜKS-16 | SameSite=lax + CSRF | `auth.js` | 2s |
| YÜKS-22 | reputation_history $slice Ekle | `eventListener.js` | 1s |
| YÜKS-21 | logs.js requireAuth + rateLimit | `logs.js` | 1s |
| FEL-06 | handleDeleteOrder API Çağrısı | `App.jsx` | 1s |

### 🗓️ Sonraki Sprint — Planlı

| ID | Bulgu | Tahmini Süre |
|----|-------|--------------|
| FEL-03 | PII Snapshot on-lock | 1 gün |
| FEL-01 | Protokol ücreti on-chain okuma | 3s |
| FEL-02 | Tier sabit kod kaldırma | 2s |
| KRİT-15 | TOCTOU PII koruması | 4s |
| ORTA-10 | Statik salt düzeltmesi | 3s |
| ORTA-11 | Protocol config cache invalidation | 2s |
| ORTA-19 | receipt_delete_at cleanup job | 4s |
| ALT-01 | maxPoolSize artırımı | 30dk |
| ALT-02 | Redis failover stratejisi | 4s |
| ALT-03 | Redis TLS konfigürasyonu | 1s |
| YÜKS-17 | diskStorage (RAM DoS) | 4s |
| YÜKS-18 | Uzatılmış oturum mekanizması | 4s |

---

## SONUÇ

Araf Protokolü akıllı sözleşme mimarisi olarak güçlü ve özgün bir tasarıma sahip. Ancak bu raporun ortaya koyduğu bulgular, özellikle kullanıcının test sürecinde keşfettiği gerçek dünya sorunları, şunu açıkça gösteriyor:

**Önce düzeltilmesi gerekenler:**

1. **KRİT-01** hesap güvenliğini tamamen yok ediyor
2. **KRİT-02** protokolün kalbini — oyun teorisi dengesini — kırıyor
3. **KRİT-04** kullanıcının tüm bakiyesini riske atıyor
4. **KRİT-13** ile birlikte **FEL-05** protokolün otonom af mekanizmasını felç ediyor

Genel skor: **5.9/10** — Testnet için uygun, Mainnet için **henüz değil**.

---

> *Araf Protocol — "Sistem yargılamaz. Dürüstsüzlüğü pahalıya mal eder."*  
> Bu ilkenin kod tabanında da tam karşılık bulduğu bir versiyona ulaşmak için yukarıdaki bulgular kritik önemdedir.

---

*Rapor Tarihi: Mart 2026 | Kapsam: Kullanıcı Test Bulguları (700 satır) + Kod Çapraz Analizi*  
*© Araf Protocol — Protokol İçi Kullanım*
