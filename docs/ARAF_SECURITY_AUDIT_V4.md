# Araf Protocol — Güvenlik & Fonksiyonellik Denetim Raporu v4
**Tarih:** Mart 2026 | **Kapsam:** Smart Contract · Backend · Frontend · Database · UI/UX  
**Hedef:** Public Testnet Geçiş Öncesi Tam Denetim  

---

## Özet Tablo

| Seviye | Adet | Durum |
|--------|------|-------|
| 🔴 KRİTİK | 4 | Testnet öncesi zorunlu düzeltme |
| 🟠 YÜKSEK | 4 | Testnet öncesi düzeltilmeli |
| 🟡 ORTA | 5 | İlk sprint içinde |
| 🔵 DÜŞÜK | 5 | Backlog |

---

## 🔴 KRİTİK SORUNLAR

---

### K-01 · Trade Şemasında `pinged_at` ve `pinged_by_taker` Alanları Yok — Mongoose Onları Sessizce Siliyor

**Katman:** MongoDB Model + Event Listener + Frontend  
**Etki:** autoRelease ve Challenge akışları tamamen çalışmıyor.

**Problem zinciri:**

`backend/scripts/models/Trade.js` dosyasındaki `timers` alt belgesi şu şekilde tanımlı:

```js
timers: {
  locked_at:     { type: Date, default: null },
  paid_at:       { type: Date, default: null },
  challenged_at: { type: Date, default: null },
  resolved_at:   { type: Date, default: null },
  last_decay_at: { type: Date, default: null },
},
```

`pinged_at`, `challenge_pinged_at` ve üst seviye `pinged_by_taker` alanları **hiç tanımlı değil.**

`eventListener.js`'deki `_onMakerPinged` handler şunu yazıyor:

```js
{ $set: {
    "timers.pinged_at": new Date(),
    "pinged_by_taker": true,
}}
```

Mongoose varsayılan olarak **strict mode** ile çalışır. Şemada tanımlı olmayan alanlar `$set` ile yazılmaya çalışılsa bile veritabanına **sessizce yazılmaz.** Bu bir hata fırlatmaz, log üretmez — sadece veriyi atar.

**Sonuç:**

1. `pingMaker()` kontrat çağrısı başarıyla gerçekleşir (on-chain ✓)
2. Event listener `_onMakerPinged`'i tetikler
3. `timers.pinged_at` ve `pinged_by_taker` MongoDB'ye hiç yazılmaz
4. `fetchMyTrades` API'si her zaman `pinged_at: null` döndürür
5. Frontend'de `handlePingMaker` sonrası `setActiveTrade(prev => ({...prev, pingedAt: new Date()}))` lokal state'i geçici olarak günceller
6. 15 saniyelik polling ile backend'den `null` gelince lokal state sıfırlanır
7. "Ping Maker" butonu tekrar aktif görünür — kullanıcı kontratı tekrar çağırmaya çalışır → `AlreadyPinged` revert
8. autoRelease akışı asla tamamlanamaz

Aynı sorun `pingTakerForChallenge` → `challengePingedByMaker` → `challenge_pinged_at` zinciri için de geçerli.

**Düzeltme:**

```js
// Trade.js model — timers subdocument'a eklenecek alanlar:
timers: {
  locked_at:          { type: Date, default: null },
  paid_at:            { type: Date, default: null },
  challenged_at:      { type: Date, default: null },
  resolved_at:        { type: Date, default: null },
  last_decay_at:      { type: Date, default: null },
  pinged_at:          { type: Date, default: null },   // EKLENECEK
  challenge_pinged_at: { type: Date, default: null },  // EKLENECEK
},
pinged_by_taker:         { type: Boolean, default: false }, // EKLENECEK (üst seviye)
challenge_pinged_by_maker: { type: Boolean, default: false }, // EKLENECEK (üst seviye)
```

---

### K-02 · `_onMakerPinged` Handler Her Zaman `pinged_by_taker: true` Yazıyor — Maker Ping'ini Taker Ping'i Olarak İşaretliyor

**Katman:** Event Listener  
**Etki:** Maker `pingTakerForChallenge` çağırdığında bile DB'de `pinged_by_taker: true` kaydediliyor. autoRelease ve Challenge akışları çaprazlaşıyor.

**Problem:**

Sözleşmede iki farklı fonksiyon aynı `MakerPinged` eventini emit ediyor:

```solidity
// pingMaker() — taker çağırır
emit MakerPinged(_tradeId, msg.sender, block.timestamp);

// pingTakerForChallenge() — maker çağırır  
emit MakerPinged(_tradeId, msg.sender, block.timestamp);
```

Event payload'ında `pinger` adresi mevcut. Ama `_onMakerPinged` handler bunu hiç kontrol etmeksizin her zaman aynı şeyi yazıyor:

```js
async _onMakerPinged(event) {
  const { tradeId } = event.args;
  await Trade.findOneAndUpdate(
    { onchain_escrow_id: Number(tradeId) },
    { $set: {
        "timers.pinged_at": new Date(),
        "pinged_by_taker": true,   // ← her zaman true, pinger kim olursa olsun
      }
    },
  );
}
```

**Düzeltme:**

```js
async _onMakerPinged(event) {
  const { tradeId, pinger } = event.args;
  
  const trade = await Trade.findOne({ onchain_escrow_id: Number(tradeId) }).lean();
  if (!trade) return;

  const isTakerPing = pinger.toLowerCase() === trade.taker_address?.toLowerCase();

  const updateFields = isTakerPing
    ? { "timers.pinged_at": new Date(), "pinged_by_taker": true }
    : { "timers.challenge_pinged_at": new Date(), "challenge_pinged_by_maker": true };

  await Trade.findOneAndUpdate(
    { onchain_escrow_id: Number(tradeId) },
    { $set: updateFields }
  );
}
```

---

### K-03 · `useArafContract.js` ABI'si Kontrat ile Uyumsuz — `antiSybilCheck` ve `getReputation` Çağrıları Crash Veriyor

**Katman:** Frontend Hook  
**Etki:** Anti-Sybil göstergeleri ve kullanıcı itibar verileri tamamen çalışmıyor. Viem decode hatası fırlatıyor.

**`antiSybilCheck` uyumsuzluğu:**

Kontrat 3 değer döndürüyor:
```solidity
function antiSybilCheck(address _wallet)
  external view
  returns (bool aged, bool funded, bool cooldownOk)
```

Hook ABI'sinde 4 değer tanımlı (gerçekte olmayan `cooldownRemaining` eklenmiş):
```js
'function antiSybilCheck(address _wallet) view returns (bool ageOk, bool balanceOk, bool cooldownOk, uint256 cooldownRemaining)',
```

Viem, kontratın döndürdüğü 3 değerlik encoded byte dizisini 4 değer olarak decode etmeye çalışır → `AbiDecodingDataSizeTooSmallError` veya yanlış değerler.

**`getReputation` uyumsuzluğu:**

Kontrat 5 değer döndürüyor:
```solidity
function getReputation(address _wallet) returns (
    uint256 successful, uint256 failed, uint256 bannedUntil,
    uint256 consecutiveBans, uint8 effectiveTier
)
```

Hook ABI'sinde 6 değer (olmayan `firstSuccessfulTradeAt` eklenmiş):
```js
'function getReputation(address _wallet) view returns (uint256 successful, uint256 failed, uint256 bannedUntil, uint256 consecutiveBans, uint8 effectiveTier, uint256 firstSuccessfulTradeAt)',
```

`userReputation` state'i her zaman `null` kalır → İtibar sekmesi, Tier lock kontrolü, yasaklı kullanıcı tespiti — hepsi devre dışı.

**Düzeltme:** ABI'yi kontratla eşleştir:

```js
// antiSybilCheck — 3 return value
'function antiSybilCheck(address _wallet) view returns (bool aged, bool funded, bool cooldownOk)',

// getReputation — 5 return value  
'function getReputation(address _wallet) view returns (uint256 successful, uint256 failed, uint256 bannedUntil, uint256 consecutiveBans, uint8 effectiveTier)',
```

App.jsx'te `firstSuccessfulTradeAt` ve `cooldownRemaining` referanslarını kaldır, `sybilStatus.cooldownRemaining` kısmını `0` sabit değeriyle değiştir (ya da kontrata `cooldownRemaining` hesaplamasını ekle).

---

### K-04 · `reputationDecay.js` Yanlış MongoDB Yollarını Sorgulıyor — Hiçbir Kullanıcı Temizlenmiyor

**Katman:** Backend Job  
**Etki:** Temiz Sayfa (Clean Slate) kuralı hiçbir zaman çalışmıyor. Yasaklı kullanıcıların `consecutiveBans` sayacı asla sıfırlanmıyor.

**Problem:**

`reputationDecay.js` bu sorguyu yapıyor:

```js
const usersToClean = await User.find({
  "reputation_cache.banned_until": { $lt: oneHundredEightyDaysAgo },
  "reputation_cache.consecutive_bans": { $gt: 0 },
}).limit(50);
```

Ancak `User.js` modelinde bu alanlar `reputation_cache` alt belgesi altında **değil**, üst seviyede tanımlı:

```js
// User.js — üst seviye alanlar:
is_banned:         { type: Boolean, default: false },
banned_until:      { type: Date,    default: null  },
consecutive_bans:  { type: Number,  default: 0     },
max_allowed_tier:  { type: Number,  default: 4     },
```

`reputation_cache` sadece şunları içeriyor: `success_rate`, `total_trades`, `failed_disputes`, `failure_score`.

Bu sorgu her zaman 0 sonuç döndürür. Job çalışır, log basar, ama hiçbir şey yapmaz.

**Düzeltme:**

```js
const usersToClean = await User.find({
  "banned_until":      { $lt: oneHundredEightyDaysAgo },
  "consecutive_bans":  { $gt: 0 },
}).limit(50);
```

---

## 🟠 YÜKSEK ÖNCELİKLİ SORUNLAR

---

### Y-01 · Marketplace'ten Başlayan Trade'lerde PIIDisplay Yanlış ID Kullanıyor — 404 Döner

**Katman:** Frontend  
**Etki:** Taker, marketplace'ten bir işlem başlattığında IBAN görüntüleme her zaman başarısız oluyor.

**Problem:**

`handleStartTrade` fonksiyonu şunu yapıyor:
```js
setActiveTrade({ ...order, onchainId: order.onchainId });
```

`order.id = l._id` → Bu, **Listing** belgesinin MongoDB `_id`'si.

Trade Room'da PIIDisplay şöyle çağrılıyor:
```jsx
<PIIDisplay tradeId={activeTrade?.id} ... />
```

Backend PII route'u şunu yapıyor:
```js
const trade = await Trade.findById(tradeId).lean(); // Trade koleksiyonunda arar
```

Listing `_id`'si ile Trade koleksiyonunda arama → her zaman 404.

Bu sorun sadece profil modalından odaya girildiğinde yoktur çünkü orada `rawTrade.id = t._id` (Trade `_id`) kullanılıyor.

**Düzeltme:** `handleStartTrade` sonrasında veya lockEscrow'un receipt'ini aldıktan sonra trade'in gerçek MongoDB `_id`'sini fetch et:

```js
// lockEscrow başarısından sonra:
const tradeRes = await authenticatedFetch(`${API_URL}/api/trades/by-escrow/${order.onchainId}`);
const { trade } = await tradeRes.json();
setActiveTrade({ ...order, id: trade._id, onchainId: order.onchainId });
```

Alternatif olarak `onchain_escrow_id` ile Trade fetch eden yeni bir endpoint ekle.

---

### Y-02 · `handleCreateEscrow` Off-Chain İlan Oluşturmada Yanlış Joi Alanları Gönderiyor

**Katman:** Frontend → Backend Route  
**Etki:** Pre-creation call her zaman 400 döner, sessizce hata yutulur. SORUN-08 (listing-trade ID eşleşmesi) hiçbir zaman çözülemiyor.

**Problem:**

`handleCreateEscrow` içindeki pre-creation çağrısı:
```js
body: JSON.stringify({
  crypto_asset: makerToken,
  fiat_currency: makerFiat,
  exchange_rate: parseFloat(makerRate),
  limits: { min: parseFloat(makerMinLimit), max: parseFloat(makerMaxLimit) },
  tier_rules: { required_tier: makerTier }   // ← YANLIŞ
  // token_address eksik                      // ← EKSİK
})
```

Backend `POST /api/listings` Joi şeması şunu bekliyor:
```js
tier: Joi.number().valid(0,1,2,3,4).required(),          // tier_rules değil
token_address: Joi.string().pattern(...).required(),       // zorunlu
```

Joi validasyonu `tier` olmadığı için 400 döner. Hata `catch (e) { console.warn(...) }` ile yutulur.

**Düzeltme:**
```js
body: JSON.stringify({
  crypto_asset:  makerToken,
  fiat_currency: makerFiat,
  exchange_rate: parseFloat(makerRate),
  limits:        { min: parseFloat(makerMinLimit), max: parseFloat(makerMaxLimit) },
  tier:          makerTier,              // tier_rules değil
  token_address: SUPPORTED_TOKEN_ADDRESSES[makerToken], // zorunlu alan
})
```

---

### Y-03 · `usePII` Hook'u `'Bearer cookie-active'` Header'ı Gönderiyor

**Katman:** Frontend Hook  
**Etki:** Step 1 (PII token talebi) güvensiz bir authorization header gönderiyor. Backend cookie'yi bulduğu için şu an çalışıyor ama bu fragile bir yapı.

**Problem:**

`setJwtToken('cookie-active')` string değer atandıktan sonra bu `authToken` olarak `usePII`'ye geçiyor:

```js
// usePII.js:
if (authToken) step1Headers['Authorization'] = `Bearer ${authToken}`;
// Gerçekte gönderilen: "Bearer cookie-active"
```

Backend bu geçersiz token'ı alır ama `requireAuth` middleware'i önce cookie'yi kontrol ettiği için pass geçer. Yanlış ağ/tarayıcı davranışları veya proxy'ler bu geçici çözümü kırabilir.

**Düzeltme:** Cookie-based auth'a geçildiği için `authToken` prop'u `usePII`'den kaldırın. Her iki adımda da `credentials: 'include'` kullanın:

```js
// usePII.js — authToken parametresi ve tüm header koşulları kaldırılır
const tokenRes = await fetch(`${API_BASE}/api/pii/request-token/${tradeId}`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
});
```

---

### Y-04 · `handleChallenge` Fonksiyonu `challengePingedAt`'i Hiçbir Zaman Bulamıyor

**Katman:** Frontend  
**Etki:** Maker "İtiraz Et" butonuna her bastığında `challengeTrade` yerine `pingTakerForChallenge` çağrısı yapıyor. Kontrat `AlreadyPinged` revert'i veriyor (K-01 düzeldikten sonra).

**Problem:**

```js
// handleChallenge içinde:
const tradeDetails = activeEscrows.find(e => e.id === `#${activeTrade.onchainId}`);
const challengePingedAt = tradeDetails?.challengePingedAt;
```

`fetchMyTrades` şunu yapıyor:
```js
challengePingedAt: t.timers?.challenge_pinged_at,
```

K-01 nedeniyle bu alan Trade şemasında yok → her zaman `undefined` → `handleChallenge` her zaman `!challengePingedAt` koşulunu true buluyor → her zaman ping çağrısı yapıyor → asla `challengeTrade`'e geçemiyor.

Bu sorun K-01 düzeltildikten sonra otomatik olarak da çözülecek, ama bağımlılığın farkında olmak önemli.

---

## 🟡 ORTA ÖNCELİKLİ SORUNLAR

---

### O-01 · `MIN_ACTIVE_PERIOD` Sözleşmede 15 Gün, Dokümanlarda 30 Gün

**Katman:** Smart Contract + Dokümantasyon  
**Etki:** Tier 1 erişim süresi konusunda kullanıcı beklentisi ile gerçek davranış farklı.

```solidity
uint256 public constant MIN_ACTIVE_PERIOD = 15 days; // Sözleşme
```

`ARCHITECTURE_TR.md` ve `ARCHITECTURE_EN.md` her ikisinde de "30 gün" yazıyor.

App.jsx'te de bu yanlış bilgi var:
```js
// Profil sayfasındaki açıklama:
if (new Date().getTime() / 1000 < firstSuccessfulTradeAt + 15 * 24 * 3600) { ... }
// 15 gün doğru hesaplamayı kullanıyor ama metin açıklamaları 30 gün diyor
```

Karar: ya sözleşmeyi 30 güne güncelle ya da tüm dokümantasyonu 15 gün olarak düzelt.

---

### O-02 · `_getOnChainEffectiveTier` Her İlan Oluşturmada Yeni RPC Provider Yaratıyor

**Katman:** Backend Route  
**Etki:** Her `POST /api/listings` isteğinde yeni bir `JsonRpcProvider` instance'ı oluşturuluyor. Yüksek trafik altında RPC rate limit sorunlarına ve bellek sızıntısına yol açabilir.

```js
async function _getOnChainEffectiveTier(walletAddress) {
  const provider = new ethers.JsonRpcProvider(rpcUrl); // ← Her çağrıda yeni instance
  const contract = new ethers.Contract(contractAddress, REPUTATION_ABI, provider);
  ...
}
```

**Düzeltme:** Provider'ı modül seviyesinde cache'le:
```js
let _cachedProvider = null;
function _getProvider() {
  if (!_cachedProvider) _cachedProvider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  return _cachedProvider;
}
```

---

### O-03 · Token Adresi Yapılandırılmamışsa "Satın Al" Butonu Aktif Kalıyor

**Katman:** Frontend  
**Etki:** `VITE_USDT_ADDRESS` veya `VITE_USDC_ADDRESS` tanımsızken kullanıcı "Satın Al" butonuna basar → `handleStartTrade` toast ile hata verir ama buton disabled görünmüyor.

```js
// App.jsx — finalCanTakeOrder hesabı:
const canTakeOrder = isConnected && jwtToken && !isMyOwnAd && !isTierLocked && !isPaused;
// Token adresi kontrolü YOK
```

**Düzeltme:**
```js
const tokenAddr = SUPPORTED_TOKEN_ADDRESSES[order.crypto];
const isTokenConfigured = Boolean(tokenAddr);
const finalCanTakeOrder = canTakeOrder && isCooldownOk && isFunded && isTokenConfigured;
```

---

### O-04 · Yanlış Ağda "Satın Al" Butonu Disable Edilmiyor

**Katman:** Frontend  
**Etki:** Kullanıcı Ethereum mainnet'te iken "Satın Al" butonuna basabilir, kontrat çağrısı belirsiz hata mesajıyla başarısız olur.

Zincir uyarı banner'ı gösteriliyor ama `finalCanTakeOrder` chain ID kontrolü yapmıyor:

```js
// Eksik kontrol:
const isCorrectChain = chainId === 84532; // Base Sepolia
const finalCanTakeOrder = canTakeOrder && isCooldownOk && isFunded && isCorrectChain;
```

---

### O-05 · Bleeding Timer İtiraz Sonrası İlk 15 Saniyede Yanlış Değer Gösteriyor

**Katman:** Frontend  
**Etki:** Kullanıcı `challengeTrade` çağırdıktan hemen sonra Trade Room'a geçerse `activeTrade.challengedAt` null, tüm bleeding timer'ları `isFinished: true` gösteriyor.

`handleChallenge` sadece `setTradeState('CHALLENGED')` yapıyor ama `activeTrade.challengedAt`'i güncellemıyor. Polling 15 saniyede bir çalışıyor.

**Düzeltme:**
```js
// challengeTrade başarısından sonra:
await challengeTrade(BigInt(activeTrade.onchainId));
setTradeState('CHALLENGED');
setActiveTrade(prev => ({ ...prev, challengedAt: new Date().toISOString() })); // EKLENECEK
```

---

## 🔵 DÜŞÜK ÖNCELİKLİ SORUNLAR

---

### D-01 · `AppPastUi.jsx` — İçinde React Hook Kuralı İhlali Olan Arşiv Dosyası Repo'da Kalıyor

**Katman:** Frontend  
**Etki:** Build uyarısı üretmiyor ama import edilirse `useCountdown`'ın `renderTradeRoom` içinde çağrılması "Invalid hook call" hatasına yol açar. Karışıklık ve yanlış kopyalama riski.

**Öneri:** Dosyayı tamamen sil. Gerekirse git history'de yaşıyor.

---

### D-02 · Profil Geçmişi Sekmesi Modal Kapanıp Açılınca Sayfa 1'e Dönüyor

**Katman:** Frontend UX  
**Etki:** Kullanıcı 3. sayfadayken modalı kapatıp tekrar açarsa sayfa 1'e sıfırlanıyor.

`tradeHistoryPage` state'i profile modal state'inden bağımsız tutuluyor. `showProfileModal` true olduğunda `useEffect` her seferinde `fetchHistory(tradeHistoryPage)` çağırıyor.

---

### D-03 · DLQ Hiçbir Zaman Gerçek Anlamda Boşalmıyor

**Katman:** Backend Service  
**Etki:** `processDLQ` entry'leri okur, loglar ve archive'e taşır ama normal işleme sonrası ana DLQ'dan silmez. MAX_DLQ_SIZE (100) dolana kadar birikir, sonra archive'e taşınır ama DLQ'daki kayıtlar hala duruyor.

Manuel müdahale olmadan DLQ asla sıfırlanmaz.

---

### D-04 · `/api/stats` Fetch Hata Durumunda UI Boş Kalıyor

**Katman:** Frontend  
**Etki:** Stats API çökmüşse kullanıcı tüm metrik kartlarını `—` veya `0` olarak görüyor, hata mesajı yok.

```js
// Mevcut:
} catch (err) {
  console.error("Stats fetch error:", err);
} finally {
  setStatsLoading(false);
}
```

Basit bir `setStatsError(true)` ile "Veri alınamadı, yenile" mesajı eklenebilir.

---

### D-05 · `makerFiat` Seçimi On-Chain createEscrow Çağrısına Yansımıyor

**Katman:** Frontend  
**Etki:** Maker "EUR" seçse bile on-chain escrow kaydı fiat bilgisi taşımıyor (kontrat tasarımı gereği). Ancak off-chain listing pre-creation çağrısı da Y-02 nedeniyle başarısız olduğundan bu bilgi hiçbir yerde saklanmıyor. Trade history'de fiat_currency her zaman "TRY" (DB varsayılanı) görünüyor.

Y-02 düzeltildiğinde bu da otomatik çözülür.

---

## UI/UX Akışında Kullanıcıya Yansımayan Durumlar

### UX-01 · Ping Durumu Yenileme Sonrası Sıfırlanıyor
"Satıcıyı Uyar" butonuna basıldığında yeşil "Satıcı Uyarıldı" kutusu gösteriyor. Ama sayfa yenilenince veya 15 saniyelik polling sonrasında K-01 nedeniyle `pingedAt: null` geliyor ve buton tekrar aktif hale geliyor. Kullanıcı aynı butona birden fazla basmak zorunda kalıyor, ikincisinde kontrat `AlreadyPinged` hatasıyla geri dönüyor.

### UX-02 · Challenge Akışı UI'da İki Aşamalı Görünmüyor
Maker "İtiraz Et" butonuna ilk bastığında ne olacağı UI'da net değil. Ping → 24 saat bekle → Challenge akışı açıklanmıyor. Kullanıcı ping gönderdiğinde şaşırıyor.

### UX-03 · autoRelease 5% İhmal Cezası Uyarısı Yetersiz
"Dikkat: Bu işlem ... %5 kesinti yapacaktır" metni çok küçük. Kullanıcı fark etmeden onayladığında sürprizle karşılaşıyor.

### UX-04 · İtibar Sekmesi K-03 Nedeniyle Her Zaman "Yükleniyor..." Gösteriyor
`getReputation` ABI uyumsuzluğu nedeniyle `userReputation` state'i her zaman `null` kalıyor. İtibar sekmesi hiçbir veri gösteremiyor.

### UX-05 · Wallet Kayıt Uyarısı Trade Room'da Yok
Kullanıcı wallet kaydı olmadan (Anti-Sybil) marketplace'ten işlem başlatmaya çalıştığında `lockEscrow` kontrat çağrısı `WalletTooYoung` hatası veriyor. Bu hata yeterince açıklayıcı ama kayıt banner'ı sadece navbar'da gösteriliyor — Trade Room açıkken görünmüyor.

---

## Düzeltme Öncelik Sırası

| Önce | Sonra |
|------|-------|
| K-01: Trade şemasına pinged_at ekle | Y-01: PIIDisplay tradeId kaynağı |
| K-02: _onMakerPinged pinger kontrolü | Y-02: Listing pre-creation Joi fix |
| K-03: ABI uyumsuzluklarını düzelt | O-01: MIN_ACTIVE_PERIOD tutarlılığı |
| K-04: reputationDecay query yolları | O-04: Chain ID buy button kontrolü |
| Y-03: usePII cookie-only auth | O-03: Token address buy button kontrolü |
| Y-04: (K-01 sonrası otomatik) | D-01: AppPastUi.jsx dosyasını sil |

---

*Bu rapor, SECURITY_AUDIT_V3.md bulgularının üzerine yeni bulgular eklenmiştir. Önceki rapordaki tüm düzeltmeler (SORUN-01..09, AUDIT FIX serisi) kod tabanında mevcut olduğu doğrulanmıştır.*
