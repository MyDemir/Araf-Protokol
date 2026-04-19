# Araf V3 Teknik Ürün ve Uygulama Planı

## 1. Kapsam ve yöntem

Bu rapor yalnız şu kaynaklara dayanır:

1. Repodaki mevcut kod durumu
2. `docs/Plan/riskpuanı.md`
3. Senin paylaştığın iki ek plan metni:
   - küresel ölçeklenme / ürün mimarisi modülleri
   - “Proof of Peace” ödül sistemi
4. Sohbette ayrıca verdiğin ürün istekleri:
   - admin panel
   - itibar temizleme süresinin 3 aya çekilmesi
   - trade ekranında referans kur akışı
   - rate limit politikasının Tier 4 market maker kullanımına göre yeniden düşünülmesi

Bu rapor varsayım üretmez. Repoda açıkça görünmeyen bir şeyi “mevcut” kabul etmez. Plan başlıkları için de “hemen uygulanabilir”, “önce araştırma gerekir”, “felsefeye aykırı”, “yalnız UI/backend katmanında tutulmalı” ayrımı yapılır.

---

## 2. Mevcut repoda doğrulanabilen temel durum

### 2.1 Otorite sınırı
- Ekonomik ve state-changing authority halen kontrattadır.
- Backend trade read, PII koordinasyonu, cancel imza koordinasyonu ve audit yüzeyidir.
- V3’te public market nesnesi listing değil, order’dır; child trade gerçek escrow lifecycle’ını taşır.

### 2.2 Payout / ödeme yöntemi gerçek durumu
- `auth.js` tarafındaki `PROFILE_SCHEMA` yalnız `TR_IBAN`, `US_ACH`, `SEPA_IBAN` kabul eder.
- `User` modelinde ise `UK_FPS` ve `SWIFT` enum’da halen görünür.
- Bu nedenle ürünün fiili destek seti ile veri modeli arasında fark vardır.

### 2.3 PII erişim modeli
- PII erişimi trade-scoped ve snapshot-only mantıkla tasarlanmış.
- Backend current profile fallback yerine trade snapshot’tan ödeme profilini döndürmeye çalışıyor.
- Bu, “post-lock drift” riskini sınırlayan doğru yönelimdir.

### 2.4 Trade risk read layer mevcut ama eksik
- `trades.js` içinde banka profil riski türetiliyor.
- Ancak `frequentRecentChanges` hâlen sabit `false` ve lock-time bank change snapshot alanları response’a gerçek anlamda taşınmıyor.
- Bu nedenle health/risk katmanı için mevcut veri yüzeyi henüz tam değil.

### 2.5 Feedback yüzeyi mevcut ama admin okuma yüzeyi yok
- `POST /api/feedback` route’u var.
- Feedback verisi MongoDB’ye yazılıyor ve 1 yıllık TTL ile tutuluyor.
- Ancak repoda doğrulanabilir bir admin okuma paneli / admin API yüzeyi görünmüyor.

### 2.6 Rate limiter’ın bugünkü pratik etkisi
- `ordersWriteLimiter` wallet/IP bazlı saatte 5 istek olarak tanımlı.
- Ancak `listings.js` içindeki write route’ları V3’te deprecated ve `410` döndürüyor.
- Yani mevcut repoda bu limiter, authoritative order creation yolunu zorunlu olarak temsil etmiyor; doğrudan kontrat create/fill akışı için backend üstünde kanıtlanmış bir merkezi kısıt katmanı görünmüyor.

### 2.7 Owner yüzeyi
- Kontrat `Ownable` kullanıyor.
- Owner tarafında treasury, token config, fee config ve cooldown config değiştirilebiliyor.
- Ayrı bir on-chain admin role sistemi şu an raporda doğrulanamıyor; yalnız owner authority’si kesin.

### 2.8 Fee ve reputation tarafı
- `setFeeConfig` owner tarafından çağrılabiliyor.
- `decayReputation` temiz dönem mantığı kontratta var ve bugün 180 gün çizgisinde.
- Mevcut reputation enforcement kaba sinyaller üzerinden çalışıyor; `success / failed` mantığı ağırlıklı.

---

## 3. Korunması gereken felsefi ve teknik sınırlar

Aşağıdaki kurallar sabit tutulmalıdır:

1. **Kontrat ekonomik authority’dir.** Backend veya admin panel dispute sonucu, payout sonucu veya fon akışını override etmemelidir.
2. **Oracle-free dispute korunmalıdır.** Harici kur, banka verisi, risk API’si veya admin müdahalesi escrow sonucunu belirlememelidir.
3. **Backend risk üretebilir; hüküm veremez.** Banka değişimi, health score, ping geçmişi, UI friction ve uyarı katmanı backend/UI’da olabilir; ama bunlar kontratın yerine geçen ekonomik enforcement’a dönüşmemelidir.
4. **Blast radius ayrıştırılmalıdır.** Yeni rewards, admin, score, ticker veya analytics modülleri çekirdek escrow kontratını büyütmeden modüler tutulmalıdır.
5. **Kullanıcıya şeffaflık, karşı tarafa özet sinyal.** Maker kendi risk/puan dökümünü görebilir; taker tarafına yalnız sınırlı güven sinyali gitmelidir.

---

## 4. Ürün karar matrisi

## 4.1 Hemen benimsenmesi gerekenler

### A. İtibar temizleme süresini 3 aya çekmek
**Karar:** Kabul.

**Neden:**
- Bugünkü 180 gün modeli fazla sert.
- “clean slate” tarafında kullanıcı psikolojisi ve retention için 90 gün daha dengeli.
- Bu değişiklik oracle-free ve contract-authoritative çizgiye ters düşmez.

**Uygulama katmanı:**
- `ArafEscrow.sol` içinde `decayReputation` temiz dönem eşiği 180 günden 90 güne çekilir.
- Mimari etkisi sınırlıdır.

**Öncelik:** P0

---

### C. Admin panel
**Karar:** Kabul, fakat yalnız operasyon/izleme paneli olarak.

**Kesin sınır:**
- Admin panel dispute sonucu belirleyemez.
- Admin panel release/cancel/burn override edemez.
- Admin panel reputation yazamaz.
- Admin panel fonları hareket ettiremez.

**Bugünkü repo gerçeğine göre doğru yetkilendirme modeli:**
- Kontratta kanıtlanmış ayrı admin role yok.
- Bu yüzden ilk sürüm panel erişimi yalnız **on-chain contract owner wallet** ile sınırlandırılmalıdır.
- Ayrı admin rolleri istenecekse bu daha sonra ayrı bir `AdminRegistry` / `AccessManager` sözleşmesiyle eklenmelidir.

**İlk sürümde panelin kapsaması gerekenler:**
- Feedback kayıtlarını listeleme
- DLQ / worker hata gözlemi
- Snapshot incomplete trade listesi
- Riskli payout profile değişim monitörü
- Rate limit hit logları
- Sistem health / readiness / config görünümü

**Öncelik:** P1

---

### D. Trade ekranında canlı referans kur akışı
**Karar:** Kabul.

**Sınır:**
- Bu veri yalnız **informational / UX** amaçlıdır.
- Escrow sonucu, dispute sonucu, fee veya settlement authority üretmez.
- Frontend-only display katmanında kalmalıdır.

**Doğru uygulama:**
- Frontend periyodik ticker widget
- “Referans kur, bağlayıcı değildir” ibaresi
- Kontrata veya backend enforcement’a bağlanmamalı

**Öncelik:** P1

---

### E. Tier 4 kullanımına uygun rate limit politikası
**Karar:** Kabul, ama önce doğru yüzey tanımlanmalı.

**Kritik mevcut durum:**
Repoda görünen `ordersWriteLimiter`, deprecated listing write endpoint’lerine bağlı. Bu nedenle “Tier 4 market maker’ı bugün gerçekten bu limiter engelliyor” demek mevcut koddan kesin kanıtlanamaz.

**Doğru ürün kararı:**
- Rate limit politikası **backend read/write yüzeyleri** için tier-aware hale getirilmeli.
- Kontrat create/fill akışını zaten doğrudan durduramayacağı açıkça kabul edilmeli.

**Öneri:**
- Tier 0–1: daha sert limit
- Tier 2: orta
- Tier 3–4: yüksek tavan
- Read, coordination write, feedback ve admin yüzeyleri ayrı bucket’lara bölünmeli

**Öncelik:** P1

---

## 4.2 Güçlü adaylar, ama ayrı modül olarak tasarlanmalı

### F. Kısmi uzlaşma (`splitBps`) / partial settlement
**Karar:** Kabul, ama mevcut cancel flow’un küçük yaması olarak değil, ayrı settlement yüzeyi olarak.

**Neden:**
Bugünkü `proposeOrApproveCancel` mantığı binary çıkış içindir. `splitBps` eklemek işlevsel olarak mantıklı olsa da kavramsal olarak bu artık cancel değil, **agreed settlement** olur.

**Doğru tasarım:**
- Yeni typehash:
  - ya `CancelProposal` genişletilir,
  - ya tercihen yeni `SettlementProposal` tipi açılır.
- Yeni settlement fonksiyonu:
  - iki tarafın imzasını doğrular
  - kriptoyu `splitBps` oranına göre böler
  - state’i finalizer olarak kapatır

**Neden ayrı fonksiyon tercih edilmeli:**
- cancel semantics bozulmaz
- audit izi daha temiz olur
- frontend UX daha anlaşılır olur

**Öncelik:** P2

---

### G. `paymentRiskLevel` ile risk sınıfı fiyatlaması
**Karar:** Kabul, ama yalnız sabit ve kullanıcı tarafından seçilmiş risk sınıfı olarak.

**Ne kabul edilir:**
- `Order` veya create parametresinde düşük/orta/yüksek risk sınıfı
- Bu sınıfa göre bond surcharge veya min-tier kuralı

**Ne kabul edilmez:**
- backend’in banka değişim geçmişini, davranış riskini veya heuristik health score’u doğrudan kontrata yazıp bond/tier authority üretmesi

**Doğru sınır:**
- On-chain: coarse risk class
- Off-chain: behavioral risk, UI friction ve uyarı

**Öncelik:** P2

---

### H. Health score / tier-aware risk skoru
**Karar:** Kabul, ama açıkça backend/UI katmanında.

**Bu modülün doğru yeri:**
- `trades.js` response enrichment
- maker dashboard breakdown
- taker tarafında yalnız özet label / color
- PII reveal öncesi friction katmanı

**Doğru veri ayrımı:**
- Maker kendi breakdown’ını görebilir
- Taker yalnız `GREEN / YELLOW / RED` ve kısa açıklama görmeli

**Mevcut repo precondition’ı:**
- Önce payout/profile risk verisinin güvenilir şekilde snapshot’lanması gerekir
- Bugünkü `trades.js` risk helper’ı health score modülü için yetersizdir; önce veri katmanı düzeltilmelidir

**Öncelik:** P1

---

### I. İtibar sinyallerinin ayrıştırılması
**Karar:** Kabul.

**Neden:**
Bugünkü `failedDisputes` tipi kaba. Burn ile auto-release aynı psikolojik anlamı taşımaz.

**Önerilen ayrım:**
- `burnCount`
- `autoReleaseCount`
- `mutualCancelCount`
- opsiyonel `disputedButResolvedCount`

**Uygulama modeli:**
1. İlk adım: backend/UI seviyesinde ayrışmış analytics ve health score sinyali
2. İkinci adım: kontrat reputation struct’ında daha ince ayrım

**Öncelik:**
- Backend/UI ayrımı: P1
- Kontrat seviyesinde yeni struct/event/refactor: P2

---

## 4.3 Araştırma gerektiren, hemen çekirdeğe alınmaması gerekenler

### J. “Proof of Peace” ödül sistemi
**Karar:** Kabul edilebilir ama çekirdekten ayrıştırılmış ikinci kontrat olarak.

**Doğru yaklaşım:**
- `ArafEscrow.sol` fon-kilit-uyuşmazlık çekirdeği olarak kalır
- `ArafRewards.sol` ayrı kontrat olur
- escrow kapanışlarından gelen sinyallerle epoch bazlı share muhasebesi yapar

**Neden modüler olmalı:**
- blast radius küçülür
- escrow güvenliği ile rewards ekonomisi birbirine karışmaz
- ileride değiştirilebilirlik artar

**Ön şart:**
- önce core protocol safety ve state model netleşmeli
- rewards, admin ve score sistemleri çekirdeğin önüne geçmemeli

**Öncelik:** P3

---

### K. Yield-bearing bonds
**Karar:** Şimdilik araştırma / erteleme.

**Neden:**
- çekirdek escrow kasasını yeni token riskine açar
- faiz üreten token semantiği, valuation ve accounting yüzeyi büyür
- dispute/burn/payout hesaplarını daha karmaşık hale getirir

**Felsefi uyum var mı?**
Evet, olabilir. Ama güvenlik yüzeyi ciddi büyür.

**Karar:**
- Mainnet sonrası araştırma hattı
- ilk sürüm kapsamına alınmamalı

**Öncelik:** P4 / Research

---

### L. Sürekli algoritmik itibar skoru
**Karar:** Araştırma adayı.

**Neden:**
- Matematiksel olarak güçlü ama ürün anlatısını karmaşıklaştırır
- audit edilebilirlik, kullanıcı anlaşılabilirliği ve governance etkisi dikkat ister
- bugünkü tier sistemi kaba ama anlaşılır

**Doğru yol:**
- Önce ayrıştırılmış sinyaller ve health score UI katmanında çalışsın
- Sürekli skora sonra geçilsin

**Öncelik:** P4 / Research

---

### M. Soulbound Token (SBT) ile taşınabilir itibar
**Karar:** Araştırma / vizyon katmanı.

**Neden:**
- bugünkü çekirdeğin ana işi escrow ve dispute çözümü
- external composability iddiası ayrı güven ve ürün katmanı gerektirir
- yanlış erken açılırsa Araf’ın reputation semantics’i dış protokollere taşınmış olur

**Doğru zaman:**
- ancak ayrıştırılmış reputation modeli ve uzun dönem verisi oturduktan sonra

**Öncelik:** P4 / Research

---

## 4.4 Felsefeye aykırı veya şu haliyle reddedilmesi gerekenler

### N. Banka değişikliği gibi off-chain davranış sinyallerini doğrudan kontrata taşıyıp bond/tier belirlemek
**Karar:** Reddedilmeli.

**Neden:**
- Bu, backend kaynaklı yorum katmanını ekonomik authority’ye dönüştürür.
- Araf’ın en güçlü prensibi olan “kontrat authority, backend mirror” çizgisini bozar.
- Oracle-free dispute mantığını dolaylı olarak zedeler.

**Doğru alternatif:**
- bank change / health score / triangulation riskleri backend ve UI katmanında kalsın
- kontrata yalnız coarse, kullanıcı tarafından seçilen risk sınıfı taşınsın

---

## 5. Adım adım uygulama planı

## Faz 0 — Güvenlik ve taban düzeltmeleri
Bu faz bitmeden yeni modül açılmamalı.

1. Fee upper bound’ları ekle
2. `decayReputation` temiz dönemini 90 güne çek
3. Payout/profile veri modeli ile route validation uyumsuzluklarını kapat
4. `trades.js` health/risk için gerekli gerçek snapshot sinyallerini üretir hale getir
5. Destekli ödeme raylarını ürün ve kod seviyesinde aynı hale getir

**Çıktı:** güvenli ve tutarlı bir ana omurga

---

## Faz 1 — Backend/UI risk ve operasyon katmanı

1. Tier-aware health score
2. Maker dashboard score breakdown
3. Taker summary signal (`GREEN/YELLOW/RED`)
4. Admin observability panel
5. Feedback admin read API
6. Tier-aware backend rate limiting
7. Trade ekranı referans kur widget’ı

**Çıktı:** ürün güven katmanı + operasyon paneli

---

## Faz 2 — Protokol genişletmeleri

1. Partial settlement (`splitBps` / settlement proposal)
2. `paymentRiskLevel` ile risk sınıfı fiyatlaması
3. Contract-level reputation signal separation

**Çıktı:** daha esnek, daha küresel, ama hâlâ oracle-free bir escrow çekirdeği

---

## Faz 3 — Ayrı ekonomik modüller

1. `ArafRewards.sol`
2. Epoch bazlı rewards accounting
3. Minimum %30 / maksimum %70 reward pool share bound’ları
4. “conflict = 0x reward” mantığı

**Çıktı:** çekirdekten ayrıştırılmış kooperatif ödül sistemi

---

## Faz 4 — Araştırma hattı

1. Yield-bearing bonds
2. Sürekli algoritmik reputation
3. Soulbound / taşınabilir itibar

**Çıktı:** ileri vizyon, ama çekirdek güvenliği riske atmadan

---

## 6. Sonuç

Bu üç plan ve ek ürün talepleri birlikte değerlendirildiğinde doğru strateji şudur:

- **Önce çekirdeği temizle**
- **Sonra backend/UI risk ve operasyon katmanını ekle**
- **Daha sonra settlement ve payment risk gibi protokol uzantılarını aç**
- **Rewards, yield ve SBT gibi sistemleri çekirdekten ayrı modüller olarak geliştir**

Araf’ın felsefesine en uygun büyüme yolu, “her şeyi kontrata taşımak” değil; **kontrat authority’sini dar ve sert tutup, risk/UX/ops modüllerini onun çevresine disiplinli biçimde örmektir.**
