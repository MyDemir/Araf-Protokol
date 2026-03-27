# Araf Protocol — Nihai Konsolide Güvenlik Raporu

**Tarih:** 27 Mart 2026  
**Durum:** **NO-GO**  
**Kaynaklar:** 4 bağımsız agent çıktısının konsolidasyonu  
**Amaç:** Düzeltme planı çıkarabilmek için bulguları tek, uygulanabilir, çelişkileri görünür kılan bir Markdown raporunda birleştirmek

---

## 1. Yönetici Özeti

Dört agent çıktısı birlikte değerlendirildiğinde sonuç nettir: **Araf Protocol şu an mainnet için hazır değil.**

Ancak agent’lar arasında iki önemli fark vardır:

1. **Teknik bulgu yoğunluğu ve ciddiyet seviyesi farklı.**  
   Bazı agent’lar daha agresif, bazıları daha konservatif değerlendirme yapmıştır.

2. **Metodoloji / kanıt zinciri konusunda ayrışma var.**  
   Özellikle 2. agent, teknik bulguların tümünü reddetmemekte; fakat “tüm turlar tamamlandı / final gate verilebilir” iddiasının izlenebilirlik açısından yeterince güçlü olmadığını söylemektedir.

Bu nedenle bu rapor, bulguları üç gruba ayırır:

- **A Grubu — Güçlü uzlaşı bulunan bulgular**
- **B Grubu — Orta güvenli ama düzeltilmesi tavsiye edilen bulgular**
- **C Grubu — Metodolojik / doğrulama kalitesi çekinceleri**

### Nihai karar
**NO-GO**

### Ana gerekçe
Aşağıdaki risk zincirleri kapanmadan güvenli mainnet penceresi oluşmuyor:

- `listingRef` authoritative bağının zorunlu olmaması
- wallet mismatch sonrası forced backend invalidation eksikliği
- `realTradeId` bulunamayınca yanlış kimlikle akışa devam edilmesi
- Redis kesintisinde auth limiter fail-open davranışı
- nonce üretimindeki atomiklik kalıntısı
- auth restore zincirinin frontend doğruluğuna aşırı bağımlı olması

---

## 2. Kullanılan Kaynaklar

Bu rapor aşağıdaki dört girdi üzerine kuruludur:

### Agent 1
- En kapsamlı teknik bulgu seti
- Tur 1–8 tamamlandı kabulü
- 87 dosya incelendi iddiası
- Geniş mainnet blocker listesi

### Agent 2
- Revalidasyon odaklı
- Teknik bulguları tamamen çürütmüyor
- Fakat tur kapanışları ve kanıt zinciri için “tamamlandı” demeyi erken buluyor
- Bu nedenle ayrı bir metodoloji çekincesi katmanı sağlıyor

### Agent 3
- Agent 1 ile büyük ölçüde aynı bulgu çizgisi
- Daha dar kapsamlı ama teyit odaklı
- Final gate ve özel talimat teyidi ekli

### Agent 4
- Daha konservatif
- Daha az sayıda blocker işaretliyor
- Özellikle auth limiter fail-open ve frontend contract hook log fallback konularını öne çıkarıyor

---

## 3. Kapsam Durumu

### Teknik kapsam
Agent 1 ve Agent 3’e göre aşağıdaki katmanlar incelenmiş kabul ediliyor:

- Contracts core + tests + deploy
- Backend auth/session/wallet
- Backend trade/pii/listener/worker/jobs/config/utils
- Frontend auth/wallet/session
- Frontend trade/escrow/payment/release
- EN/TR docs ve release checklist

### Metodoloji çekincesi
Agent 2’nin itirazı önemlidir:

- Tüm tur kapanışlarında dosya günlüğü aynı sıkılıkta görünmüyor
- Bazı cross-layer güvenlik hükümleri için kanıt izi “release-blocking standardı” kadar sert olmayabilir
- Bu nedenle “teknik riskler var” sonucu güçlü olsa da, “inceleme kusursuz tamamlandı” sonucu tartışmalıdır

### Bu raporun yaklaşımı
Bu rapor:
- teknik bulguları kullanır,
- fakat metodolojik çekinceyi de kayda geçirir,
- kesinlik seviyesini buna göre ayırır.

---

## 4. Konsolide Sonuç Matrisi

| Yeni ID | Başlık | Konsensüs | Ciddiyet | Mainnet Blocker |
|---|---|---|---|---|
| ARAF-01 | Zero `listingRef` / authoritative bağ kopması | Güçlü | YÜKSEK | Evet |
| ARAF-02 | 409 mismatch sonrası forced invalidation eksikliği | Güçlü | YÜKSEK | Evet |
| ARAF-03 | `realTradeId` fallback / ID drift | Güçlü | YÜKSEK | Evet |
| ARAF-04 | Auth limiter Redis kesintisinde fail-open | Güçlü | YÜKSEK | Evet |
| ARAF-05 | Nonce atomikliği kalıntısı (`SET NX` sonucu yönetimi) | Orta-Güçlü | YÜKSEK | Evet |
| ARAF-06 | Auth restore mimarisi frontend’e aşırı bağımlı | Güçlü | YÜKSEK | Evet |
| ARAF-07 | `requireSessionWalletMatch` politikasının parçalı uygulanması | Güçlü | ORTA | Hayır |
| ARAF-08 | PII token / PII read zincirinde residual risk | Orta | ORTA | Hayır |
| ARAF-09 | Backend relay / on-chain truth split | Güçlü | ORTA | Hayır |
| ARAF-10 | Receipt hash / evidence integrity drift | Orta | ORTA | Hayır |
| ARAF-11 | Listener / DLQ / replay operasyonel riskleri | Orta | ORTA | Hayır |
| ARAF-12 | Docs / test / checklist / runbook drift | Güçlü | ORTA | Hayır |
| ARAF-13 | Frontend contract hook prod log fallback riski | Zayıf-Orta | YÜKSEK | Tartışmalı |

---

## 5. Güçlü Uzlaşı Bulunan Mainnet Blocker’lar

## [ARAF-01] Zero `listingRef` ile on-chain escrow / off-chain trade bağının kopması
**Kaynak eşleşmesi:** Agent 1, Agent 3  
**Ciddiyet:** YÜKSEK  
**Mainnet Blocker:** Evet

### Teknik Açıklama
Kontrat tarafında `listingRef` zorunlu değilse zincirde escrow oluşabiliyor; backend listener ise authoritative bağ kuramadığında trade kaydı oluşturmuyor. Böylece zincirde var olan işlem, backend/UI tarafında görünmeyen “yetim” bir işleme dönüşüyor.

### Etki
- on-chain / backend truth split
- trade room erişilemezliği
- audit ve operasyon kaybı
- multi-listing senaryolarında veri bütünlüğü riski

### Çözüm
- Kontratta `listingRef` zorunlu hale getirilmeli
- zero `listingRef` path’i revert etmeli
- listener tarafında authoritative olmayan event için net ret politikası uygulanmalı

### Uygulama Önceliği
**P0**

---

## [ARAF-02] 409 mismatch sonrası forced backend invalidation eksikliği
**Kaynak eşleşmesi:** Agent 1, Agent 3  
**Ciddiyet:** YÜKSEK  
**Mainnet Blocker:** Evet

### Teknik Açıklama
Wallet mismatch halinde 409 dönse de session invalidation her durumda backend tarafından zorunlu yapılmıyor. Sistem, frontend’in logout endpoint’ini doğru çağıracağı varsayımına fazla bağlı.

### Etki
- stale cookie / stale session
- UI “çıkmış” görünürken backend session canlı kalabilir
- eski wallet bağlamında read/write denemeleri mümkün olabilir

### Çözüm
- mismatch response sonrası forced revoke + clear-cookie modelini değerlendir
- frontend `authenticatedFetch` 409 dalını best-effort değil zorunlu invalidation yoluna taşı
- restore zincirini mismatch sonrası daha sert kes

### Uygulama Önceliği
**P0**

---

## [ARAF-03] `realTradeId` fallback kaynaklı kimlik drift’i
**Kaynak eşleşmesi:** Agent 1, Agent 3  
**Ciddiyet:** YÜKSEK  
**Mainnet Blocker:** Evet

### Teknik Açıklama
Gerçek backend trade `_id` bulunamadığında listing ID veya başka fallback kimlik ile akışa devam edilmesi, trade kimlik modelini kırıyor.

### Etki
- yanlış trade room
- PII zincirinin bozulması
- `chargeback-ack`, `propose-cancel`, detail fetch ve audit zincirinin yanlış resource ile çalışması
- sessiz 404/403 ve yanlış başarı hissi

### Çözüm
- `realTradeId` bulunamazsa trade room açma
- listing id / trade `_id` / on-chain id tiplerini sert ayır
- event listener gecikmesini “bekle ve yeniden çöz” mantığıyla ele al, fallback ile maskeleme

### Uygulama Önceliği
**P0**

---

## [ARAF-04] Auth limiter Redis kesintisinde fail-open
**Kaynak eşleşmesi:** Agent 1, Agent 3, Agent 4  
**Ciddiyet:** YÜKSEK  
**Mainnet Blocker:** Evet

### Teknik Açıklama
Redis hazır değilse auth limiter skip ediyor. Bu auth availability’yi korurken auth abuse yüzeyini büyütüyor.

### Etki
- `/nonce`, `/verify`, `/refresh` rate limit koruması fiilen düşer
- brute-force ve spam maliyeti azalır
- auth limiter, diğer limiter’lardan daha kritik olduğu için riski yüksektir

### Çözüm
- auth için ayrı degraded mode
- in-memory fallback veya fail-closed yaklaşımı
- auth ve non-auth limiter stratejileri ayrılmalı

### Uygulama Önceliği
**P0**

---

## [ARAF-05] Nonce atomikliği kalıntısı
**Kaynak eşleşmesi:** Agent 1, Agent 3  
**Ciddiyet:** YÜKSEK  
**Mainnet Blocker:** Evet

### Teknik Açıklama
`SET NX` kullanımı bir iyileştirme olsa da agent bulgularına göre sonucun güvenli şekilde ele alınmaması residual race davranışı bırakıyor.

### Etki
- auth akışında nondeterministic davranış
- nonce üretildi sanılıp farklı nonce ile devam edilmesi
- nadir ama kritik SIWE kırıkları

### Çözüm
- `SET NX` sonucu kesin kontrol edilmeli
- başarısızsa mevcut nonce tekrar okunmalı veya hata dönülmeli
- nonce akışı tek kaynaktan yönetilmeli

### Uygulama Önceliği
**P0**

---

## [ARAF-06] Auth restore zincirinin frontend doğruluğuna aşırı bağımlı olması
**Kaynak eşleşmesi:** Agent 1, Agent 2, Agent 3  
**Ciddiyet:** YÜKSEK  
**Mainnet Blocker:** Evet

### Teknik Açıklama
Auth restore modeli, backend strict binding yerine frontend’in aktif wallet ile session wallet’i doğru yorumlayacağı varsayımına yaslanıyor.

### Etki
- yanlış account restore
- stale session ile eski trade verisini bağlama
- auto-resume ile yanlış odaya dönüş
- auth güvenliğinin UI doğruluğuna emanet edilmesi

### Çözüm
- `/api/auth/me` politikasını sertleştir
- strict wallet-binding gerektiren read endpoint’leri sınıflandır
- restore mantığını “connected wallet hazır + signed session geçerli” şartlarına bağla

### Uygulama Önceliği
**P0**

---

## 6. Orta Öncelikli, Ama Düzeltilmesi Güçlü Tavsiye Edilen Bulgular

## [ARAF-07] `requireSessionWalletMatch` politikasının parçalı uygulanması
**Kaynak eşleşmesi:** Agent 1, Agent 3, Agent 4  
**Ciddiyet:** ORTA

### Risk
Güvenlik modeli endpoint bazlı yamaya dönüşür; yeni route’larda guard unutma riski artar.

### Çözüm
- policy matrix oluştur
- endpoint sınıflandır:
  - strict wallet binding zorunlu
  - ownership check yeterli
  - public/read-safe
- testleri policy matrix’e bağla

---

## [ARAF-08] PII token ve read zincirinde residual risk
**Kaynak eşleşmesi:** Agent 1, Agent 4  
**Ciddiyet:** ORTA

### Risk
Token issuance ve final read ayrı güven katmanı olduğundan, request-token zayıflığı tüm PII modelini zayıflatabilir.

### Çözüm
- `request-token` için session-wallet binding sertleştir
- logout / invalidation ile token yaşam döngüsünü gözden geçir
- PII token’lar için daha sıkı bağlam kur

---

## [ARAF-09] Backend relay / on-chain truth split
**Kaynak eşleşmesi:** Agent 1, Agent 3  
**Ciddiyet:** ORTA

### Risk
`propose-cancel` ve `chargeback-ack` gibi akışlarda zincirde işlem olup backend kaydının eksik kalması audit ve hukuki kayıt bütünlüğünü zayıflatır.

### Çözüm
- fallback başarılarını audit başarısından ayır
- sessiz swallow edilen hata noktalarını kapat
- on-chain fallback kullanıldığında backend mirror politikasını netleştir

---

## [ARAF-10] Receipt hash / evidence integrity drift
**Kaynak eşleşmesi:** Agent 1  
**Ciddiyet:** ORTA

### Risk
Backend’de gerçek receipt varken kontrata farklı hash gitme ihtimali dispute zamanında kanıt zincirini bozar.

### Çözüm
- reportPayment öncesi hash format/köken doğrulaması
- state manipülasyonuna karşı daha sert frontend/backend guard
- mümkünse backend-issued hash dışındaki hash’leri reddet

---

## [ARAF-11] Listener / DLQ / replay operasyonel riskleri
**Kaynak eşleşmesi:** Agent 1  
**Ciddiyet:** ORTA

### Risk
Poison entry, synthetic event tipi, partial replay doğruluğu gibi konular operasyonel yük ve sessiz veri sapması yaratabilir.

### Çözüm
- DLQ poison retention/runbook
- type normalization
- replay E2E testleri

---

## [ARAF-12] Docs / test / checklist / runbook drift
**Kaynak eşleşmesi:** Agent 1, Agent 2, Agent 3, Agent 4  
**Ciddiyet:** ORTA

### Risk
Kod doğru olsa bile operasyon, test ve dokümantasyon yanlış beklenti yaratıyor.

### Çözüm
- docs/test/code eş zamanlı güncelleme
- readiness checklist’i runtime gerçekliğiyle hizalama
- kırık test fixture’ları düzeltme

---

## 7. Tartışmalı veya Düşük Güvenli Bulgular

## [ARAF-13] Frontend contract hook prod log fallback riski
**Kaynak eşleşmesi:** Agent 4  
**Ciddiyet:** YÜKSEK (Agent 4 değerlendirmesi)  
**Mainnet Blocker:** Tartışmalı

### Not
Bu bulgu yalnızca Agent 4’te blocker olarak işaretlenmiş. Diğer agent’larda aynı ağırlıkta yer almıyor.

### Öneri
- production’da API URL yoksa log gönderimini tamamen kapat
- localhost fallback yalnız development için geçerli olsun

### Raporlama Kararı
**Düzeltilmesi tavsiye edilir**, fakat ana blocker setinin merkezine alınması için ek doğrulama yararlı olur.

---

## 8. Metodoloji ve Güven Seviyesi Notu

Agent 2’nin itirazı teknik olarak göz ardı edilmemeli.

### Metodoloji çekincesi
- Tüm turların “tamamlandı” kapanışı aynı sertlikte görünmüyor
- Bazı final hükümler için kanıt izi yeterince standardize değil
- Bu yüzden rapordaki bazı cümleler, teknik riskin kendisinden daha kesin olabilir

### Bu raporun duruşu
- Teknik riskleri **geçerli** kabul ediyor
- Ancak kanıt kalitesini de ayrı not ediyor
- Yani karar şu:
  - **“Risk yok” denemez**
  - **“İnceleme tartışmasız kusursuz tamamlandı” da denemez**

Bu ayrım, düzeltme planı açısından önemlidir.

---

## 9. Düzeltme Programı

## Faz 0 — Release blocker kapatma
1. `listingRef` zorunluluğu
2. 409 mismatch sonrası forced backend invalidation
3. `realTradeId` bulunmadan trade room açmama
4. Auth limiter için Redis-down güvenli mod
5. Nonce atomikliği düzeltmesi
6. Auth restore strict binding

## Faz 1 — Güvenlik modelini standartlaştırma
7. `requireSessionWalletMatch` policy matrix
8. PII token/session coupling sertleştirmesi
9. Backend relay/on-chain truth split azaltımı
10. Receipt hash integrity sabitleme

## Faz 2 — Operasyon ve güvenilirlik
11. DLQ poison / replay runbook
12. Docs/test/readiness drift temizliği
13. Çok-instance log/rate-limit hardening
14. Wallet-switch ve stale-session E2E suite

---

## 10. İlk Düzeltilecek 10 Konu

1. `createEscrow` için `listingRef` zorunluluğu  
2. 409 mismatch yolunda server-side revoke + clear-cookie  
3. `realTradeId` olmadan trade room açılmaması  
4. Auth limiter için Redis-down degraded/fail-closed stratejisi  
5. `generateNonce` atomikleşmesi  
6. `/api/auth/me` için strict wallet-binding standardı  
7. Endpoint bazlı `requireSessionWalletMatch` policy matrix + test  
8. `request-token` ve `pii/my` için session-wallet hardening  
9. Kırık test ve docs drift temizliği  
10. Wallet-switch regression ve stale-session E2E testleri  

---

## 11. Nihai Mainnet Kararı

**Karar: NO-GO**

### Asgari açılış koşulları
Aşağıdakiler kapanmadan mainnet açılışı önerilmez:

- ARAF-01
- ARAF-02
- ARAF-03
- ARAF-04
- ARAF-05
- ARAF-06

### Ek not
ARAF-07 ila ARAF-13 aralığındaki bulguların bir kısmı blocker olmasa da, blocker’lar kapandıktan sonra hızlıca ele alınmalıdır; aksi halde operasyonel, hukuki, audit ve kullanıcı güveni riski büyür.
