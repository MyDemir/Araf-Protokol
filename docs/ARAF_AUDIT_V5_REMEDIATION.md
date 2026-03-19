# Araf Protocol — Güvenlik & Mimari Denetim Raporu v5
**Testnet Öncesi Düzeltme Rehberi**

> **Oturum Tarihi:** Mart 2026  
> **Kapsam:** ArafEscrow.sol · Node.js/Express Backend · React Frontend  
> **Felsefe Kırılım Noktası:** "Kontrat her zaman gerçeğin tek kaynağıdır. Backend hiçbir zaman ekonomik parametre hard-code etmez."

---

## İçindekiler

1. [Uygulanan Düzeltmeler](#1-uygulanan-düzeltmeler)
2. [Felsefe Denetimi — Hard-Code İhlalleri](#2-felsefe-denetimi--hard-code-i̇hlalleri)
3. [Kalan Açık Maddeler](#3-kalan-açık-maddeler)
4. [Testnet Geçiş Kontrol Listesi](#4-testnet-geçiş-kontrol-listesi)
5. [Asistan Promptları](#5-asistan-promptları)

---

## 1. Uygulanan Düzeltmeler

### 🔴 Kritik

#### K-01 · `frontend/src/App.jsx` — `handleCreateEscrow` Syntax Hatası
- **Problem:** `body: JSON.stringify({...});` — object literal içinde noktalı virgül geçersiz JS sözdizimidir.
- **Etki:** `npm run build` tamamen başarısız, uygulama derlenemez.
- **Durum:** ✅ Düzeltildi — noktalı virgül kaldırıldı, virgül ile düzeltildi.

#### K-02 · `frontend/src/components/PIIDisplay.jsx` — `<a` Etiketi Eksik
- **Problem:** Telegram link bloğunda `<a` açılış etiketi kayıp, `href={...}` açıkta kalıyordu.
- **Etki:** PIIDisplay derlenemiyor, tüm Taker IBAN/Telegram akışı kırık.
- **Durum:** ✅ Düzeltildi — `<a` etiketi restore edildi.

#### K-03 · `frontend/src/App.jsx` — `handleMint` Env Var İsmi Yanlış
- **Problem:** `import.meta.env['VITE_MOCK_USDT_ADDRESS']` arıyor, `.env`'de `VITE_USDT_ADDRESS` var.
- **Etki:** Testnet'te kullanıcılar test token alamaz, faucet tamamen çalışmaz.
- **Durum:** ✅ Düzeltildi — `SUPPORTED_TOKEN_ADDRESSES` map'i üzerinden okunuyor.

---

### 🟠 Yüksek Öncelikli

#### Y-01 · `frontend/src/App.jsx` — `lockEscrow` Sonrası Race Condition
- **Problem:** `lockEscrow()` başarısından hemen sonra `/api/trades/my` çağrılıyordu. Event listener EscrowLocked'ı henüz işlememiş olabilir → `matchedTrade` null → PIIDisplay 404.
- **Durum:** ✅ Düzeltildi — `/api/trades/by-escrow/:onchainId` endpoint'i + 6 deneme / 2sn aralık retry loop eklendi.

#### Y-02 · `frontend/vercel.json` — Placeholder URL
- **Problem:** `"destination": "https://<SENIN_FLY_IO_BACKEND_URL>.fly.dev/api/$1"` — deploy'a giden placeholder.
- **Etki:** Vercel deploy'da hiçbir API isteği çalışmaz.
- **Durum:** ✅ Düzeltildi — gerçek URL şeması yerleştirildi. `araf-protocol-backend` adı `fly.toml`'daki `app =` alanıyla eşleştirilmeli.

#### Y-03 · `docs/ARCHITECTURE_EN.md` + `docs/ARCHITECTURE_TR.md` — CANCELED Durumu Hatalı
- **Problem:** Her iki dokümanda "Full refund. No fees." yazıyor.
- **Gerçek:** LOCKED → CANCELED: ücret yok. PAID/CHALLENGED → CANCELED: %0.2 protokol ücreti.
- **Durum:** ✅ Düzeltildi — her iki dildeki tablo satırı güncellendi.

#### Y-04 · `backend/scripts/services/protocolConfig.js` — Zero Address'te Server Başlamıyor
- **Problem:** `ARAF_ESCROW_ADDRESS` boş/sıfır ise `loadProtocolConfig()` exception fırlatarak server başlatmayı durduruyordu.
- **İlk Fix (geri alındı):** Hardcoded varsayılan bond değerleri ile fallback — **felsefe ihlali.**
- **Son Fix (felsefeye sadık):** `protocolConfig = null` döner, `getConfig()` `CONFIG_UNAVAILABLE` kodu ile fırlatır, bağımlı endpoint'ler 503 döner. Hard-code yok.
- **Durum:** ✅ Düzeltildi.

---

### 🟡 Orta Öncelikli

#### O-02 · `protocolConfig.js` — Redis Cache TTL Sabit 7 Gün
- **Problem:** Testnet'te parametre değişikliği 7 gün boyunca Redis'ten okunur, kontrat güncellemeleri yansımaz.
- **Durum:** ✅ Düzeltildi — `NODE_ENV === 'production'` → 7 gün, diğer → 1 saat.

#### O-04 · `frontend/src/App.jsx` — `handleChallenge` Sonrası UI Gecikmesi
- **Problem:** `pingTakerForChallenge` başarısından sonra 15 saniyelik polling'e kadar `canChallenge = true` görünüyordu → kullanıcı challenge butonuna tekrar basıyor → kontrat `ResponseWindowActive` ile revert.
- **Durum:** ✅ Düzeltildi — ping başarısından hemen sonra `fetchMyTrades()` çağrısı eklendi.

---

## 2. Felsefe Denetimi — Hard-Code İhlalleri

> **"Kontrat her zaman gerçeğin tek kaynağıdır."**

Denetim sırasında App.jsx içinde **4 felsefe ihlali** tespit edildi. Bunlar `protocolConfig.js`'teki `getConfig()` mekanizması tamamlanmadan önce düzeltilmemiş durumda.

### ⚠️ İhlal 1 — `handleStartTrade` içinde `TAKER_BOND_BPS`

```js
// MEVCUT (İHLAL — App.jsx ~satır 340):
const TAKER_BOND_BPS = { 0: 0n, 1: 1000n, 2: 800n, 3: 500n, 4: 200n };
const takerBondBps = TAKER_BOND_BPS[tier] ?? 1000n;
```

Kontrat bu değerleri değiştirirse frontend yanlış allowance hesaplar → tx başarısız.

### ⚠️ İhlal 2 — `handleCreateEscrow` içinde `MAKER_BOND_BPS`

```js
// MEVCUT (İHLAL — App.jsx ~satır 480):
const MAKER_BOND_BPS = { 0: 0n, 1: 800n, 2: 600n, 3: 500n, 4: 200n };
const bondBps = MAKER_BOND_BPS[makerTier] ?? 0n;
```

### ⚠️ İhlal 3 — `renderMakerModal` içinde `MAKER_BOND_PCT`

```js
// MEVCUT (İHLAL — renderMakerModal başı):
const MAKER_BOND_PCT = { 0: 0, 1: 8, 2: 6, 3: 5, 4: 2 };
const bondPct = MAKER_BOND_PCT[makerTier] ?? 0;
```

Modal'daki "Toplam Kilitlenecek" hesabı yanlış gösterir.

### ⚠️ İhlal 4 — `renderMakerModal` içinde Tier Cap Limitleri

```js
// MEVCUT (İHLAL):
else if (makerTier === 0 && cryptoAmtNum > 150)  ...
else if (makerTier === 1 && cryptoAmtNum > 1500) ...
else if (makerTier === 2 && cryptoAmtNum > 7500) ...
```

Bu limitler kontrat sabitinden (`TIER_MAX_AMOUNTS`) okunmalı. **Önce kontrat'ta bu sabitler var mı kontrol edilmeli** — varsa `/api/protocol/config` üzerinden alınmalı, yoksa kontrata eklenmeli ya da backend validasyonuna taşınmalı (frontend'den kaldırılmalı).

---

### Çözüm Mimarisi

Yukarıdaki 4 ihlalin tamamı tek bir mimariyle çözülür:

```
ArafEscrow.sol  ──(on-chain okuma)──▶  protocolConfig.js
                                             │
                                    GET /api/protocol/config
                                             │
                                    onchainBondMap state (App.jsx)
                                             │
                              handleStartTrade · handleCreateEscrow · renderMakerModal
```

**Backend'e eklenecek route** (`backend/routes/protocol.js` veya mevcut bir route):

```js
router.get('/config', async (req, res) => {
  try {
    const config = getConfig();
    return res.json({ bondMap: config.bondMap });
  } catch (err) {
    if (err.code === 'CONFIG_UNAVAILABLE')
      return res.status(503).json({ error: err.message });
    throw err;
  }
});
```

**App.jsx'e eklenecek state + effect** (diğer state'lerin yanına):

```js
const [onchainBondMap, setOnchainBondMap] = useState(null);

useEffect(() => {
  fetch(`${API_URL}/api/protocol/config`, { credentials: 'include' })
    .then(r => r.json())
    .then(data => { if (data.bondMap) setOnchainBondMap(data.bondMap); })
    .catch(err => console.error('[ProtocolConfig] fetch failed:', err));
}, []);
```

---

## 3. Kalan Açık Maddeler

### 🔴 Kritik (Testnet'i Bloklar)

| Kod | Dosya | Açıklama |
|-----|-------|----------|
| F-01 | `App.jsx` | `TAKER_BOND_BPS` hard-code → kontrat'tan oku |
| F-02 | `App.jsx` | `MAKER_BOND_BPS` hard-code → kontrat'tan oku |
| F-03 | `App.jsx` | `MAKER_BOND_PCT` hard-code → kontrat'tan oku |
| F-04 | `App.jsx` | Tier cap limitleri hard-code → karar: kontrata ekle mi, backend'e taşı mı? |
| F-05 | `backend/routes/` | `/api/protocol/config` endpoint'i yok — App.jsx onu bekliyor |

### 🟠 Yüksek (Testnet'te İşlevsel Sorun)

| Kod | Dosya | Açıklama |
|-----|-------|----------|
| G-04 | `docs/` | ARCHITECTURE_EN.md + TR güncellendi ama `G-04` kapsamındaki test dosyası (`tests/cancel.test.js`) hâlâ eski akışa göre |
| G-10 | `frontend/` | `/trades/my` yerine `/by-escrow/:onchainId` endpoint'i App.jsx'e entegre edildi ama backend'de bu endpoint var mı doğrulanmadı |
| G-14 | `frontend/src/` | `AppPastUi.jsx` silinme durumu doğrulanamadı — dosya hâlâ build'e giriyorsa ölü kod |

### 🟡 Orta (Sprint Sonrası)

| Kod | Dosya | Açıklama |
|-----|-------|----------|
| O-01 | `contracts/` | `MIN_ACTIVE_PERIOD`: Kontrat 15 gün, dokümantasyon 30 gün — karar verilmeli |
| O-03 | `backend/` | DLQ `dlqProcessor.js` — `lTrim` yönü tutarsız, manuel test gerekiyor |
| O-05 | `contracts/src/ArafEscrow.sol` | `ipfsReceiptHash` max uzunluk kontrolü yok — öneri: `bytes(_ipfsHash).length > 512` |

### 🔵 Düşük

| Kod | Dosya | Açıklama |
|-----|-------|----------|
| D-01 | `App.jsx` | `handleMint` içinde `address` variable shadowing (cüzdan adresi vs token adresi) |
| D-02 | `backend/` | `/health` endpoint'inde rate limit yok |
| D-03 | `docs/ux.md` | `auth.js` "Pazar yeri CRUD" olarak yanlış belgelenmiş, `listings.js` olmalı |
| D-04 | `backend/` | `feedback.js` middleware sırası — `feedbackLimiter` `requireAuth`'tan sonra gelmeli |

---

## 4. Testnet Geçiş Kontrol Listesi

```
── DERLEME ──────────────────────────────────────────────────────────
[ ] cd frontend && npm run build          → 0 error, 0 warning
[ ] cd contracts && npx hardhat test      → tüm testler geçiyor
[ ] cd backend && npm run lint            → 0 error

── KRİTİK FİX DOĞRULAMA ─────────────────────────────────────────────
[ ] F-01/02/03 — onchainBondMap state App.jsx'e eklendi
[ ] F-05       — /api/protocol/config endpoint'i backend'e eklendi
[ ] G-10       — /api/trades/by-escrow/:onchainId backend'de mevcut
[ ] G-14       — AppPastUi.jsx build'de yok (silinmiş)

── ORTAM DEĞİŞKENLERİ ───────────────────────────────────────────────
[ ] .env → ARAF_ESCROW_ADDRESS gerçek testnet adresi
[ ] .env → BASE_RPC_URL Base Sepolia RPC endpoint'i
[ ] .env → VITE_USDT_ADDRESS MockUSDT kontrat adresi
[ ] .env → VITE_USDC_ADDRESS MockUSDC kontrat adresi
[ ] .env → VITE_ESCROW_ADDRESS ArafEscrow testnet adresi
[ ] vercel.json → destination URL Fly.io gerçek app adı

── MANUEL TEST AKIŞLARI ─────────────────────────────────────────────
[ ] Faucet: Test USDT al butonu çalışıyor
[ ] Maker: İlan aç → onay modal'ı bond'u doğru gösteriyor
[ ] Taker: Satın al → IBAN/Telegram görünüyor
[ ] Cancel: LOCKED'da ücret yok, PAID'da %0.2 kesildi
[ ] protocolConfig.js: ARAF_ESCROW_ADDRESS olmadan server 503 döner, çökmez
[ ] DLQ: Manuel tetikle, kuyruk boşalıyor

── DOKÜMANTASYON ────────────────────────────────────────────────────
[ ] O-01 — MIN_ACTIVE_PERIOD (15 gün mü 30 gün mü?) kararı netleşti
[ ] ARCHITECTURE_EN.md + TR CANCELED tablosu güncellendi ✅
```

---

## 5. Asistan Promptları

Aşağıdaki promptların her biri bağımsız bir oturumda kullanılabilir.
Her prompt kendi başına eksiksiz bir görev tanımı içerir.

---

### PROMPT-01 — Felsefe İhlallerini Gider (F-01 · F-02 · F-03 · F-05)

```
Araf Protocol projesindeki felsefe ihlallerini gidereceksin.

FELSEFE: "Kontrat her zaman gerçeğin tek kaynağıdır.
Backend veya frontend hiçbir zaman ekonomik parametre (bond, tier limit) hard-code etmez."

YAPILACAKLAR:

1. backend/routes/ dizininde uygun bir route dosyasına aşağıdaki endpoint'i ekle:

   GET /api/protocol/config
   - getConfig() çağırır
   - { bondMap } döner
   - getConfig() CONFIG_UNAVAILABLE fırlatırsa 503 döner

2. frontend/src/App.jsx dosyasında:

   a) State olarak ekle (diğer useState'lerin yanına):
      const [onchainBondMap, setOnchainBondMap] = useState(null);

   b) useEffect olarak ekle (diğer effect'lerin yanına):
      API_URL/api/protocol/config'i fetch et,
      data.bondMap varsa setOnchainBondMap(data.bondMap) çağır.

   c) handleStartTrade fonksiyonunu güncelle:
      - onchainBondMap null ise showToast ile hata ver ve return et
      - "const TAKER_BOND_BPS = {...}" satırını SİL
      - takerBondBps hesabını şöyle yaz:
        const takerBondBps = BigInt(onchainBondMap[tier]?.takerBps ?? 0);

   d) handleCreateEscrow fonksiyonunu güncelle:
      - onchainBondMap null ise showToast ile hata ver ve return et
      - "const MAKER_BOND_BPS = {...}" satırını SİL
      - bondBps hesabını şöyle yaz:
        const bondBps = BigInt(onchainBondMap[makerTier]?.makerBps ?? 0);

   e) renderMakerModal fonksiyonu içinde:
      - "const MAKER_BOND_PCT = {...}" satırını SİL
      - "const bondPct = MAKER_BOND_PCT[makerTier] ?? 0;" satırını şununla değiştir:
        const bondPct = onchainBondMap?.[makerTier]?.maker ?? 0;

KONTROL KRİTERİ:
Tüm değişiklikten sonra App.jsx içinde "BOND_BPS", "BOND_PCT" pattern'leriyle
grep yaptığında hiçbir sabit nesne tanımı çıkmamalıdır.
```

---

### PROMPT-02 — Tier Cap Limitlerini Çöz (F-04)

```
Araf Protocol App.jsx dosyasındaki tier cap limitlerini
felsefemize uygun hale getireceğiz.

FELSEFE: Ekonomik limitler frontend'de hard-code edilemez.
Kontrat gerçeğin tek kaynağıdır.

MEVCUT DURUM (renderMakerModal içinde):
  if (makerTier === 0 && cryptoAmtNum > 150)  → hard-code
  if (makerTier === 1 && cryptoAmtNum > 1500) → hard-code
  if (makerTier === 2 && cryptoAmtNum > 7500) → hard-code
  if (makerTier === 3 && cryptoAmtNum > 30000) → hard-code

ÖNCE şunu kontrol et:
  contracts/src/ArafEscrow.sol dosyasında TIER_MAX_AMOUNT,
  MAX_AMOUNT_TIER veya benzeri sabitler var mı?

EĞER VAR:
  1. protocolConfig.js'teki CONFIG_ABI'ye bu sabitler için getter ekle
  2. loadProtocolConfig() içinde bu değerleri oku, tierLimits olarak kaydet
  3. GET /api/protocol/config endpoint'i { bondMap, tierLimits } dönsün
  4. App.jsx'te onchainBondMap yanına onchainTierLimits state'i ekle
  5. renderMakerModal'daki hard-code karşılaştırmaları onchainTierLimits'ten oku

EĞER YOK:
  1. Bu validasyonu frontend'den TAMAMEN kaldır
  2. backend/routes/listings.js içindeki POST /api/listings handler'ına
     tier bazlı miktar validasyonu ekle (backend'de hard-code kabul edilebilir,
     çünkü bu bir UI guard değil API güvenlik katmanıdır — ancak yorum ekle:
     "Bu değerler kontrata eklenince buradan kaldırılacak")
  3. renderMakerModal'a sadece "Max limit toplam değeri aşamaz" kontrolü bırak
```

---

### PROMPT-03 — Backend Endpoint Doğrulaması (G-10)

```
Araf Protocol backend'inde aşağıdaki endpoint'in varlığını doğrula:

  GET /api/trades/by-escrow/:onchainId

Bu endpoint App.jsx handleStartTrade fonksiyonunda
lockEscrow() sonrası trade ID almak için kullanılıyor.

YAPILACAKLAR:
1. backend/routes/ dizinini tara, bu endpoint var mı?
2. VARSA: Response formatı { trade: { _id, onchain_escrow_id, ... } } şeklinde mi?
   Değilse düzelt.
3. YOKSA: trades route dosyasına ekle.
   - onchainId parametresiyle Trade koleksiyonunu sorgula
   - Trade bulunamazsa 404 döner
   - Bulunursa { trade } döner
   - requireAuth middleware kullan

Ayrıca kontrol et: Bu endpoint'te rate limiting var mı?
Yoksa ekle (dakikada 30 istek makul).
```

---

### PROMPT-04 — DLQ Doğrulama (O-03)

```
Araf Protocol backend'inde Dead Letter Queue sistemini doğrula ve onar.

İlgili dosya: backend/scripts/services/dlqProcessor.js
(veya eventListener.js içindeki DLQ bloğu)

KONTROL EDİLECEKLER:
1. lTrim yönü: Redis list DLQ'da öğeler soldan mı sağdan mı ekleniyor?
   lPush ile ekliyorsa lTrim(0, MAX-1) doğrudur.
   rPush ile ekliyorsa lTrim(-(MAX), -1) doğrudur.
   Mevcut kodu kontrol et, tutarsızlık varsa düzelt.

2. DLQ boyutu: Maksimum kaç öğe tutulmalı? Sınır tanımlı mı?

3. Boşaltma testi: Manuel olarak DLQ'ya 3 test öğesi ekle,
   processor'ı tetikle, kuyruk boşaldı mı doğrula.

4. Hata durumu: İşlenemez bir öğe tekrar DLQ'ya mı giriyor?
   Sonsuz döngü riski var mı?

Bulguları raporla, varsa düzelt.
```

---

### PROMPT-05 — MIN_ACTIVE_PERIOD Kararı (O-01)

```
Araf Protocol'de MIN_ACTIVE_PERIOD değeri uyumsuz:
  Kontrat (ArafEscrow.sol): 15 gün
  Dokümantasyon: 30 gün

Bu bir karar noktasıdır. Önce aşağıdakileri kontrol et:

1. ArafEscrow.sol'da MIN_ACTIVE_PERIOD değeri tam olarak nedir?
   (Saniye cinsinden bir uint256 sabit mi?)

2. Bu değer neyi temsil ediyor? İlk başarılı işlemden bu yana
   geçmesi gereken minimum süreyi mi yoksa başka bir şeyi mi?

3. GAME_THEORY.md veya protocol documentation'da bu süreye
   referans var mı?

Sonuç olarak iki seçenek:
  A) 15 gün doğruysa → tüm dokümantasyonu 15 gün olarak güncelle
  B) 30 gün doğruysa → kontrata dokunma, sadece yoruma ekle:
     "TODO: MIN_ACTIVE_PERIOD 30 güne yükseltilecek (v2)"
     ve dokümanları 30 gün olarak güncelle

Seçimi bildir ve ilgili dosyaları güncelle.
```

---

### PROMPT-06 — AppPastUi.jsx Ölü Kod Temizliği (G-14)

```
Araf Protocol frontend'inde AppPastUi.jsx dosyasının durumunu doğrula.

YAPILACAKLAR:
1. frontend/src/ dizininde AppPastUi.jsx var mı?
2. VARSA:
   - Herhangi bir dosyadan import ediliyor mu? (grep ile tara)
   - App.jsx veya main.jsx'te kullanılıyor mu?
   - KULLANILMIYORSA: Dosyayı sil ve bu raporu güncelle: "G-14 ✅ Kapatıldı"
   - KULLANILIYORSA: Nerede kullanıldığını raporla
3. YOKSA: "G-14 ✅ Zaten silinmiş" olarak raporla

Bu temizlik build boyutunu küçültür ve karışıklığı önler.
```

---

### PROMPT-07 — Kontrat İpfsReceiptHash Güvenliği (O-05)

```
Araf Protocol akıllı kontratında ipfsReceiptHash için
max uzunluk kontrolü ekle.

Dosya: contracts/src/ArafEscrow.sol

MEVCUT DURUM:
  reportPayment fonksiyonunda sadece boş string kontrolü var:
  require(bytes(_ipfsHash).length > 0, "EmptyIpfsHash")

YAPILACAK:
  Bu kontrolü şu şekilde güncelle:
  require(bytes(_ipfsHash).length > 0, "EmptyIpfsHash");
  require(bytes(_ipfsHash).length <= 512, "IpfsHashTooLong");

  Veya custom error kullanıyorsan:
  if (bytes(_ipfsHash).length == 0) revert EmptyIpfsHash();
  if (bytes(_ipfsHash).length > 512) revert IpfsHashTooLong();

  "IpfsHashTooLong" custom error'ı da error tanımlarına ekle.

SONRA:
  npx hardhat test çalıştır ve tüm testlerin geçtiğini doğrula.
  Gerekirse reportPayment test dosyasına bu kontrolü test eden
  bir negatif test case ekle.
```

---

*Belge sonu — Araf Protocol Audit v5*
