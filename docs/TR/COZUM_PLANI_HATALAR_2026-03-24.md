# Araf Protokolü — "Hatalar ve Düzeltilmesi Gerekenler" için Çözüm Planı

**Tarih:** 24 Mart 2026  
**Amaç:** `docs/Hatalar ve Düzeltilmesi gerekenler.md` içindeki tekrar eden/dağınık bulguları tek bir uygulanabilir plana dönüştürmek.

---

## 0) Tek Sürüm / Tek Kaynak Kararı (Karışıklığı Bitirme)

"4 farklı sürüm" karışıklığını kapatmak için bu doküman **tek resmi yol haritası (single source of truth)** olarak kabul edilir.

- Resmi plan dosyası: `docs/TR/COZUM_PLANI_HATALAR_2026-03-24.md`
- Durum yönetimi: Bu dosyada yalnızca 3 statü kullanılacak: `OPEN`, `IN_PROGRESS`, `DONE`
- Güncelleme kuralı: Yeni bulgu geldikçe ayrı doküman açmak yerine bu dosyada ilgili P0/P1/P2 maddesi altına işlenecek
- Kapanış kuralı: Her madde için "kanıt" (PR/commit/test çıktısı) olmadan `DONE` işaretlenmeyecek

**Bir sonraki adım (net):** 24 Mart 2026 itibarıyla yalnızca bu dosyadaki P0 maddeleri uygulanacak; P0 tamamlanmadan P1/P2’ye geçilmeyecek.

---

## 1) Hızlı Teşhis (Dokümandan çıkarım)

Dokümandaki ana risk kümeleri:
1. **UI ↔ On-chain state drift** (yanlış buton / yanlış zamanlama).
2. **Decimal ve hesaplama doğruluğu** (fiat→crypto dönüşüm hatası).
3. **Challenge/ping akışında zaman penceresi yönetimi**.
4. **Proxy/rate-limit ve operasyonel dayanıklılık**.
5. **Test ve runbook eksikliği** (mainnet gate için kanıt eksikliği).

---

## 2) Çözüm Stratejisi (Önceliklendirilmiş)

## P0 — Mainnet öncesi zorunlu (bloklayıcı)

### P0-1) Tek Kaynaktan Durum Modeli (State Machine Adapter)
- `App.jsx` içindeki local state + polling state ikiliğini azaltın.
- `deriveUiState(onchainState, timestamps, now)` adlı **tek fonksiyon** ile tüm buton görünürlüğü/disabled mantığını üretin.
- UI hiçbir yerde ham string karşılaştırmasıyla kritik izin vermesin.

**Kabul kriteri:**
- LOCKED/PAID/CHALLENGED/RELEASED/BURNED için snapshot testleri geçiyor.
- Aynı on-chain input, her render’da aynı UI çıktısını üretiyor (deterministik).

### P0-2) Zaman Pencereleri için Guard + Sunum Ayrımı
- `canPing`, `canChallenge`, `canRelease` gibi saf fonksiyonlar oluşturun.
- Button `disabled` ve tooltip/hata mesajı bu fonksiyonların çıktısından beslensin.
- Revert’e güvenmek yerine kullanıcıya önceden net sebep gösterin.

**Kabul kriteri:**
- `paidAt+24h-1s`, `paidAt+24h`, `+24h+1s` sınır testleri.
- Kullanıcı "neden basamıyorum" sorusunun tek satır açıklamasını görüyor.

### P0-3) Decimal ve Tutar Hesabını Merkezi Yardımcıya Taşıma
- `getTokenDecimals()` sonucu cache’lenerek tüm hesaplarda aynı yardımcı kullanılsın.
- `fiatToTokenAmount(maxFiat, rate, decimals)` ve `tokenToFiat(...)` yardımcıları yazın.
- Frontend’de hardcoded `1e6`, `1e18` kullanımını lint kuralı ile yasaklayın (utils hariç).

**Kabul kriteri:**
- 6/8/18 decimal token test matrisi.
- Aynı input için backend/frontend/contract expectation farkı sıfır.

---

## P1 — Yüksek öncelik (GO/NO-GO etkiler)

### P1-1) İşlem Sırasında Polling Backoff
- Tx pending iken ilgili trade için polling’i geçici yavaşlatın (örn. 5s→20s), onaydan sonra eski aralığa dönün.
- Race condition olasılığını ve RPC maliyetini azaltır.

### P1-2) Chargeback ve Kritik UX Bayraklarını Kalıcılaştırma
- `chargebackAccepted` gibi trade-bağımlı bayrakları local state yerine trade payload’dan derive edin.
- Yenileme sonrası davranış aynı kalmalı.

### P1-3) Listing İptalinde Çift Taraflı Senkron
- On-chain cancel başarısı sonrası backend delete çağrısını idempotent yapın.
- Başarısız delete için retry queue veya kısa süreli re-try ekleyin.

---

## P2 — Operasyonel Sertleştirme

### P2-1) Trust Proxy Güvenli Konfig
- `app.set('trust proxy', ...)` değerini deploy topolojisine göre açıkça belirleyin:
  - Tek reverse proxy: `1`
  - Bilinen proxy subnet listesi: fonksiyon bazlı doğrulama
- Blind `true` yerine mimariye göre net kural tercih edin.

### P2-2) Runbook ve Alarm Eşikleri
- RPC throttle, Redis down, DLQ birikmesi için net alarm eşikleri belirleyin.
- "kim, ne zaman, hangi adımı" oynatacak runbook tablosu ekleyin.

---

## 3) Teknik Uygulama Taslağı (Dosya bazında)

- `frontend/src/App.jsx`
  - Saf guard fonksiyonları (`canPing/canChallenge/canRelease`) ve merkezi `deriveUiState` kullanımı.
- `frontend/src/hooks/useArafContract.js`
  - `getTokenDecimals`, `getCooldownRemaining` cache + hata fallback stratejisi.
- `frontend/src/utils/amounts.js` (yeni)
  - Decimal-safe dönüşüm fonksiyonları (bigint tabanlı).
- `backend/scripts/app.js`
  - trust proxy değerinin ortam-topoloji uyumlu explicit ayarlanması.
- `contracts/test/*.test.js`
  - challenge/ping boundary testleri (özellikle +24h sınırları).

---

## 4) 7 Günlük Sprint Planı

1. **Gün 1-2:** P0-1 & P0-2 (state + time guards), birim testler.
2. **Gün 3:** P0-3 decimal helper konsolidasyonu + test matrisi.
3. **Gün 4:** P1-1 polling backoff + P1-2 kalıcılık.
4. **Gün 5:** P1-3 listing idempotency.
5. **Gün 6:** P2-1 proxy hardening + güvenlik doğrulaması.
6. **Gün 7:** E2E smoke + runbook + GO/NO-GO toplantısı.

---

## 5) Mainnet GO Kriterleri (Öneri)

- Challenge/ping/release akışında sınır-zaman testleri yeşil.
- Decimal test matrisi (6/8/18) yeşil.
- UI state snapshot/regresyon testleri yeşil.
- Proxy + rate-limit entegrasyon testi yeşil.
- 24 saatlik testnet soak’ta kritik hata yok.

---

## 6) Kısa Sonuç

Dokümandaki bulguların büyük kısmı **tek bir kök probleme** işaret ediyor: UI’nin on-chain state machine’i tam ve deterministik temsil etmemesi. Çözüm, yeni özellik eklemekten çok; state/timing/amount mantığını merkezileştirip testlenebilir hale getirmektir.

---

## 7) `BackLog.md` İncelemesi Sonrası Doğrulanan **Çözülmemiş** Maddeler

Aşağıdaki kalemler `docs/BackLog.md` ile kod tabanı karşılaştırılarak **halen açık** olarak işaretlendi:

1. **trust proxy ortam bağımlı (prod-only)**
   - `backend/scripts/app.js` içinde `app.set("trust proxy", 1)` sadece production koşulunda çalışıyor.
   - Geliştirme/staging arkasında gerçek IP kaybı ve rate-limit testlerinde tutarsızlık riski sürüyor.

2. **Refresh akışında cüzdan adresi istemciden gönderiliyor**
   - `authenticatedFetch` yenileme çağrısında hâlâ `body: { wallet: address }` gönderiyor.
   - Backend tarafında wallet/token eşleşmesi korunmuş olsa da, istemciye bağlı bu veri taşınması gereksiz saldırı yüzeyi bırakıyor.

3. **Polling, write işlemleri sırasında durmuyor (race riski)**
   - Trade room açıkken `fetchMyTrades` 15 saniyede bir sürekli çalışıyor.
   - Kontrat yazma işlemi esnasında polling pause/backoff yok.

4. **Taker işlem tutarı hesabında hardcoded `1e6` devam ediyor**
   - `handleStartTrade` içinde `cryptoAmtRaw = ... * 1e6` ile hesaplama yapılıyor.
   - Token decimal bağımsızlığı eksik, multi-token genişlemesinde finansal tutarsızlık üretebilir.

5. **Maker escrow hesabında hardcoded decimal (`6`) devam ediyor**
   - `handleCreateEscrow` içinde `const decimals = BigInt(6)` kalmış.
   - Dinamik `decimals()` okuma ve merkezi amount helper’a taşınma tamamlanmamış.

6. **On-chain cancel sonrası backend listing delete senkronu yok**
   - `handleDeleteOrder` yalnızca on-chain `cancelOpenEscrow` çağırıp local `setOrders` ile UI güncelliyor.
   - Backend’de listing silme API senkronu olmadığı için “hayalet ilan” riski sürüyor.

7. **Cooldown kalan süre UI’da gösterilmiyor**
   - Market butonunda sadece "Cooldown Active" etiketi var; kalan dakika/saniye bilgisi yok.
   - Kullanıcı revert maliyetinden kaçınmak için yeterli yönlendirmeyi alamıyor.

8. **Protocol fee UI’da sabit %0.1 hesaplanıyor (`* 0.001`)**
   - Trade room’da ücret, kontrattan dinamik çekilmek yerine sabit formülle hesaplanıyor.
   - Kontrat parametresi değişirse UI/on-chain fee drift oluşur.

9. **Faucet UI ana market akışında koşulsuz erişilebilir**
   - `handleMint` akışı aktif; mainnet koşuluna göre UI seviyesinde kapatma/feature flag görünmüyor.
   - Üretimde yanlış kullanım ve güven zedelenmesi riski devam ediyor.

10. **Client-error log endpoint’i auth’suz (rate-limit var ama risk tamamen kapanmış değil)**
    - `/api/logs/client-error` endpoint’i kimlik doğrulama olmadan erişilebilir.
    - Mevcut sınırlamalar faydalı ancak internetten doğrudan spam denemelerine açık yüzey hâlâ mevcut.

11. **Bazı finansal/veri alanlarında `Number(...)` dönüşümleri devam ediyor**
    - Frontend ve backend’in çeşitli noktalarında `Number(...)` castleri yoğun.
    - Büyük miktarlarda veya 18-decimal token senaryolarında precision kaybı ihtimali tamamen bitmiş değil.

12. **DB-first listing pre-creation paterni korunuyor**
    - `handleCreateEscrow` önce `/api/listings` POST, sonra on-chain `createEscrow` çağırıyor.
    - Cüzdan onayı reddi veya tx fail durumunda orphan listing birikme riski sürüyor.

---

## 8) Bu Yeni Bulgular için Ek Aksiyonlar

### P0 (hemen)
- `handleStartTrade` ve `handleCreateEscrow` hesaplarını **tek bigint yardımcı katmanına** taşı; hardcoded decimal kullanımını kaldır.
- `handleDeleteOrder` içinde on-chain başarı sonrası backend delete çağrısını idempotent olarak zorunlu hale getir.
- Polling’e `isContractLoading` tabanlı pause/backoff ekle.

### P1
- Refresh çağrısında istemciden wallet gönderimini kaldır; backend wallet’ı yalnızca cookie/JWT bağlamından türetsin.
- Cooldown kalan süresini market buton etiketine (dk/sn) geri getir.
- Protocol fee’yi kontrattan/konfig endpoint’inden dinamik çek.

### P2
- `/api/logs/client-error` için opsiyonel signed client token veya WAF kuralı ekle.
- Mainnet’te faucet bileşenini feature flag ile tamamen gizle.
- Numeric saklama/format katmanında `Number` kullanımını azaltıp string/bigint standardına geçir.

