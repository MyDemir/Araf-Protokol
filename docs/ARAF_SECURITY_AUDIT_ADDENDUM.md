# 🌀 ARAF PROTOCOL — GÜVENLİK RAPORU EK ANALİZİ
## ArafEscrow.sol × App.jsx Çapraz Akış Analizi

> **Önceki Rapor:** `ARAF_SECURITY_AUDIT_v2.md` (73 bulgu)  
> **Bu Ek:** ArafEscrow.sol (~1200 satır) ile App.jsx (~2700 satır) kullanıcı akışı çapraz analizi  
> **Yöntem:** Kontrat fonksiyon gereksinimleri ile UI akışı satır satır eşleştirildi  
> **Tarih:** Mart 2026

---

## ÖZET: ÖNCEKI RAPORDA YER ALMAYAN YENİ BULGULAR

| Seviye | Yeni Bulgu | Toplam |
|--------|------------|--------|
| 🔴 Kritik | 2 | +2 |
| 🟠 Yüksek | 7 | +7 |
| 🟡 Orta | 9 | +9 |
| **Toplam** | | **+18 yeni bulgu** |

---

## 🔴 KRİTİK — YENİ

---

### 🔴 EK-KRİT-01 · Maker'ın Challenge Butonu Hiç Render Edilmiyor

**Dosyalar:** `App.jsx` → `renderTradeRoom` + `handleChallenge`  
**Akış:** PAID durumu → Maker arayüzü  

`handleChallenge` fonksiyonu tanımlanmış, `pingTakerForChallenge` ve `challengeTrade`'i çağırabiliyor. Ancak bu fonksiyon **hiçbir yerde `onClick` olarak bağlanmıyor.**

PAID durumu `isMaker` render bloğu incelendiğinde:

```jsx
// App.jsx — isMaker, PAID state render bloğu (mevcut)
} : (
  <div className="flex flex-col items-center">
    <p>Alıcının transferi bekleniyor...</p>
    {isMaker && (
      <div>Alıcının Doğrulanmış İsmi: {takerName}</div>
    )}
    {/* ← CHALLENGE / PING TAKER BUTONU YOK */}
  </div>
)}

// Ortak aksiyon paneli (LOCKED/PAID/CHALLENGED):
{isChallenged && isMaker && (
  <button onClick={handleRelease}>🤝 Serbest Bırak</button>
)}
<button onClick={() => { handleProposeCancel() }}>↩️ İptal Teklif Et</button>
// ← handleChallenge hiçbir yerde onclick olarak kullanılmıyor
```

**Sonuç:** Maker, ödeme almadığını düşünse de:
1. `pingTakerForChallenge()` çağıramıyor → uyarı gönderemiyor  
2. `challengeTrade()` çağıramıyor → itiraz açamıyor  
3. Sahip olduğu tek seçenek ya fonları serbest bırakmak ya da iptal önermek

Sistem Maker'ı 48 saat bekletip ardından tek yönlü serbest bırakma yapmaya zorluyor. **Bleeding Escrow mekanizması pratik olarak Maker tarafından başlatılamıyor.**

**Düzeltme:**
```jsx
// PAID state, isMaker bloğuna eklenecek
{isMaker && tradeState === 'PAID' && (
  <div className="w-full max-w-md mt-4">
    {/* Adım 1: 24 saat sonra ping */}
    {!activeTrade?.challengePingedAt && (
      <button
        onClick={handleChallenge}
        disabled={/* paidAt + 24h geçmedi */ !canPingTaker || isContractLoading}
        className="..."
      >
        🔔 Alıcıya Uyarı Gönder (Ödeme Gelmedi)
      </button>
    )}
    {/* Adım 2: Ping'den 24 saat sonra itiraz */}
    {activeTrade?.challengePingedAt && (
      <button
        onClick={handleChallenge}
        disabled={!canMakerChallenge || isContractLoading}
        className="..."
      >
        ⚔️ Resmi İtiraz Başlat
      </button>
    )}
  </div>
)}
```

**Gerekli ek:** `paidAt + 24h` timer'ı da oluşturulmalı:
```javascript
// Kontrat: pingTakerForChallenge → paidAt + 24 hours
const pingTakerEndDate = useMemo(() =>
  activeTrade?.paidAt
    ? new Date(new Date(activeTrade.paidAt).getTime() + 24 * 3600 * 1000)
    : null,
  [activeTrade?.paidAt]
);
const pingTakerTimer = useCountdown(pingTakerEndDate);
const canPingTaker = pingTakerTimer.isFinished;
```

---

### 🔴 EK-KRİT-02 · tradeState Yerel State ile Sunucu State'i Ayrışıyor

**Dosya:** `App.jsx`  
**Akış:** Polling güncellemesi → Trade Room render  

```javascript
// App.jsx — İKİ AYRI STATE KAYNAĞI
const [tradeState, setTradeState] = useState('LOCKED'); // ← yerel

// Polling sırasında activeTrade güncelleniyor AMA tradeState güncellenmiyor:
setActiveTrade(prev => {
  return { ...prev, state: updated.status, ... }; // activeTrade.state güncellendi
  // tradeState GÜNCELLENMEDI!
});
```

`renderTradeRoom` tüm dallanma mantığını `tradeState`'e göre yapıyor:
```jsx
{tradeState === 'PAID' && (...)}
{tradeState === 'CHALLENGED' && (...)}
```

**Senaryo:** Karşı taraf on-chain itiraz açtı → polling 15 saniyede `activeTrade.state = 'CHALLENGED'` yaptı → ama `tradeState` hâlâ `'PAID'` → Maker PAID arayüzü görüyor, Bleeding bar görünmüyor, challenge-specific butonlar eksik → kullanıcı "sistem dondu" sanıyor.

**Düzeltme:**
```javascript
// fetchMyTrades içinde, setActiveTrade'in yanına:
setActiveTrade(prev => {
  if (!prev) return prev;
  const updated = data.trades.find(t => t.onchain_escrow_id === prev.onchainId);
  if (!updated) return prev;
  // tradeState DE güncellenmeli:
  if (updated.status !== prev.state) {
    setTradeState(updated.status); // ← EKLENMELİ
  }
  return { ...prev, state: updated.status, ... };
});
```

---

## 🟠 YÜKSEK — YENİ

---

### 🟠 EK-YÜKS-01 · Maker'ın pingTakerForChallenge İçin 24h Timer Yok

**Dosya:** `App.jsx`  
**Kontrat:** `pingTakerForChallenge` → `require(block.timestamp >= t.paidAt + 24 hours)`  

Mevcut timer'lar:
```javascript
const makerPingEndDate = paidAt + 48h;  // Taker'ın pingMaker için
const makerChallengeEndDate = challengePingedAt + 24h; // Challenge sonrası
// ← Maker'ın pingTakerForChallenge için paidAt + 24h timer YOK
```

Eğer challenge butonu eklenirse, bu timer olmadan kullanıcı 24h geçmeden butona basabilir → kontrat `PingCooldownNotElapsed` ile revert eder → UI sadece generic hata gösterir.

---

### 🟠 EK-YÜKS-02 · challengeCountdown ile makerChallengeTimer Duplikasyonu

**Dosya:** `App.jsx`  

```javascript
// Her ikisi de aynı şeyi hesaplıyor: challengePingedAt + 24h
const challengeCountdown = useCountdown(
  activeTrade?.challengePingedAt
    ? new Date(new Date(activeTrade.challengePingedAt).getTime() + 24 * 3600 * 1000)
    : null
);
const canChallenge = challengeCountdown.isFinished;

const makerChallengeEndDate = activeTrade?.challengePingedAt
  ? new Date(new Date(activeTrade.challengePingedAt).getTime() + 24 * 3600 * 1000)
  : null;
const makerChallengeTimer = useCountdown(makerChallengeEndDate);
const canMakerChallenge = makerChallengeTimer.isFinished;
```

İki ayrı `useCountdown` hook'u aynı değer için çalışıyor. YÜKS-01 (Render Thrashing) sorununu derinleştiriyor. Biri kaldırılmalı.

---

### 🟠 EK-YÜKS-03 · getCooldownRemaining() Hiç Kullanılmıyor

**Dosya:** `App.jsx` + `useArafContract.js`  
**Kontrat:** `getCooldownRemaining(address)` → `view returns (uint256)` (saniye cinsinden)  

```javascript
// antiSybilCheck sadece bool döndürüyor:
cooldownOk: typeof res.cooldownOk !== 'undefined' ? res.cooldownOk : res[2],

// Pazar yeri butonu:
!isCooldownOk ? <span>⏳ Cooldown Aktif</span> : ...
// ← Ne kadar beklemesi gerektiği hiç gösterilmiyor
```

Taker 4 saatlik cooldown'ın kaçıncı dakikasında olduğunu bilemez. Kontrat `getCooldownRemaining` ile saniye cinsinden kalan süreyi açıkça sunuyor ama kullanılmıyor.

---

### 🟠 EK-YÜKS-04 · takerName Sadece LOCKED State'te Fetch Ediliyor

**Dosya:** `App.jsx`  

```javascript
// App.jsx — mevcut koşul
if (currentView === 'tradeRoom' && tradeState === 'LOCKED' && userRole === 'maker' && ...) {
  authenticatedFetch(`${API_URL}/api/pii/taker-name/${activeTrade.onchainId}`)
    .then(data => { if (data.bankOwner) setTakerName(data.bankOwner); });
}
// ← tradeState 'PAID' veya 'CHALLENGED' olduğunda fetch yapılmıyor
```

Senaryo: Maker sayfayı kapattı → yeniden açtı → işlem zaten PAID durumunda → `takerName` boş → triangulation koruması çalışmıyor.

**Düzeltme:**
```javascript
// LOCKED, PAID ve CHALLENGED durumlarında fetch yapılmalı
if (currentView === 'tradeRoom' &&
    ['LOCKED','PAID','CHALLENGED'].includes(tradeState) &&
    userRole === 'maker' && ...) {
```

---

### 🟠 EK-YÜKS-05 · handleCreateEscrow'da da 6 Decimal Hardcoded

**Dosya:** `App.jsx` → `handleCreateEscrow`  
**Önceki Rapor:** KRİT-04 handleStartTrade için bunu bulmuştu, ama handleCreateEscrow da aynı hatayı içeriyor  

```javascript
// handleCreateEscrow — mevcut
const decimals = BigInt(6); // ← HARDCODED!
const cryptoAmountRaw = BigInt(Math.round(cryptoAmt * 10 ** Number(decimals)));
```

Maker tarafı da aynı sorundan etkileniyor. 18 decimal'lı token eklendiğinde Maker da yanlış miktarı kilitler.

---

### 🟠 EK-YÜKS-06 · chargebackAccepted Sayfa Yenilemesinde Sıfırlanıyor

**Dosya:** `App.jsx`  

```javascript
const [chargebackAccepted, setChargebackAccepted] = useState(false); // her zaman false başlıyor
```

Kullanıcı "Ters ibraz riskini anladım" kutusunu işaretledi → sayfayı yeniledi → tekrar işaretlemesi gerekiyor. Kritik uyuşmazlık anında bu gecikme önemli.

Önceki rapordaki `chargebackAccepted bilgisi sayfa yenilendiğinde backend'den geri yüklenmelidir` notu kod tabanıyla karşılaştırıldığında `chargeback_ack.acknowledged` alanı Trade belgesinde mevcut → backend'den okunabilir ama okunmuyor.

**Düzeltme:** `fetchMyTrades` sonrasında `activeTrade`'in `chargeback_ack.acknowledged` alanına göre state güncellenmeli.

---

### 🟠 EK-YÜKS-07 · handleDeleteOrder OPEN State Doğrulaması Yok

**Dosya:** `App.jsx` → `handleDeleteOrder`  

```javascript
const handleDeleteOrder = async (order) => {
  // ← order.status === 'OPEN' kontrolü YOK
  await cancelOpenEscrow(BigInt(order.onchainId));
  // Kontrat: cancelOpenEscrow → inState(OPEN) zorunlu
  // LOCKED durumunda kontrat OnlyMaker değil InvalidState ile revert eder
};
```

Eğer bir şekilde OPEN olmayan bir işlem bu kod path'ine düşerse kontrat revert eder ama hata mesajı bağlamdan kopuk olur. Ön kontrol eklenebilir.

---

## 🟡 ORTA — YENİ

---

### 🟡 EK-ORTA-01 · Cüzdan Yaşı Kaç Gün Kaldı Gösterilmiyor

**Dosya:** `App.jsx`  
**Kontrat:** `walletRegisteredAt[address]` + `WALLET_AGE_MIN = 7 days`  

```javascript
// Banner — mevcut
<span>⚠️ Cüzdan On-Chain Kayıtlı Değil (Anti-Sybil 7 Gün)</span>
// ← Kayıtlı olan ama henüz 7 gün dolmamış kullanıcılara hiçbir şey gösterilmiyor
```

Cüzdanını kaydeden kullanıcı 7 gün beklemesi gerektiğini biliyor ama kaç gün kaldığını göremez. `walletRegisteredAt` on-chain okuma ile hesaplanabilir.

---

### 🟡 EK-ORTA-02 · ConflictingPingPath Revert Özel Olarak Yakalanmıyor

**Dosya:** `App.jsx` → `handlePingMaker`, `handleChallenge`  
**Kontrat:** `error ConflictingPingPath()`  

```javascript
} catch (err) {
  const errorMessage = err.shortMessage || err.reason || err.message || 'Ping başarısız.';
  showToast(errorMessage, 'error');
  // ← ConflictingPingPath için özel mesaj yok
}
```

Kontrat `ConflictingPingPath` ile revert ettiğinde kullanıcı "ConflictingPingPath" gibi teknik bir mesaj görür. Anlamlı açıklama: "Karşı taraf zaten farklı bir yol başlattı — bu akışı kullanamazsınız."

---

### 🟡 EK-ORTA-03 · MIN_ACTIVE_PERIOD (15 Gün) İlan Hata Mesajında Yok

**Dosya:** `App.jsx` → `renderMakerModal` + `listings.js`  

Kontrat: Tier 1'e geçmek için sadece 15 başarılı işlem değil, `firstSuccessfulTradeAt + 15 days` da geçmeli. Listing formu yalnızca:
```javascript
"İtibarınız Tier X için yeterli değil. Efektif tier'ınız: Y"
```
mesajı gösteriyor. Kullanıcı 15 işlemi tamamlamış ama 15 günlük süre dolmamışsa neden Tier 0'da kaldığını anlayamıyor.

---

### 🟡 EK-ORTA-04 · Tier 1 Cooldown UI Mesajlarında Tier 0 Olarak Geçiyor

**Dosya:** `App.jsx`  
**Kontrat:** `TIER0_TRADE_COOLDOWN = 4 hours` ve `TIER1_TRADE_COOLDOWN = 4 hours` her ikisi de aynı  

```javascript
// App.jsx yorumları:
// "Tier 0 Filtresi", "Tier 0 cooldown"
```

Kontrat Tier 0 VE Tier 1 için 4 saatlik cooldown uyguluyor. UI/mesajlar sadece Tier 0'dan bahsediyor. Tier 1 Taker'lar neden kilitlendiğini anlayamıyor.

---

### 🟡 EK-ORTA-05 · burnExpired Herkese Açık Ama UI Sadece Taraflara Gösteriyor

**Dosya:** `App.jsx` + `ArafEscrow.sol`  
**Kontrat:**
```solidity
function burnExpired(uint256 _tradeId)
    external  // ← msg.sender kısıtlaması YOK
    nonReentrant
    inState(_tradeId, TradeState.CHALLENGED)
{ ... }
```

`burnExpired` herhangi bir adres tarafından çağrılabilir. UI sadece trade room'daki taraflara butonu gösteriyor. Ancak dışarıdan birinin bu fonksiyonu çağırabileceği konusunda kullanıcıya uyarı yok. 10 gün sonunda fonların üçüncü bir kişi tarafından "burn" edileceği daha açık gösterilmeli.

---

### 🟡 EK-ORTA-06 · handleChallenge'da pingTakerForChallenge İçin Timing Guard Yok

**Dosya:** `App.jsx` → `handleChallenge`  

```javascript
const handleChallenge = async () => {
  if (!challengePingedAt) {
    // ← paidAt + 24h geçti mi kontrolü YOK
    await pingTakerForChallenge(BigInt(activeTrade.onchainId));
    // Kontrat 24h kontrolü yapar → PingCooldownNotElapsed revert
```

Butonu 24h geçmeden bastığında generic revert hatası görür.

---

### 🟡 EK-ORTA-07 · Trade Room'a SIWE Yenileme Sonrası Geri Dönüş Mekanizması Yok

**Dosya:** `App.jsx`  

Kullanıcı SIWE ile giriş yaptı → 15 dakika sonra JWT doldu → otomatik refresh çalıştı → başarısız → çıkış yapıldı. Kullanıcı tekrar imzaladı. Ancak `activeTrade`, `tradeState`, `userRole` state'leri sıfırlandı. Kullanıcı kendi aktif işleminin nerede olduğunu bulmak için profil → aktif işlemler → odaya git akışını elle yapması gerekiyor.

**Öneri:** Giriş sonrasında `activeEscrows` fetch edilince eğer tek aktif işlem varsa otomatik trade room'a yönlendirme.

---

### 🟡 EK-ORTA-08 · Dust Limit Hata Mesajı Miktarı Göstermiyor

**Dosya:** `App.jsx`  
**Kontrat:** `DUST_LIMIT = 0.001 ether`  

```jsx
!isFunded ? <><span>⚠️</span> {lang === 'TR' ? 'Bakiye Yetersiz' : 'Low Balance'}</> : ...
```

Kullanıcı neye ihtiyacı olduğunu bilmiyor. "En az 0.001 ETH (~X TL) gerekli" gösterilmeli.

---

### 🟡 EK-ORTA-09 · handleRelease Sonrası setCurrentView Öncesi activeTrade Temizlenmiyor

**Dosya:** `App.jsx` → `handleRelease`, `handleAutoRelease`  

```javascript
await releaseFunds(BigInt(activeTrade.onchainId));
setTradeState('RESOLVED');
setCurrentView('home');
// ← setActiveTrade(null) YOK
```

`activeTrade` state'inde hâlâ eski veriler var. 15 saniyelik polling tekrar başladığında bu işlem artık `status: RESOLVED` dönebilir ama `activeTrade` null olmadığı için eski veri etkileşim hataları yaratabilir. Minor ama temizlik için:
```javascript
setActiveTrade(null);
setTradeState(null);
```

---

## KONTRAT × UI AKIŞ UYUMSUZLUK TABLOSU

Aşağıdaki tablo kontrat fonksiyonlarının UI'daki karşılığını gösteriyor:

| Kontrat Fonksiyonu | Gereksinim | UI Karşılığı | Durum |
|---|---|---|---|
| `registerWallet()` | — | `handleRegisterWallet` | ✅ Var |
| `createEscrow()` | Tier ≤ effectiveTier | `handleCreateEscrow` | ✅ Var |
| `cancelOpenEscrow()` | OPEN state | `handleDeleteOrder` | ⚠️ State kontrolü eksik |
| `lockEscrow()` | 7 gün yaş, 0.001 ETH, cooldown | `handleStartTrade` | ⚠️ Decimal ve fiat hatası |
| `reportPayment()` | LOCKED state | `handleReportPayment` | ✅ Var |
| `releaseFunds()` | PAID veya CHALLENGED | `handleRelease` | ✅ Var |
| `pingTakerForChallenge()` | PAID state, paidAt+24h | `handleChallenge` → 1. dal | 🔴 **Butonu yok** |
| `challengeTrade()` | PAID, pinged, pingAt+24h | `handleChallenge` → 2. dal | 🔴 **Butonu yok** |
| `pingMaker()` | PAID, paidAt+48h, taker | `handlePingMaker` | ✅ Var |
| `autoRelease()` | PAID, pinged, pingedAt+24h | `handleAutoRelease` | ✅ Var |
| `proposeOrApproveCancel()` | LOCKED/PAID/CHALLENGED | `handleProposeCancel` | ✅ Var |
| `burnExpired()` | CHALLENGED, +240h, HERKES | Trade room burn butonu | ⚠️ "Herkes" uyarısı yok |
| `decayReputation()` | bannedUntil+180d | Profil "Sicilimi Temizle" | ✅ Var (ama P-05 nedeniyle çalışmıyor) |
| `getCooldownRemaining()` | — | **KULLANILMIYOR** | ❌ Eksik |
| `antiSybilCheck()` | — | sybilStatus state | ⚠️ Cooldown süresi gösterilmiyor |
| `getFirstSuccessfulTradeAt()` | — | Profil sayfası | ✅ Var |

---

## DÜZELTME ÖNCELİKLERİ (Bu Ek İçin)

### Testnet'ten Önce Kesinlikle:

1. **EK-KRİT-01** — Maker challenge/ping butonlarını render et  
   *Olmadan: Maker hiçbir zaman itiraz açamıyor*

2. **EK-KRİT-02** — `tradeState` yerel state'ini polling'e bağla  
   *Olmadan: UI'da yanlış durum gösteriliyor*

3. **EK-YÜKS-01** — `paidAt + 24h` timer ekle (pingTakerForChallenge için)  
4. **EK-YÜKS-04** — `takerName` fetch koşulunu PAID/CHALLENGED'ı da kapsayacak şekilde genişlet  
5. **EK-YÜKS-05** — `handleCreateEscrow`'da decimal hardcoding düzelt  

### Testnet Sürecinde:

6. **EK-YÜKS-03** — `getCooldownRemaining()` kullan, süreyi göster  
7. **EK-YÜKS-06** — `chargebackAccepted` backend'den okuyarak yükle  
8. **EK-ORTA-02** — `ConflictingPingPath` için özel hata mesajı  
9. **EK-ORTA-05** — `burnExpired` herkese açık uyarısı ekle  
10. **EK-ORTA-08** — Dust limit miktarını hata mesajına ekle  

---

## GÜNCELLENEN GENEL SKOR

| Katman | Önceki Skor | Güncel Skor | Not |
|--------|------------|-------------|-----|
| Smart Contract | 8.5/10 | 8.5/10 | Değişmedi |
| Backend Güvenliği | 5.5/10 | 5.5/10 | Değişmedi |
| Frontend (UI Akışı) | 5.0/10 | **4.0/10** | EK-KRİT-01 kritik UX gap |
| Altyapı | 4.5/10 | 4.5/10 | Değişmedi |
| Kontrat × UI Uyumu | — | **5.0/10** | Yeni değerlendirme |
| **Genel** | **5.9/10** | **5.6/10** | |

---

*Bu ek, `ARAF_SECURITY_AUDIT_v2.md` ile birlikte kullanılmalıdır.*  
*Toplam bulgular: 73 (önceki) + 18 (bu ek) = **91 bulgu***  
*Mart 2026 — Araf Protocol*
