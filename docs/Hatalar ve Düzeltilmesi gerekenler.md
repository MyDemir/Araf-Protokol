# 🛡️ Araf Protocol — Mainnet Hazırlık Güvenlik Raporu (Detaylı)

**Tarih:** 24 Mart 2026  
**Kapsam:** Smart contract entegrasyonu, Frontend akışları, Backend güvenliği, DB/altyapı maliyeti (free plan odaklı)  
**Ana İlke:** **Kod kanundur** — Backend/Frontend hakem olamaz; uyuşmazlık sonucu yalnızca on-chain state ile belirlenmelidir.

---

## 1) Mainnet Hazırlık Kararı

## ❌ Sonuç: ŞU ANDA MAİNNETE HAZIR DEĞİL

### Neden?
- Önceki denetimlerde belirtilen bazı kritik “kontrat × UI” kopuklukları kullanıcı davranışını yanlış yönlendiriyordu.
- Bu turda bir kısmı kapatıldı (aşağıdaki “Bu committe atılan adımlar”).
- Ancak hâlâ tamamlanması gereken ek sertleştirme kalemleri bulunuyor (özellikle işlem izleme, operasyonel gözlemlenebilirlik, aşırı durum testleri).

---

## 2) Bu turda doğrulanan ana risk sınıfları

### A. Protokol Felsefesi / Otorite Sınırı
- **Olması gereken:** UI yalnızca rehberlik eder; karar/onay/fon hareketi kontratta olmalı.
- **Risk:** UI state drift olduğunda kullanıcı yanlış aksiyon alabiliyor.
- **Durum:** trade state senkronizasyonu güçlendirildi.

### B. Finansal Doğruluk
- **Olması gereken:** Miktar hesapları token decimal ve kur ile doğru yapılmalı.
- **Risk:** Fiat/crypto dönüşümünde sapma, yanlış teminat/lock hesabı.
- **Durum:** Taker ve Maker akışlarında token decimals dinamik okuma + dönüşüm düzeltildi.

### C. Uyuşmazlık Akışı (Bleeding Escrow)
- **Olması gereken:** Maker, kontratın iki aşamalı challenge akışını UI’dan tam çalıştırabilmeli.
- **Risk:** Challenge butonu/timer eksikliği nedeniyle fiilen tek taraflı akış.
- **Durum:** PAID ekranına maker challenge/ping UI + zaman guard’ları eklendi.

### D. Anti-Sybil UX ve Yanlış Negatifler
- **Olması gereken:** Cooldown “aktif/pasif” değil, kalan süreyle birlikte gösterilmeli.
- **Risk:** Kullanıcı kontratın neyi beklediğini anlamaz, gereksiz deneme ve gas kaybı olur.
- **Durum:** `getCooldownRemaining` entegre edilerek kalan süre gösterimi eklendi.

### E. Rate-limit ve Edge Proxy
- **Olması gereken:** Gerçek istemci IP’si tutarlı şekilde korunmalı.
- **Risk:** Free plan/load balancer arkasında global DoS benzeri kilitlenme.
- **Durum:** `trust proxy` tüm ortamlarda aktif hale getirildi.

---

## 3) Bu committe atılan düzeltme adımları

1. **Maker challenge akışı PAID ekranında görünür hale getirildi**
   - Ping (paidAt+24h) ve formal challenge (ping+24h) UI butonları eklendi.
   - Erken basmalarda kontrat revert’üne kalmadan kullanıcıya net uyarı veriliyor.

2. **tradeState senkronizasyonu güçlendirildi**
   - Polling ile gelen `updated.status` artık local `tradeState`'e de yansıtılıyor.

3. **Taker isim doğrulama fetch kapsamı genişletildi**
   - Sadece `LOCKED` değil, `PAID` ve `CHALLENGED` aşamalarında da maker için fetch devam ediyor.

4. **Hesaplama güvenliği artırıldı**
   - `handleStartTrade`: Fiat üst limitten kriptoya dönüşüm (`max / rate`) + token decimals dinamik okuma.
   - `handleCreateEscrow`: hardcoded 6 decimals kaldırıldı; token decimals kontrattan okunuyor.

5. **Cooldown süre görünürlüğü artırıldı**
   - `useArafContract` içine `getCooldownRemaining()` eklendi.
   - Market buton etiketinde kalan dakika gösterimi eklendi.

6. **Release sonrası state temizliği**
   - `handleRelease` sonrası `activeTrade` temizleniyor.

7. **Proxy güvenlik uyumu**
   - Backend `trust proxy` yalnızca production değil, her ortamda aktif.

---

## 4) DB / Altyapı Maliyeti (Free Plan) için önerilen optimizasyonlar

### Hızlı kazanımlar (1-3 gün)
- Polling yoğunluğunu aktif trade sayısına göre dinamik düşür (15 sn → 30/60 sn fallback).
- DLQ ve event replay için log seviyesini “durum değişimi odaklı” tut; chatty logları azalt.
- PII endpoint ve listing endpoint metriclerini Redis üzerinde kısa TTL sayaçlarla tut (ayrı telemetry servisi yerine).

### Orta vadeli (1-2 hafta)
- Mongo indeksleri: `trades(status, updated_at)`, `trades(onchain_escrow_id)`, `listings(exchange_rate,_id)` doğrulaması.
- Event listener için “yüksek cardinality” log alanlarını normalize et (maliyetli metin log azaltımı).
- Receipt işleme hattında memory yerine streaming/disk-temporary yaklaşımının ölçümü.

### Ana ilkeye uygunluk notu
Bu optimizasyonlar **hakemlik yetkisi üretmez**; yalnızca gözlemlenebilirlik, maliyet ve performans iyileştirmesidir.

---

## 5) Kapanmamış kalemler (sonraki sprint)

- Otomatik regresyon testleri: challenge/ping zaman pencereleri (boundary test).
- Kullanıcı tarafında “network/time drift” senaryoları için ek guard testleri.
- Operasyonel runbook: RPC throttling, Redis kesintisi, DLQ taşması.

---

## 6) Uygulama Planı (proje dosyalarına göre)

### Sprint-1 (hemen)
- `frontend/src/App.jsx`: challenge UI + timer guard + state sync + hesaplama düzeltmeleri.
- `frontend/src/hooks/useArafContract.js`: cooldown remaining okuma.
- `backend/scripts/app.js`: trust proxy ayarı.

### Sprint-2
- `backend/scripts/services/eventListener.js`: replay/idempotency stres testleri.
- `backend/scripts/routes/receipts.js`: kaynak kullanım profili ve sınır iyileştirmeleri.
- `backend/scripts/middleware/rateLimiter.js`: fallback davranışı için gözlem metrikleri.

### Sprint-3 (mainnet öncesi gate)
- E2E test: LOCKED→PAID→(Ping/Challenge/Release/AutoRelease/Burn) tüm yol.
- “No-offchain-arbiter” ilkesine uyum checklisti.

---

## 7) Yönetici Özeti

- Proje mimarisi doğru yönde: hakemlik kontratta.
- Bu turda kritik akış boşluklarının önemli kısmı kapatıldı.
- Buna rağmen mainnet için **henüz final güvenli değil**; bir sprint daha sertleştirme gerekir.


# 🛡️ Araf Protocol — Mainnet Hazırlık Güvenlik Raporu (TR)

**Tarih:** 24 Mart 2026  
**Kapsam:** Smart Contract ↔ Backend ↔ Frontend ↔ Altyapı/Operasyon  
**İlke:** *"Kod kanundur; backend/frontend hakem değildir."*

---

## 1) Yönetici Özeti

### Mainnet Hazırlık Kararı
**Durum: Mainnet'e hazır değil (NO-GO).**

### Neden NO-GO?
1. UI/kontrat akış uyumsuzlukları, bazı itiraz ve zamanlama yollarında kullanıcıyı yanlış aksiyona itebiliyor.
2. Frontend'te hesaplama/decimal kaynaklı finansal doğruluk riski vardı (kritik yol).
3. Anti-Sybil/cooldown görünürlüğü yetersizdi (kullanıcı hata/revert maliyeti artıyordu).
4. Operasyonel tarafta ücretsiz planlara uygun maliyet disiplinine rağmen, bazı gereksiz retry/polling/manuel süreç maliyet doğuruyordu.

---

## 2) Mimari Felsefe Uyum Kontrolü

Hedef felsefe:
- Uyuşmazlık sonucu **on-chain state machine** ile belirlenmeli.
- Backend/frontend sadece taşıyıcı/arayüz olmalı, hakem olmamalı.

Kontrol sonucu:
- Kontrat merkezli çözüm doğru yönde.
- Ancak frontend akış eksikleri (challenge butonu/timer/state sync) fiilen bu felsefeyi zayıflatıyordu.

---

## 3) Kritik Bulgular (Bu turda doğrulanan)

### C-01 — Maker challenge akışı UI'da eksik/eksik zamanlamalı
- **Risk:** Maker itirazı geç başlatır veya hiç başlatamaz; süreç tek yöne kayar.
- **Etkisi:** Ekonomik oyun teorisi pratikte bozulur.

### C-02 — Trade state ayrışması (polling vs local state)
- **Risk:** Ekran bir state, on-chain başka state gösterir.
- **Etkisi:** Yanlış buton, yanlış aksiyon, gereksiz revert/gas.

### C-03 — Fiat→Crypto dönüşüm ve decimal doğruluğu
- **Risk:** Yanlış miktarda kilitleme/teminat hesaplama.
- **Etkisi:** Finansal tutarsızlık ve kullanıcı güven kaybı.

---

## 4) Yüksek/Orta Bulgular

- Cooldown kalan süre gösterilmediği için kullanıcı "neden işlem yapamıyorum" durumunu anlayamıyor.
- Chargeback acknowledgement yalnızca local state olduğunda sayfa yenilemesinde kaybolabiliyor.
- OPEN olmayan ilanda on-chain cancel çağrısı deneyip revert riski.
- `ConflictingPingPath` hata mesajı kullanıcı dilinde açıklanmıyordu.
- `trust proxy` konfigürasyonu ortam bağımlı kaldığında rate-limit davranışı beklenmedik hale gelebiliyor.

---

## 5) Maliyet (Free Plan) Optimizasyon Gözlemleri

### DB/Altyapı maliyetini düşüren pratikler
1. **Revert azaltma = RPC + kullanıcı support maliyeti azalır:**
   - Zaman guard'larını UI'da göstermek.
   - Cooldown süresini net göstermek.
2. **Gereksiz yazma azaltma:**
   - İlan silme senkronu netleştirilerek hayalet kayıtların tekrar işlenmesi engellenir.
3. **Frontend chunk maliyeti:**
   - Build uyarısına göre büyük bundle'lar bölünmeli (kod split).
4. **Polling disiplini:**
   - Kritik yazma anlarında kısa süreli polling pause/backoff uygulanmalı.

---

## 6) Bu çalışmada atılan düzeltme adımları (kodlandı)

1. `useArafContract` parseAbi kırığı giderildi, `getCooldownRemaining` + `getTokenDecimals` eklendi.
2. `trust proxy` tüm ortamlarda aktiflenerek IP doğruluğu sertleştirildi.
3. `App.jsx` içinde:
   - `tradeState` polling ile senkronlandı.
   - Maker challenge/ping butonları PAID ekranına eklendi.
   - `pingTakerForChallenge` için 24 saat guard eklendi.
   - `ConflictingPingPath` için kullanıcı dostu hata mesajı eklendi.
   - `taker-name` fetch kapsamı LOCKED→PAID/CHALLENGED genişletildi.
   - `handleStartTrade` ve `handleCreateEscrow` decimal hesapları dinamik hale getirildi.
   - Cooldown kalan süre UI'da gösterildi.
   - Release/autoRelease sonrası `activeTrade` temizliği eklendi.
   - Listing silmede backend delete çağrısı best-effort eklendi.

---

## 7) Hâlâ yapılması önerilen adımlar (Mainnet öncesi)

### P0 (zorunlu)
- Challenge/ping akışının unit + e2e testleri (özellikle timer sınırları).
- Frontend işlem hesaplamaları için token decimal test matrisi (6/18 decimals).
- "Yanlış state ekranda" regresyon testleri.

### P1
- Polling-write race için transaction-in-flight flag ve pause mekanizması.
- Büyük bundle parçalama (dynamic import) ve performans bütçesi.
- DLQ/Replay için alarm eşikleri (free plan dostu, minimum telemetri).

### P2
- Operasyon runbook: incident response, fail-open/fail-safe karar tablosu.
- Ücretsiz plan limitleri için günlük/haftalık maliyet eşiği dashboard'ı.

---

## 8) Son Söz

Proje doğru felsefede ilerliyor; ancak "mainnet-ready" demek için sadece kontrat güvenliği değil, kullanıcıyı yanlış aksiyondan koruyan frontend/operasyon tutarlılığı da tamamlanmalı. Bu turda kritik boşlukların önemli kısmına doğrudan kod düzeltmesi uygulandı; kalan P0 maddeler testlenmeden GO kararı verilmemeli.

# Araf Protokolü — Çözülmemiş Güvenlik/Bütünlük Bulguları Taraması

**Tarih:** 2026-03-24  
**Kaynak Dokümanlar:**
- `docs/TR/ARCHITECTURE.md`
- `docs/ARAF_SECURITY_AUDIT_ADDENDUM.md`
- `docs/Hatalar ve Düzeltilmesi gerekenler.md`

## 1) Mimari İnceleme Özeti (ARCHITECTURE.md)

Mimari doküman; **hibrit Web2.5** yaklaşımını, kritik state/varlık akışlarının on-chain, PII ve sorgu-performans katmanının off-chain tutulduğu bir model olarak tanımlıyor. Temel güvenlik iddiaları:
- On-chain tarafın uyuşmazlık ve fon hareketinde belirleyici olması,
- Backend'in fon taşıyamayan “zero private key relayer” olması,
- Anti-Sybil ve tier sınırlarının sözleşmede zorunlu tutulması.

Bu iddialar, UI/Backend uygulamasında karşılık bulmadığında “mimari doküman doğru, implementasyon eksik” sınıfında risk oluşuyor.

## 2) Güvenlik Raporlarından Taranıp **Hâlâ Açık** Kalan Bulgular

Aşağıdaki maddeler, kod tabanı taramasında (2026-03-24) hâlâ açık görünen bulgulardır.

### A) Addendum (18 yeni bulgu) içinden açık kalanlar

1. **EK-KRİT-01** — Maker için PAID aşamasında challenge/ping aksiyonu UI’da görünmüyor.  
2. **EK-KRİT-02** — Polling `activeTrade.state` güncellese de `tradeState` senkron güncellenmiyor (state ayrışması riski).  
3. **EK-YÜKS-01** — Maker’ın `pingTakerForChallenge` için `paidAt + 24h` ön-zamanlayıcısı yok.  
4. **EK-YÜKS-02** — `challengeCountdown` ve `makerChallengeTimer` aynı zaman için çift countdown çalıştırıyor.  
5. **EK-YÜKS-03** — Kontrattaki `getCooldownRemaining()` UI’da kullanılmıyor; kalan süre gösterilmiyor.  
6. **EK-YÜKS-04** — `taker-name` fetch sadece `LOCKED` durumda; `PAID/CHALLENGED` sonrası boş kalabiliyor.  
7. **EK-YÜKS-05** — `handleCreateEscrow` içinde token decimal hâlâ hardcoded `6`.  
8. **EK-YÜKS-06** — `chargebackAccepted` yalnızca local state; sayfa yenilenince resetleniyor.  
9. **EK-YÜKS-07** — `handleDeleteOrder` için `OPEN` state ön doğrulaması yok.  
10. **EK-ORTA-02** — `ConflictingPingPath` için özel, kullanıcı-dostu hata eşlemesi yok.  
11. **EK-ORTA-06** — `handleChallenge` içinde ping öncesi zaman guard’ı yok (kontrat revert’üne bırakılıyor).  
12. **EK-ORTA-09** — `handleRelease` sonrası `activeTrade` temizlenmiyor (`setActiveTrade(null)` yok).

### B) “Hatalar ve Düzeltilmesi Gerekenler” raporundan açık kalan önemli maddeler

13. **KRİT-04** — `handleStartTrade` hâlâ `order.max * 1e6` ile hesaplıyor; fiat/crypto dönüşümü ve dinamik decimal problemi sürüyor.  
14. **KRİT-05 (kısmi)** — `trust proxy` yalnızca production’da set ediliyor; kod yorumlarıyla çelişki var ve ortam-bağımlı kırılma riski sürüyor.  
15. **ORTA-02** — `approve` sonrası işlem başarısızlığında `approve(0)` sıfırlama/cleanup akışı yok.  
16. **ORTA-04** — Maker ilan iptalinde sadece local state filtreleniyor; backend listing silme/senkron çağrısı görünmüyor.

## 3) Not: Çözülmüş Görünen Örnek Maddeler

Aşağıdaki örnekler kodda giderilmiş görünüyor (tam liste değil):
- Refresh token wallet bağlama doğrulaması (`siwe.js`)  
- SIWE nonce üretiminde yarış durumuna karşı `SET NX` yaklaşımı  
- `PUT /profile` için auth rate limiting  
- `usePII` içinde authenticated fetch + AbortController

## 4) Önceliklendirme (Hızlı Yol Haritası)

**P0 (hemen):** 1,2,13  
**P1 (yüksek):** 3,6,7,8,14  
**P2 (orta):** 4,5,9,10,11,12,15,16

---

## 5) Doğrulama için taranan ana kod alanları

- `frontend/src/App.jsx`
- `frontend/src/hooks/usePII.js`
- `backend/scripts/app.js`
- `backend/scripts/services/siwe.js`
- `backend/scripts/routes/auth.js`
- `backend/scripts/middleware/rateLimiter.js`

# 🛡️ Araf Protokolü — Mainnet Hazırlık & Güvenlik Değerlendirme Raporu

**Tarih:** 24 Mart 2026  
**Kapsam:** `contracts/`, `backend/`, `frontend/`  
**Prensip:** **Kod Kanundur** — Backend/Frontend hakem olamaz; nihai doğrulama ve yaptırım on-chain kalmalıdır.

---

## 1) Yürütücü Özeti

### Mainnet'e hazır mı?
**Kısa cevap: Henüz tam hazır değil.**

Ana nedenler:
1. Kontrat/UI akış senkronizasyonunda kritik boşluklar (özellikle challenge ve state senkronu).
2. Tutar/decimal hesaplamalarında token bağımsızlık eksikleri.
3. Free-plan altyapıda maliyet ve dayanıklılık baskısı yaratacak bazı polling/log/işlem desenleri.

Buna rağmen bu çalışma kapsamında P0/P1 sınıfındaki bazı kritik noktalar doğrudan kodda iyileştirildi (bölüm 5).

---

## 2) Felsefe Uyum Kontrolü (Kod Kanundur)

### Güçlü taraflar
- Uyuşmazlık çözümü zaman tabanlı ve on-chain fonksiyonlarla yürütülüyor.
- Off-chain katman UX/indeksleme amaçlı; fon serbest bırakma/haklı-haksız kararı backend’de değil.

### Riskli alanlar
- UI’da buton/guard eksikliği olunca kullanıcı “hak” fonksiyonuna erişemiyor; bu teknik olarak merkezi hakemlik değil ama **fiilen hak kullanımını engelleyen bir arayüz veto’su** etkisi yaratıyor.
- Bu nedenle “backend/frontend hakem olamaz” ilkesi için sadece kontrat güvenliği yetmez; UI akışının kontrat yollarını eksiksiz expose etmesi gerekir.

---

## 3) Teknik Bulgular (Güncel)

### P0 — Kritik (Mainnet öncesi zorunlu)
1. **State ayrışması:** polling ile güncellenen state ile render state’i senkron değilse kullanıcı yanlış aksiyon görür.
2. **Challenge erişilebilirliği:** Maker’ın PAID akışında ping/challenge yolu açık ve zaman-guard’lı olmalı.
3. **Fiat/crypto/decimal doğruluğu:** hardcoded decimal ve hatalı dönüşüm, ekonomik güvenliği doğrudan bozar.

### P1 — Yüksek
4. **Cooldown görünürlüğü:** kullanıcıya kalan cooldown süresi gösterilmeli.
5. **Chargeback onay kalıcılığı:** trade state yenilenmesinde kaybolmamalı.
6. **Open-state koruması:** open olmayan ilanda cancel girişimi UI seviyesinde de engellenmeli.
7. **Proxy/IP güvenilirliği:** rate limiter doğruluğu için trust proxy ortamdan bağımsız doğru yapılandırılmalı.

### P2 — Orta
8. **Allowance cleanup:** approve sonrası işlem fail olursa izin sıfırlama.
9. **DB senkronu:** on-chain iptal sonrası listing’in DB’den de silinmesi.
10. **Hata mesajı ergonomisi:** ConflictingPingPath gibi teknik revert’ler kullanıcıya anlaşılır çevrilmeli.

---

## 4) Free Plan (Maliyet/Altyapı) Optimizasyon Önerileri

1. **Polling bütçesi:** Trade room polling’i işlemde olmayan ekranlarda durmalı; aktif işlemde adaptif aralık (örn. 15s → 30s) kullanılmalı.
2. **Log maliyeti:** client-error endpoint’i için agresif örnekleme ve boyut sınırı.
3. **DLQ/Replay maliyeti:** tekrar işleme idempotency anahtarı zorunlu olmalı.
4. **PII erişimi:** token tabanlı kısa ömür + cache yok yaklaşımı sürsün; ancak gereksiz tekrar fetch’ler debounce edilmelidir.
5. **Statik zincir okumaları:** sık okunan view fonksiyonları (cooldown vb.) tek çağrıda toplanmalı.

---

## 5) Bu Çalışmada Kodda Uygulanan İyileştirmeler

### Frontend
- `tradeState` polling senkronu eklendi.
- Maker için PAID ekranına ping/challenge aksiyonları ve zaman bazlı guard eklendi.
- `taker-name` fetch kapsamı `LOCKED` dışına (`PAID/CHALLENGED`) genişletildi.
- `handleStartTrade` ve `handleCreateEscrow` decimal hesabı token’dan dinamik okunacak şekilde düzeltildi.
- Cooldown kalan süre UI’da gösterilmeye başlandı.
- `ConflictingPingPath` için kullanıcı-dostu hata mesajı eklendi.
- `release/autoRelease` sonrası stale `activeTrade` temizliği eklendi.
- `cancelOpenEscrow` öncesi OPEN state kontrolü ve on-chain iptal sonrası backend listing delete çağrısı eklendi.
- İşlem fail durumunda allowance cleanup (`approve(...,0)`) eklendi.
- `chargebackAccepted` aktif trade verisinden geri yüklenir hale getirildi.

### Hook/Backend
- `useArafContract` içine `getCooldownRemaining` ve `getTokenDecimals` fonksiyonları eklendi.
- `backend/scripts/app.js` içinde `trust proxy` koşulsuz aktif edildi.

---

## 6) Açık Kalanlar (Bir Sonraki Sprint)

1. Frontend polling’de adaptif strateji (maliyet düşürme).
2. Client log endpoint’te örnekleme + rate limit sıkılaştırma.
3. Event replay idempotency anahtarlarının kontrat event hash’i ile standardize edilmesi.
4. Mainnet runbook: incident response, DLQ kurtarma, RPC failover prosedürü.

---

## 7) Mainnet Gate (Önerilen Çıkış Kriteri)

Mainnet’e çıkış için aşağıdaki kapılar geçilmeden deploy önerilmez:
- ✅ Kontrat/UI akış parity testleri (LOCKED→PAID→CHALLENGED→RESOLVED/BURNED)
- ✅ Decimal/fiat dönüşüm testleri (USDT 6, USDC 6, gelecekte 18-decimal token senaryosu)
- ✅ Rate-limit ve trust-proxy entegrasyon testi
- ✅ DB/on-chain senkron testleri (listing cancel/delete, replay idempotency)
- ✅ Free-plan yük testi (CPU/RAM/Redis kesintisi altında fail-open davranışı)

---

## 8) Son Değerlendirme

- **Bugünkü durum:** Mainnet için risk seviyesi **Orta-Yüksek**.
- **Uygulanan düzeltmeler sonrası:** Risk seviyesi **Orta** seviyeye indi.
- **Öneri:** Bir sprint daha “güvenlik + maliyet stabilizasyonu” çalışması sonrası testnet soak, ardından kontrollü mainnet açılışı.

# Araf Protokolü — Çözülmemiş Güvenlik/Bütünlük Bulguları Taraması

**Tarih:** 2026-03-24  
**Kaynak Dokümanlar:**
- `docs/TR/ARCHITECTURE.md`
- `docs/ARAF_SECURITY_AUDIT_ADDENDUM.md`
- `docs/Hatalar ve Düzeltilmesi gerekenler.md`

## 1) Mimari İnceleme Özeti (ARCHITECTURE.md)

Mimari doküman; **hibrit Web2.5** yaklaşımını, kritik state/varlık akışlarının on-chain, PII ve sorgu-performans katmanının off-chain tutulduğu bir model olarak tanımlıyor. Temel güvenlik iddiaları:
- On-chain tarafın uyuşmazlık ve fon hareketinde belirleyici olması,
- Backend'in fon taşıyamayan “zero private key relayer” olması,
- Anti-Sybil ve tier sınırlarının sözleşmede zorunlu tutulması.

Bu iddialar, UI/Backend uygulamasında karşılık bulmadığında “mimari doküman doğru, implementasyon eksik” sınıfında risk oluşuyor.

## 2) Güvenlik Raporlarından Taranıp **Hâlâ Açık** Kalan Bulgular

Aşağıdaki maddeler, kod tabanı taramasında (2026-03-24) hâlâ açık görünen bulgulardır.

### A) Addendum (18 yeni bulgu) içinden açık kalanlar

1. **EK-KRİT-01** — Maker için PAID aşamasında challenge/ping aksiyonu UI’da görünmüyor.  
2. **EK-KRİT-02** — Polling `activeTrade.state` güncellese de `tradeState` senkron güncellenmiyor (state ayrışması riski).  
3. **EK-YÜKS-01** — Maker’ın `pingTakerForChallenge` için `paidAt + 24h` ön-zamanlayıcısı yok.  
4. **EK-YÜKS-02** — `challengeCountdown` ve `makerChallengeTimer` aynı zaman için çift countdown çalıştırıyor.  
5. **EK-YÜKS-03** — Kontrattaki `getCooldownRemaining()` UI’da kullanılmıyor; kalan süre gösterilmiyor.  
6. **EK-YÜKS-04** — `taker-name` fetch sadece `LOCKED` durumda; `PAID/CHALLENGED` sonrası boş kalabiliyor.  
7. **EK-YÜKS-05** — `handleCreateEscrow` içinde token decimal hâlâ hardcoded `6`.  
8. **EK-YÜKS-06** — `chargebackAccepted` yalnızca local state; sayfa yenilenince resetleniyor.  
9. **EK-YÜKS-07** — `handleDeleteOrder` için `OPEN` state ön doğrulaması yok.  
10. **EK-ORTA-02** — `ConflictingPingPath` için özel, kullanıcı-dostu hata eşlemesi yok.  
11. **EK-ORTA-06** — `handleChallenge` içinde ping öncesi zaman guard’ı yok (kontrat revert’üne bırakılıyor).  
12. **EK-ORTA-09** — `handleRelease` sonrası `activeTrade` temizlenmiyor (`setActiveTrade(null)` yok).

### B) “Hatalar ve Düzeltilmesi Gerekenler” raporundan açık kalan önemli maddeler

13. **KRİT-04** — `handleStartTrade` hâlâ `order.max * 1e6` ile hesaplıyor; fiat/crypto dönüşümü ve dinamik decimal problemi sürüyor.  
14. **KRİT-05 (kısmi)** — `trust proxy` yalnızca production’da set ediliyor; kod yorumlarıyla çelişki var ve ortam-bağımlı kırılma riski sürüyor.  
15. **ORTA-02** — `approve` sonrası işlem başarısızlığında `approve(0)` sıfırlama/cleanup akışı yok.  
16. **ORTA-04** — Maker ilan iptalinde sadece local state filtreleniyor; backend listing silme/senkron çağrısı görünmüyor.

## 3) Not: Çözülmüş Görünen Örnek Maddeler

Aşağıdaki örnekler kodda giderilmiş görünüyor (tam liste değil):
- Refresh token wallet bağlama doğrulaması (`siwe.js`)  
- SIWE nonce üretiminde yarış durumuna karşı `SET NX` yaklaşımı  
- `PUT /profile` için auth rate limiting  
- `usePII` içinde authenticated fetch + AbortController

## 4) Önceliklendirme (Hızlı Yol Haritası)

**P0 (hemen):** 1,2,13  
**P1 (yüksek):** 3,6,7,8,14  
**P2 (orta):** 4,5,9,10,11,12,15,16

---

## 5) Doğrulama için taranan ana kod alanları

- `frontend/src/App.jsx`
- `frontend/src/hooks/usePII.js`
- `backend/scripts/app.js`
- `backend/scripts/services/siwe.js`
- `backend/scripts/routes/auth.js`
- `backend/scripts/middleware/rateLimiter.js`

# 🛡️ Araf Protocol — Mainnet Hazırlık Güvenlik Raporu (Detaylı)

**Tarih:** 24 Mart 2026  
**Kapsam:** Smart Contract + Backend + Frontend + Operasyonel Altyapı  
**Prensip:** _Kod kanundur_ — Backend/Frontend hakem veya sonuç belirleyici olamaz.

---

## 1) Yönetici Özeti

### Mainnet Hazır mı?

**Kısa cevap: Hayır, henüz tam hazır değil.**

Sözleşme tabanlı uyuşmazlık felsefesi doğru yönde olsa da, UI/Backend katmanında bazı kritik akışlar (özellikle challenge başlatma, state senkronu, miktar/decimal hesapları) kullanıcıyı yanlış eyleme sürükleyebilecek durumdaydı. Bu raporla birlikte P0/P1 seviyesinde ilk düzeltmeler atıldı.

### Bu turda atılan somut adımlar

- Maker challenge akışı PAID ekranında görünür/işler hale getirildi.
- Polling sırasında `tradeState` senkron eksikliği giderildi.
- Fiat/crypto dönüşüm ve token decimal hesapları dinamikleştirildi.
- Cooldown kalan süresi on-chain `getCooldownRemaining` ile UI’da gösterilmeye başlandı.
- Listing iptalinde DB senkron silme çağrısı eklendi.
- `trust proxy` tüm ortamlarda aktif edilerek IP tabanlı kontrol tutarlılığı artırıldı.

---

## 2) Felsefe Uyum Değerlendirmesi (Kod Kanundur)

### Güçlü Yanlar

- Uyuşmazlık çözümünün on-chain zamanlayıcılara dayanması.
- Backend'in fon serbest bırakma yetkisi olmaması.
- Anti-Sybil/Tier mantığının sözleşmede bulunması.

### Riskli Alanlar (Felsefeyi Zayıflatan)

1. **UI eksik akışları** kullanıcıyı yanlış karar noktasına itebiliyor (ör. challenge butonu yoksa maker fiilen çaresiz kalıyor).
2. **State ayrışması** (local vs polling) kullanıcıya yanlış state göstererek “off-chain hakemlik hissi” doğuruyor.
3. **Hatalı miktar hesapları** (fiat/decimal) ekonomik olarak kullanıcıyı cezalandırabiliyor.

---

## 3) Kritik Bulgular ve Durum

## P0 — Mainnet Öncesi Zorunlu

1. **Challenge başlatma yolu görünürlüğü (Maker, PAID):**
   - Durum: **DÜZELTİLDİ (bu tur)**
   - Not: `pingTakerForChallenge` ve ardından `challengeTrade` için ayrı buton/timer akışı eklendi.

2. **`tradeState` polling senkronu:**
   - Durum: **DÜZELTİLDİ (bu tur)**
   - Not: Polling güncellemesinde `setTradeState(updated.status)` tetikleniyor.

3. **Fiat/crypto + decimal hesaplama hatası (`handleStartTrade`, `handleCreateEscrow`):**
   - Durum: **DÜZELTİLDİ (bu tur)**
   - Not: Token decimal on-chain okunuyor; startTrade tarafında fiat/rate -> crypto dönüşümü uygulanıyor.

## P1 — Mainnet Öncesi Kuvvetle Önerilen

4. **Cooldown kalan süresinin kullanıcıya gösterilmesi:**
   - Durum: **DÜZELTİLDİ (bu tur)**
   - Not: `getCooldownRemaining` eklendi ve buton etiketinde süre gösteriliyor.

5. **Listing iptali sonrası DB senkronu:**
   - Durum: **DÜZELTİLDİ (bu tur)**
   - Not: On-chain cancel sonrası `DELETE /api/listings/:id` çağrısı eklendi.

6. **Chargeback ack state geri yükleme:**
   - Durum: **KISMEN DÜZELTİLDİ (bu tur)**
   - Not: trade verisinden `chargebackAck` okunup checkbox state restore ediliyor.

7. **Proxy/IP tutarlılığı (`trust proxy`):**
   - Durum: **DÜZELTİLDİ (bu tur)**
   - Not: `app.set('trust proxy', true)` tüm ortamlarda aktif.

## P2 — Takip Turunda

8. **`approve` başarısızlık sonrası allowance cleanup (`approve(0)`):**
   - Durum: **AÇIK**
9. **İleri seviye idempotency / replay korumaları (event listener):**
   - Durum: **AÇIK/KISMİ**
10. **Operasyonel alarm/observability standardizasyonu:**
   - Durum: **AÇIK**

---

## 4) Altyapı ve Maliyet (Free Plan Odaklı)

Yeni proje + free plan kısıtı için önerilen azaltımlar:

1. **Polling maliyeti azaltma**
   - Trade room polling’i sabit 15 sn yerine _state-aware adaptive_ yap:
     - LOCKED/PAID: 20–30 sn
     - CHALLENGED son 24 saat: 10–15 sn
     - Arka plan sekmede: 45–60 sn

2. **Log yazım maliyeti**
   - Client error logları için sampling (%10/%20) + dedup key.
   - Aynı hata mesajını kısa pencerede tek kayıtla birleştir.

3. **Mongo indeks optimizasyonu**
   - `trades`: `(maker_address,status,created_at)`, `(taker_address,status,created_at)`
   - `listings`: `(status,exchange_rate,_id)`
   - `events`: idempotency için `(tx_hash,log_index)` unique

4. **Redis fail-open + memory guard**
   - Zaten fail-open yaklaşımı var; ek olarak key TTL disiplini ve per-route quota metrikleri tutulmalı.

5. **Receipt upload maliyeti**
   - Büyük dosyalarda memory yerine stream/disk tabanlı akışa geçiş (CPU/RAM piklerini azaltır).

---

## 5) Kod Bazlı Uygulama Adımları (Bu rapor sonrası)

### Aşama-1 (hemen)
- [x] Frontend challenge UI + timer guard
- [x] Frontend state senkronu
- [x] Dynamic decimals + fiat/crypto dönüşümü
- [x] Cooldown remaining gösterimi
- [x] Listing delete DB senkronu
- [x] trust proxy tutarlılığı

### Aşama-2 (sonraki PR)
- [ ] `approve(0)` rollback akışı
- [ ] Event replay idempotency standart tablosu
- [ ] Adaptive polling ve sekme görünürlüğü optimizasyonu
- [ ] Client log sampling/dedup

### Aşama-3 (mainnet check)
- [ ] Dry-run incident drill (RPC kesintisi, Redis kesintisi, Mongo yavaşlatma)
- [ ] 72 saat soak test (memory leak, reconnect, DLQ davranışı)
- [ ] Ekonomik saldırı senaryoları (spam, cooldown abuse, cancellation abuse)

---

## 6) Nihai Karar

**Mainnet’e geçiş için henüz “GO” verilmemeli.**

Bu turdaki düzeltmeler kritik riskleri önemli ölçüde düşürdü; ancak P2 açıkları ve operasyonel dayanıklılık testleri tamamlanmadan mainnet riski gereksiz yüksek kalır. 

**Öneri:** En az 1 ek hardening turu + soak test tamamlandıktan sonra Go/No-Go kararı.

# Araf Protokolü — Çözülmemiş Güvenlik/Bütünlük Bulguları Taraması

**Tarih:** 2026-03-24  
**Kaynak Dokümanlar:**
- `docs/TR/ARCHITECTURE.md`
- `docs/ARAF_SECURITY_AUDIT_ADDENDUM.md`
- `docs/Hatalar ve Düzeltilmesi gerekenler.md`

## 1) Mimari İnceleme Özeti (ARCHITECTURE.md)

Mimari doküman; **hibrit Web2.5** yaklaşımını, kritik state/varlık akışlarının on-chain, PII ve sorgu-performans katmanının off-chain tutulduğu bir model olarak tanımlıyor. Temel güvenlik iddiaları:
- On-chain tarafın uyuşmazlık ve fon hareketinde belirleyici olması,
- Backend'in fon taşıyamayan “zero private key relayer” olması,
- Anti-Sybil ve tier sınırlarının sözleşmede zorunlu tutulması.

Bu iddialar, UI/Backend uygulamasında karşılık bulmadığında “mimari doküman doğru, implementasyon eksik” sınıfında risk oluşuyor.

## 2) Güvenlik Raporlarından Taranıp **Hâlâ Açık** Kalan Bulgular

Aşağıdaki maddeler, kod tabanı taramasında (2026-03-24) hâlâ açık görünen bulgulardır.

### A) Addendum (18 yeni bulgu) içinden açık kalanlar

1. **EK-KRİT-01** — Maker için PAID aşamasında challenge/ping aksiyonu UI’da görünmüyor.  
2. **EK-KRİT-02** — Polling `activeTrade.state` güncellese de `tradeState` senkron güncellenmiyor (state ayrışması riski).  
3. **EK-YÜKS-01** — Maker’ın `pingTakerForChallenge` için `paidAt + 24h` ön-zamanlayıcısı yok.  
4. **EK-YÜKS-02** — `challengeCountdown` ve `makerChallengeTimer` aynı zaman için çift countdown çalıştırıyor.  
5. **EK-YÜKS-03** — Kontrattaki `getCooldownRemaining()` UI’da kullanılmıyor; kalan süre gösterilmiyor.  
6. **EK-YÜKS-04** — `taker-name` fetch sadece `LOCKED` durumda; `PAID/CHALLENGED` sonrası boş kalabiliyor.  
7. **EK-YÜKS-05** — `handleCreateEscrow` içinde token decimal hâlâ hardcoded `6`.  
8. **EK-YÜKS-06** — `chargebackAccepted` yalnızca local state; sayfa yenilenince resetleniyor.  
9. **EK-YÜKS-07** — `handleDeleteOrder` için `OPEN` state ön doğrulaması yok.  
10. **EK-ORTA-02** — `ConflictingPingPath` için özel, kullanıcı-dostu hata eşlemesi yok.  
11. **EK-ORTA-06** — `handleChallenge` içinde ping öncesi zaman guard’ı yok (kontrat revert’üne bırakılıyor).  
12. **EK-ORTA-09** — `handleRelease` sonrası `activeTrade` temizlenmiyor (`setActiveTrade(null)` yok).

### B) “Hatalar ve Düzeltilmesi Gerekenler” raporundan açık kalan önemli maddeler

13. **KRİT-04** — `handleStartTrade` hâlâ `order.max * 1e6` ile hesaplıyor; fiat/crypto dönüşümü ve dinamik decimal problemi sürüyor.  
14. **KRİT-05 (kısmi)** — `trust proxy` yalnızca production’da set ediliyor; kod yorumlarıyla çelişki var ve ortam-bağımlı kırılma riski sürüyor.  
15. **ORTA-02** — `approve` sonrası işlem başarısızlığında `approve(0)` sıfırlama/cleanup akışı yok.  
16. **ORTA-04** — Maker ilan iptalinde sadece local state filtreleniyor; backend listing silme/senkron çağrısı görünmüyor.

## 3) Not: Çözülmüş Görünen Örnek Maddeler

Aşağıdaki örnekler kodda giderilmiş görünüyor (tam liste değil):
- Refresh token wallet bağlama doğrulaması (`siwe.js`)  
- SIWE nonce üretiminde yarış durumuna karşı `SET NX` yaklaşımı  
- `PUT /profile` için auth rate limiting  
- `usePII` içinde authenticated fetch + AbortController

## 4) Önceliklendirme (Hızlı Yol Haritası)

**P0 (hemen):** 1,2,13  
**P1 (yüksek):** 3,6,7,8,14  
**P2 (orta):** 4,5,9,10,11,12,15,16

---

## 5) Doğrulama için taranan ana kod alanları

- `frontend/src/App.jsx`
- `frontend/src/hooks/usePII.js`
- `backend/scripts/app.js`
- `backend/scripts/services/siwe.js`
- `backend/scripts/routes/auth.js`
- `backend/scripts/middleware/rateLimiter.js`

