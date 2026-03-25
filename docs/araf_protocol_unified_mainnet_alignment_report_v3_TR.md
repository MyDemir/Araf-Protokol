# Araf Protocol — Birleşik Mimari, Güvenlik ve Guarded Launch Readiness Raporu (TR)

> Sürüm: v3  
> Hazırlayan yaklaşım: Mimari-tez analizi + kod/uygulama uyumu + Codex bulgularının danışman kalibrasyonu  
> Amaç: Kurucu prensipleri, fiili teknik davranışı ve guarded launch kararını tek belgede hizalamak

---

## 1. Bu dokümanın amacı

Bu doküman şu kaynakları tek çerçevede birleştirir:

1. **Kurucu tez ve sistem felsefesi**
2. **Kod tabanının fiili mimari ve güvenlik davranışı**
3. **Codex ile yapılan çok-aşamalı analizlerin sonuçları**
4. **Guarded launch için minimum güvenli düzeltme planı**
5. **Gelecekte server-blind PII modeline geçiş için yön**

Bu metin bir “nihai bağımsız audit sertifikası” değildir.  
Bunun yerine, **Araf Protocol için teknik gerçekliği dürüst biçimde tanımlayan, launch kararını yönlendiren ve düzeltme sırasını belirleyen kanonik karar dokümanıdır.**

---

## 2. Kurucu tez (kanonik ifade)

Araf Protocol’ün özünü tek cümlede şöyle tanımlamak gerekir:

> **Araf, hakikati bulan bir escrow değil; hakikati bilmeden, uzlaşmazlığı pahalılaştıran bir escrow’dur.**

Bu nedenle Araf:

- **oracle-free truth engine** değildir,
- **human arbitration platformu** değildir,
- **haklı tarafı tespit eden** bir sistem değildir.

Araf şunu yapar:

- fonları zincirde kilitler,
- anlaşmazlık durumunda insan kararını kaldırır,
- ekonomik baskı ve zaman bazlı erime ile uzlaşmazlığı pahalı hale getirir,
- tarafları “hakikati ispat etmeye” değil, **anlaşmayı veya süreci zamanında sonlandırmaya** iter.

Bu ifade, bundan sonra tüm teknik ve ürün dokümanlarında ana referans cümlesi olmalıdır.

---

## 3. Kurucu prensipler ve güncellenmiş değerlendirme

### 3.1. Gizlilik odaklı hedef

Kurucu hedef:

- kullanıcıdan minimum kişisel veri almak,
- yalnızca zorunlu banka bilgisi ve iletişim bilgisini tutmak,
- bunları da off-chain ve şifreli korumak,
- ideal durumda yalnızca trade taraflarının client-side okuyabildiği bir modele ilerlemek,
- on-chain tarafı mümkün olduğunca PII’siz bırakmak.

### Güncel teknik durum

Mevcut repo şu anda şu seviyededir:

- PII verisi şifreli tutuluyor.
- Trade-scoped erişim ve aktif durum kontrolü var.
- LOCKED anında snapshot alınması veri bütünlüğü açısından doğru.
- Ancak mevcut model **server-blind** değil.
- Backend trust boundary içinde decrypt capability mevcut.
- Bu nedenle sistem bugün **privacy-minimized**, ama henüz **end-to-end server-blind** değil.

### Doğru anlatım

Aşağıdaki iddialar mevcut sistem için **yanlış veya fazla iddialı** olur:
- “zero-knowledge”
- “backend hiçbir zaman göremez”
- “tam anonim”
- “hiç metadata tutulmaz”

Bugün için daha doğru dil:

> **Araf, minimum gerekli veriyi şifreli tutan, non-custodial ama henüz server-blind olmayan hibrit escrow sistemidir.**

### Hedef yön

Uzun vadede kurucu felsefeye daha sadık model şudur:

> **Platform PII’yi taşır ama okuyamaz; yalnızca ilgili trade tarafları client-side çözebilir.**

Bu belge, bugünkü gerçekliği ve o hedef yönü birbirinden ayırır.

---

### 3.2. Code is law hedefi

Kurucu hedef:

- hakem backend olmamalı,
- frontend karar verici olmamalı,
- gerçek karar ve state transition kontratta olmalı,
- backend yalnızca yardımcı/off-chain destek işlevi görmeli.

### Güncel teknik durum

Bu hedefin güçlü tarafları var:

- custody zincirde,
- state machine zincirde,
- release/challenge/burn gibi çekirdek işlemler zincirde,
- backend’in fon hareket ettiren bir signer/relayer custody modeli görünmüyor.

Ama ana kırılma şudur:

> **Kontrat tek otorite olmak isterken, backend bazı konularda ikinci bir yorum katmanı üretmeye başlıyor.**

Bu özellikle iki noktada görünür:
1. **Reputation/dispute sonucu yorumları**
2. **Off-chain mirror ile analytics alanlarının sınırlarının açık olmaması**

### Güncellenmiş karar ilkesi

Bundan sonra şu sınıflandırma esas alınmalıdır:

- **On-chain authority:** Gerçek kaynak kontrattır
- **Mirror of on-chain:** DB’de kontratın aynası olarak tutulan alanlar
- **Cache-only:** UI ve performans için tutulan yardımcı alanlar
- **Analytics-only:** Hiçbir enforcement kararında kullanılmaması gereken türetilmiş alanlar

Bu ayrım, sistemin bundan sonraki tüm reward/tier/gösterim tasarımında bağlayıcı olmalıdır.

---

### 3.3. Minimum altyapı ve düşük maliyet

Kurucu hedef:

- pahalı oracle katmanı olmadan çalışmak,
- moderasyon / support / arbitratör yükünü azaltmak,
- L2 üzerinde hafif bir altyapıyla ilerlemek.

### Değerlendirme

Bu hedef mimari olarak başarılı:

- Base L2 seçimi mantıklı,
- oracle katmanı yok,
- klasik escrow platformuna göre daha hafif sunucu mimarisi var,
- backend signer/relayer custody modeli kullanılmıyor.

Ama önemli gerçek şu:

> **Sunucu maliyeti düşük tutulurken, operasyonel tutarlılık maliyeti yükselmiş durumda.**

Bunun sebebi:
- event replay,
- DLQ,
- checkpoint,
- reconnect,
- receipt cleanup,
- nonce/refresh/JWT/Redis davranışları,
- off-chain mirror consistency.

### Hüküm

**Infra-cost hedefi doğru.**  
Ama sistem artık ucuz olsa da basit değil.

---

### 3.4. Oracle problemini ekonomik/psikolojik teşvikle çözme hedefi

Kurucu hedef:

- “gerçeği bilen” oracle kullanmamak,
- insanlar arası sürtüşmeyi ekonomik oyuna çevirmek,
- dürüstsüzlüğü pahalılaştırmak.

### Değerlendirme

Bu, Araf’ın en özgün ve değerli tarafıdır.

Bleeding Escrow modeli, grace period, decay, burn, autoRelease ve karşılıklı iptal akışı bu düşünceyi güçlü biçimde taşıyor.

Ancak modelin sınırı doğru anlatılmalı:

- Sistem “haklı tarafı bulmaz”.
- Sistem “hakikati doğrulamaz”.
- Sistem yalnızca uzatılmış çatışmayı pahalılaştırır.

Dolayısıyla güvenlik anlatısı şu şekilde kurulmalıdır:

> **Araf oracle-free truth engine değildir; Araf oracle-free settlement pressure engine’dir.**

---

## 4. Genel hüküm

Araf Protocol’ün **felsefesi sağlamdır**.  
Sorun felsefede değil.

Sorun şudur:

> **Bugünkü kod tabanı, bu felsefenin tamamını henüz aynı netlikte taşımıyor.**

Bu nedenle proje bugün şu sınıfa girer:

> **Fikren güçlü, uygulamada henüz tam hizalanmamış sistem**

Ve launch readiness açısından güncel sonuç:

> **Doğrudan geniş ölçekli mainnet çıkışı için henüz uygun değil.  
> Ancak doğru minimum düzeltmelerle, kısıtlı TVL ve sıkı operasyon prosedürü altında guarded launch tartışılabilir.**

---

## 5. Canonical karar çerçevesi

## 5.1. State machine authority

Kontrat, sistemin kanonik state machine kaynağıdır.

Özet akış:
- `OPEN -> LOCKED -> PAID`
- `PAID -> RESOLVED`
- `PAID -> CHALLENGED -> BURNED`
- `LOCKED/PAID/CHALLENGED -> CANCELED` (kontrat koşullarına göre)

Ekonomik gerçekler:
- `LOCKED` aşamasında mutual cancel fee’siz olabilir
- `PAID/CHALLENGED` aşamasında cancel fee davranışı farklılaşır
- `autoRelease` ihmal cezası kontrat sabitleriyle belirlenir
- `burnExpired` permissionless ve treasury’ye akış üretir

Tüm off-chain katmanlar bu gerçeği sadece **yansıtmalı**, yeniden yorumlamamalıdır.

---

## 5.2. Enforcement-grade vs analytics-only kararları

Bu raporun en kritik yeni sonuçlarından biri şudur:

### Enforcement-grade metrik
- `failedDisputes`  
Bu metrik:
- ban,
- tier eligibility,
- reward eligibility,
- ceza escalasyonu,
- güvenlik kararı

gibi enforcement sonuçlarında kullanılabilir.

### Analytics-only metrik
- `failure_score`  
Bu alan:
- dashboard,
- fraud/risk görünürlüğü,
- support önceliklendirme,
- segmentasyon

için kullanılabilir.

Ama **asla** şu kararlar için kullanılmamalıdır:
- tier düşürme/yükseltme
- reward kesme
- ban verme
- kontrat reputasyonunu override etme
- cezai sonuç üretme

### Bağlayıcı ilke

> **Tier, reward, penalty ve ban kararları yalnızca on-chain authority veya onun birebir off-chain mirror’u üzerinden verilir; analytics-only alanlar hiçbir enforcement kararında kullanılamaz.**

---

## 5.3. Data taxonomy (yeni bağlayıcı sınıflandırma)

### A) On-chain authority
- Kontrat state’i
- Kontrat reputasyon alanları
- Kontrat sabitleri ve ekonomik parametreler

### B) Mirror of on-chain
Örnek alanlar:
- `Trade.status`
- `Trade.timers.*`
- `User.reputation_cache.failed_disputes`
- `User.is_banned`
- `User.banned_until`

Bu alanlar DB’dedir ama otorite değildir; kontratın aynasıdır.

### C) Cache-only
Örnek:
- frontend hızlı render için kullanılan kopyalar
- performans amaçlı snapshot alanları

### D) Analytics-only
Örnek:
- `failure_score`
- türetilmiş risk skorları
- bazı dashboard sayaçları

Bu ayrım net biçimde dokümante edilmelidir.

---

## 6. Birleşik ana bulgular (güncellenmiş)

## 6.1. P0 — Guarded launch öncesi zorunlu kapanması gereken bulgular

### P0-1 — Enforcement vs analytics ayrımı bugün yeterince sert değil

`failedDisputes` ile `failure_score` aynı semantik kategorideymiş gibi davranma riski var.  
Kontratın otoritatif cezai metriği ile backend’in analytics amaçlı metriği net ayrılmadan:

- tier sistemi,
- reward sistemi,
- risk sınıflaması,
- kullanıcı görünümü

yanlış temele oturabilir.

**Karar:** Bu ayrım yazılı, testli ve isimlendirme düzeyinde sertleştirilmeden guarded launch önerilmez.

---

### P0-2 — Event listener / schema drift kritik seviyede

`Trade` ve `User` modelleri ile worker/event listener’ın yazdığı alanlar tam hizalı değil.

Özellikle riskli alanlar:
- `financials.crypto_amount` type drift
- `decay_tx_hashes`
- `decayed_amounts`
- `total_decayed_num`
- `cancel_proposal.proposed_at`
- benzeri schema dışı yazımlar

Bu, sessiz veri bozulması üretir.

**Karar:** Şema ve listener tam hizalanmadan enforcement veya reward genişlemesi yapılmamalı.

---

### P0-3 — Deploy hard guard’ları ve yanlış-ortam koruması yeterince sert değil

Riskler:
- yanlış `NODE_ENV`
- yanlış chain
- mock deploy yolu
- supported token eksikliği
- ownership devri sırası
- FE env auto-write riskleri

**Karar:** Guarded launch öncesi prod deploy pipeline explicit ve fail-fast hale getirilmelidir.

---

### P0-4 — Finansal veri tipi kararları net değil

Canonical finansal alanlarla analytics/gösterim alanları ayrılmamış durumda.

Özellikle:
- `crypto_amount`
- `total_decayed`
- benzeri finansal alanlar

tek semantik ve tek tip kararı gerektirir.

**Karar:** String / Decimal128 / Number kararı net verilmeden veri yüzeyi büyütülmemeli.

---

## 6.2. P1 — Go-live öncesi güçlü biçimde düzeltilmesi gereken bulgular

### P1-1 — Mimari anlatı ile gerçek ürün davranışı aynı şey değil

Docs, kontrat, backend event mirror ve frontend UX tam aynı gerçeği anlatmıyor.

---

### P1-2 — Privacy iddiaları fazla geniş

Yanlış veya fazla iddialı olabilecek ifadeler:
- “zero-knowledge”
- “backend göremez”
- “tam anonim”
- “never stored”

Bugünkü sistem için doğru çerçeve:
- privacy-minimized
- encrypted at rest
- controlled runtime decryption
- metadata-minimized, not metadata-free

---

### P1-3 — Auth modeli anlatıdan farklı

Bearer JWT anlatısı ile cookie tabanlı gerçek auth modeli ayrışıyor.

---

### P1-4 — ABI için tek gerçek kaynağı yok

Artifact üretiliyor, frontend elle yazılmış ABI kullanıyor.

---

### P1-5 — Receipt lifecycle enforcement görünürlüğü eksik

Receipt TTL/cleanup davranışı kısmen tasarlanmış olsa da runtime scheduling ve enforcement yüzeyi yeterince açık değil.

---

### P1-6 — Chargeback acknowledgment gerçek enforcement değil

Bugün release akışında helper telemetri gibi davranıyor.  
Bu alanın:
- ya enforcement kuralı olması,
- ya da açıkça analytics/UI helper olarak tanımlanması gerekir.

---

### P1-7 — Fatal process davranışı mainnet-grade değil

`uncaughtException` ve `unhandledRejection` sadece loglanıyor, süreç sonlandırılmıyor.

---

### P1-8 — Trust proxy koşulları açıkça sınırlandırılmalı

Koşulsuz trust proxy yalnızca güvenilen ingress topolojisinde kabul edilebilir.

---

## 6.3. P2 — İlk faz sonrası kapatılması gereken bulgular

### P2-1 — Docs drift ve ekonomi dili temizliği
Cooldown, penalty, cancel fee gibi alanlar kontratla birebir hizalanmalı.

### P2-2 — PENDING -> OPEN yaşam döngüsü kırılgan
Event gecikmesi ve cleanup job birleşiminde görünmez ilan riski var.

### P2-3 — Off-chain mirror spec yazılı değil
Event listener ile DB şeması ve frontend beklentileri arasında yazılı sözleşme yok.

### P2-4 — Frontend monolitik ve bakım riski yüksek
`App.jsx` teknik borç yaratıyor ama bu tek başına blocker değil.

### P2-5 — Client localStorage hijyeni iyileştirilmeli
Pending tx metadata ve benzeri alanlar daha sıkı hijyen ister.

---

## 7. Governance kararı (güncellenmiş)

## 7.1. Önceki v2 kararı neden değişti?

Önceki sürümde multisig yönünde daha sert bir ton vardı.  
Sonraki analizler ve pratik kısıtlar sonucunda bu karar kalibre edildi.

### Yeni karar

> **Multisig ideal çözümdür; ancak guarded launch için bu aşamada zorunlu tek şart değildir.**

Bunun yerine aşağıdaki model kabul edilebilir:

## 7.2. Geçici tek-admin governance modeli

Aşağıdaki şartlarla geçici olarak kabul edilebilir:

- `deployer != owner != treasury`
- Owner günlük kullanılan cüzdan olmamalı
- Tercihen donanım cüzdan / soğuk kullanım olmalı
- Owner yüzeyi minimumda tutulmalı
- Mainnet deploy script’te hard guard olmalı
- FE env auto-write prod’da kapalı olmalı
- Admin işlemleri için:
  - manual timelock,
  - second-person review,
  - yazılı checklist,
  - tx simulation,
  - post-state doğrulaması
  zorunlu olmalı

## 7.3. Bu model ne zaman kabul edilemez hale gelir?

Aşağıdaki koşullardan biri gerçekleşirse:
- TVL belirgin artarsa
- reward/tier enforcement genişlerse
- owner işlemleri sıklaşırsa
- 7/24 operasyonel tempo oluşursa
- yönetim yüzeyi büyürse

> **multisig’e geçiş artık ertelenmemelidir.**

## 7.4. Dokümantasyonda dürüst anlatım

> **Mainnet’in ilk aşamasında yönetişim yüzeyi minimum tutulmuş tek-admin modeliyle çalışacaktır. Kritik yönetim fonksiyonları sınırlıdır; owner, deployer ve treasury adresleri ayrıdır. Bu model geçici olup, protokol olgunlaştıkça multisig yönetişime geçiş hedeflenmektedir.**

---

## 8. Privacy ve threat model için nihai dürüst dil

## 8.1. What Araf Is

- On-chain state machine ile çalışan non-custodial escrow protokolü
- İnsan hakemi kullanmayan ekonomik uzlaşma sistemi
- Uyuşmazlığı pahalılaştıran, hakikati doğrulamayan oyun teorisi motoru
- Minimum veri tutmayı hedefleyen hibrit sistem

## 8.2. What Araf Is Not

- Haklı tarafı bulan oracle sistemi değil
- Human arbitration platformu değil
- Tam anonim sistem değil
- Zero-knowledge veya server-blind olduğu bugünkü haliyle iddia edilemez
- Backend’i tümden kör kılan bir model değil
- Reversible fiat riskini ortadan kaldıran sistem değil

## 8.3. Kişisel veri ve metadata ayrımı

### Sensitive user data
- bank owner
- iban
- telegram
- encrypted receipt content

### Operational metadata
- wallet address
- auth logs
- route access izleri
- IP / IP hash
- user-agent
- stack/component logları
- trade access timestamp’leri

Bu ayrım açık biçimde docs’a yazılmalıdır.

---

## 9. Codex sonuçlarının güncellenmiş danışman kalibrasyonu

Codex analizleri genel olarak çok faydalı oldu. Özellikle şu yeni katkılar bu v3’te bağlayıcı hale getirildi:

1. **Canonical outcome matrix yaklaşımı**
2. **Enforcement-grade vs analytics-only ayrımı**
3. **Schema drift’in sessiz veri bozulması olarak tanımlanması**
4. **Geçici tek-admin governance modelinin koşullu kabulü**
5. **Privacy-minimized vs server-blind ayrımının netleştirilmesi**
6. **“What Araf Is / Is Not” ürün dilinin dürüstleştirilmesi**

Buna karşılık hâlâ dikkat edilmesi gereken nokta:
- Codex, keşif fazında gereksiz commit/doc değişikliği yapmamalı.
- Önce analiz, sonra patch planı, en son değişiklik akışı korunmalı.

---

## 10. Güncellenmiş sistem düzenleme planı

## 10.1. P0 görevler

### Görev 1 — Enforcement vs analytics ayrımını yazılı ve testli hale getir
- `failedDisputes` enforcement-grade
- `failure_score` analytics-only
- allowed / forbidden usage listesi çıkar
- isimlendirmeyi gerekirse sertleştir

### Görev 2 — Event listener / schema tam hizalaması
- worker’ın yazdığı tüm field’leri listele
- model ile birebir hizala
- authoritative / mirror / cache / analytics sınıflandır
- schema dışı yazımları kapat

### Görev 3 — Finansal veri tipi kararı
- `crypto_amount`
- `total_decayed`
- diğer finansal alanlar için
tek tip ve tek semantik kararı ver

### Görev 4 — Deploy hard guard sertleştirme
- explicit mainnet guard
- chain id hard fail
- mock deploy prod’da fiziksel kapatma
- supported token assert
- ownership devri öncesi smoke checks
- FE env auto-write kapatma

### Görev 5 — Guarded launch governance prosedürü
- deployer / owner / treasury ayrımı
- manual timelock
- second review
- tx simulation
- post-state assert
- owner işlem kayıt defteri

---

## 10.2. P1 görevler

### Görev 6 — Auth modeli ve docs hizalaması
### Görev 7 — Receipt lifecycle enforcement görünürlüğü
### Görev 8 — ABI tek kaynak modeli
### Görev 9 — Chargeback ack kararını netleştirme
### Görev 10 — Fatal process / shutdown politikasını netleştirme
### Görev 11 — Privacy model ve threat model dokümanlarını yazma

---

## 10.3. P2 görevler

### Görev 12 — Frontend parçalama
### Görev 13 — Listing yaşam döngüsü stabilizasyonu
### Görev 14 — Log/metadata minimizasyonu
### Görev 15 — Server-blind PII geçiş tasarımı

---

## 11. Guarded launch için güncellenmiş kapanış checklist

Aşağıdaki maddeler kapanmadan guarded launch önerilmemeli:

1. Enforcement vs analytics ayrımı yazılı ve testli hale geldi
2. Event listener ve schema drift kapatıldı
3. Finansal veri tipleri netleştirildi
4. Prod deploy guard sertleştirildi
5. Mainnet token/runbook tamamlandı
6. Geçici tek-admin governance prosedürü yazıldı
7. Auth modeli ve docs hizalandı
8. Receipt cleanup enforcement netleştirildi
9. ABI tek kaynak yapısına geçirildi
10. Fatal process / shutdown SOP tamamlandı
11. Threat model güncellendi
12. Privacy dili gerçeğe göre daraltıldı
13. Mainnet smoke test ve incident runbook yazıldı

---

## 12. Son söz

Araf Protocol’ün temel fikri güçlüdür:

- insan hakemini kaldırır,
- hakikati ölçmeye çalışmaz,
- dürüstsüzlüğü ve uzlaşmazlığı pahalılaştırır,
- custody’yi zincirde bırakır,
- kullanıcıdan minimum gerekli veriyi toplamayı hedefler.

Bugün için sorun fikirde değil;  
**uygulama, dokümantasyon ve off-chain yansıtma katmanlarının bu fikri tam aynı doğrulukta taşımamasındadır.**

Bu nedenle güncel karar şudur:

> **Araf bugün geniş ölçekli “mainnet-ready” değildir.  
> Ama doğru yeniden hizalama ile, kısıtlı ve disiplinli bir guarded launch adayıdır.**

Ve uzun vadeli yön şu olmalıdır:

> **Mevcut privacy-minimized modelden, yalnızca trade taraflarının client-side okuyabildiği server-blind PII modeline geçiş.**

---

## 13. Ek: Codex ile çalışma prensibi (güncellenmiş)

Codex’e bundan sonra yalnızca “bug bul” diye değil, şu çerçevede görev verilmelidir:

1. **Kanonik sistem davranışını yaz**
2. **Bu davranışın kontrat karşılığını doğrula**
3. **Backend/event mirror aynı şeyi yapıyor mu kontrol et**
4. **Frontend aynı sonucu mu gösteriyor bak**
5. **Docs aynı şeyi mi anlatıyor kıyasla**
6. **Uyumsuzluk varsa önce patch planı üret**
7. **Analiz fazında commit/PR/dosya değişikliği yapma**
8. **Patch ve test ancak karar netleştikten sonra gelsin**

Bu yaklaşım, dağınık güvenlik avcılığından daha verimli olacaktır.
