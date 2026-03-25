# Araf Protocol — Birleşik Mimari, Güvenlik ve Guarded Launch Readiness Raporu (TR)

> Sürüm: v4  
> Hazırlayan yaklaşım: Mimari-tez analizi + kod/uygulama uyumu + Codex bulgularının danışman kalibrasyonu + repo içi çapraz doğrulama  
> Amaç: Kurucu prensipleri, fiili teknik davranışı, kullanıcı teyitlerini ve guarded launch kararını tek belgede hizalamak

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
- backend’in kullanıcı fonlarını hareket ettiren bir custody signer modeli yok.

Ama iki önemli netleştirme gerekiyor:

1. **Backend tamamen “anahtarsız” değildir.** `reputationDecay` işi için `RELAYER_PRIVATE_KEY` ile automation signer yükleniyor. Bu signer kullanıcı fonlarını taşımaz; fakat “backend hiçbir private key taşımaz” anlatısı artık literal olarak doğru değildir.
2. **Kontrat tek otorite olmak isterken, backend bazı konularda ikinci bir yorum katmanı üretmeye başlıyor.**

Bu özellikle iki noktada görünür:
1. **Reputation/dispute sonucu yorumları**
2. **Off-chain mirror ile analytics alanlarının sınırlarının açık olmaması**
3. **Mirror alanların bir kısmının stale kalması ama yine de başka job/route’lar tarafından kullanılması**

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
- kullanıcı fonlarını yöneten bir backend custody katmanı yok.

Ama önemli gerçek şu:

> **Sunucu maliyeti düşük tutulurken, operasyonel tutarlılık maliyeti yükselmiş durumda.**

Buna ek olarak, sistem artık sadece “hafif backend” değil; aynı zamanda şu operasyonel yüzeyleri doğru işletmek zorunda:
- event replay ve checkpoint yönetimi
- DLQ davranışı ve yeniden işleme
- receipt / snapshot retention enforcement
- JWT / refresh / Redis hata modları
- deploy runbook ve supported token açılışı
- health/readiness sinyallerinin doğruluğu

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

## 6. Birleşik ana bulgular (repo doğrulaması sonrası v4)

Bu bölüm, üç kaynağın birleşik sonucudur:

1. İlk birleşik v3 rapor
2. Kullanıcı tarafından yapılan satır-satır repo doğrulaması
3. Repo üzerinde yapılan ek çapraz inceleme

Aşağıdaki maddeler launch kararında esas alınmalıdır.

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

Somut drift alanları:
- `financials.crypto_amount` type drift
- `financials.decay_tx_hashes`
- `financials.decayed_amounts`
- `financials.total_decayed_num`
- `cancel_proposal.proposed_at`
- `cancel_proposal.approved_by`
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

Ek olarak kritik bir operasyonel risk daha var:

> **Production deploy script’i supported token’ları otomatik açmıyor.**

Bu, kontratın başarıyla deploy edilip `createEscrow()` çağrılarının `TokenNotSupported()` ile tamamen fail etmesine yol açabilir.

**Karar:** Guarded launch öncesi prod deploy pipeline explicit ve fail-fast hale getirilmelidir; prod’da desteklenecek token’ların açıldığı zincir üstü runbook script seviyesinde ya garanti edilmeli ya da deployment tamamlanmış sayılmamalıdır.

---

### P0-4 — Finansal veri tipi kararları net değil

Canonical finansal alanlarla analytics/gösterim alanları ayrılmamış durumda.

Özellikle:
- `crypto_amount`
- `total_decayed`
- `total_decayed_num`
- `decayed_amounts`
- benzeri finansal alanlar

tek semantik ve tek tip kararı gerektirir.

**Karar:** String / Decimal128 / Number kararı net verilmeden veri yüzeyi büyütülmemeli.

---

### P0-5 — Canlı event kaybı hâlâ mümkün; bu guarded launch blocker’dır

Bugünkü worker akışında şu kombinasyon kritik risk üretir:

- canlı dinlemede işlenemeyen event DLQ’ya düşer,
- buna rağmen blok bazlı periyodik checkpoint ileri gidebilir,
- reconnect sonrasında kaçan event’ler için zorunlu replay garantisi yoktur,
- DLQ processor gerçek retry yapmaz; loglayıp entry’leri tüketir.

Bu, geçici RPC veya DB hatasının **kalıcı off-chain mirror divergence** üretmesi anlamına gelir.

Etkilenebilecek yüzeyler:
- Trade status mirror
- receipt / timer alanları
- reputation mirror
- decay / burn telemetri alanları

**Karar:** Event delivery semantiği “at least once + idempotent replay” seviyesine yükseltilmeden guarded launch önerilmez.

---

## 6.2. P1 — Go-live öncesi güçlü biçimde düzeltilmesi gereken bulgular

### P1-1 — Mimari anlatı ile gerçek ürün davranışı aynı şey değil

Docs, kontrat, backend event mirror ve frontend UX tam aynı gerçeği anlatmıyor. Özellikle:
- cancel fee davranışı
- auth modeli
- privacy dili
- deploy varsayımları
- mirror alanların anlamı

aynı netlikte anlatılmıyor.

---

### P1-2 — Privacy ve “anahtarsız backend” iddiaları fazla geniş

Yanlış veya fazla iddialı olabilecek ifadeler:
- “zero-knowledge”
- “backend göremez”
- “tam anonim”
- “never stored”
- “backend hiçbir private key taşımaz”

Bugünkü sistem için doğru çerçeve:
- privacy-minimized
- encrypted at rest
- controlled runtime decryption
- metadata-minimized, not metadata-free
- user-funds custody key yok; fakat automation amaçlı relayer signer var

---

### P1-3 — Auth modeli ve auth dokümantasyonu kısmen hizasız

Genel sorun artık “Bearer JWT vs cookie auth” kadar geniş değil; daha somut hale gelmiştir:

- auth akışı pratikte cookie tabanlıdır,
- PII token ayrı ve Bearer’dır,
- docs tarafında `SameSite=Strict` anlatılırken kod `sameSite: "lax"` kullanmaktadır,
- SIWE URI doğrulaması `startsWith()` ile yapıldığı için exact origin doğrulaması kadar sert değildir.

**Karar:** Bu alan genel anlatı düzeyinde değil, spesifik davranış düzeyinde hizalanmalıdır.

---

### P1-4 — ABI için tek gerçek kaynağı yok

Artifact üretiliyor, frontend ise elle yazılmış inline ABI kullanıyor.  
Bu durum, kontrat geliştikçe sessiz kırılmalara yol açabilir.

---

### P1-5 — Receipt cleanup yalnızca “görünürlük eksikliği” değil; job fiilen yok

Model ve yorumlarda `cleanupReceipts` varsayılıyor, `receipt_delete_at` alanı ve index’i mevcut; ancak schedule edilen job’lar arasında bu iş görünmüyor ve beklenen dosya da repo’da mevcut değil.

Bu nedenle bugünkü durum:
- retention intention var,
- fakat runtime enforcement yok.

**Karar:** Receipt lifecycle ancak job yazılıp schedule edilirse enforcement sayılmalıdır.

---

### P1-6 — PII snapshot retention enforcement da eksik görünüyor

`pii_snapshot.snapshot_delete_at` alanı var ve worker LOCKED anında bunu set ediyor. Ancak startup’ta bu alanı temizleyecek bir scheduled cleanup job görünmüyor.

Bu, receipt cleanup eksikliğiyle aynı sınıfta ikinci retention drift’tir.

---

### P1-7 — `consecutive_bans` ve `max_allowed_tier` yalnızca stale mirror değil; başka işi de bozabilir

Event listener bu iki alanı açıkça güncellemediğini söylüyor. Buna rağmen `reputationDecay` job’u aday seçerken `consecutive_bans > 0` filtresine dayanıyor.

Sonuç olarak:
- DB mirror yanıltıcı kalabilir,
- clean slate automation eksik veya yanlış aday seçebilir.

**Karar:** Bu alanlar ya tamamen kaldırılmalı, ya read-through on-chain modeline dönmeli, ya da senkronizasyon gerçekten tamamlanmalıdır.

---

### P1-8 — DLQ retry değil, yalnızca gözlem/temizlik yapıyor

DLQ processor ismi “işleme/iyileştirme” çağrışımı yapsa da fiili davranış şudur:
- entry’leri loglar,
- bir kısmını arşivler,
- sonra kuyruktan siler.

Bu yüzden DLQ bugün recovery katmanı değil, post-mortem gözlem katmanıdır.

---

### P1-9 — Fatal process davranışı mainnet-grade değil

`uncaughtException` ve `unhandledRejection` sadece loglanıyor, süreç sonlandırılmıyor.  
Bu durumda container/orchestrator devreye girmez ve uygulama bozuk yarı-canlı halde kalabilir.

---

### P1-10 — `/health` endpoint’i readiness değil, iyimser liveness sinyali veriyor

Endpoint statik olarak `worker: "active"` dönüyor; aşağıdakileri doğrulamıyor:
- provider bağlı mı
- replay geride mi
- Redis / Mongo gerçekten sağlıklı mı
- worker son checkpoint’i ilerletiyor mu

**Karar:** Mainnet için health/readiness ayrımı yapılmalı.

---

### P1-11 — Trade route’larında veri minimizasyonu iyileştirilmeli

Bazı trade endpoint’leri full `Trade` document döndürüyor. Yetkili taraf erişse bile şu alanların gereksiz exposure riski var:
- `evidence.receipt_encrypted`
- `pii_snapshot.*`
- cancel imzaları
- `chargeback_ack.ip_hash`

**Karar:** Route projection’ları daraltılmalı; “bu alan var diye client’a döndür” anlayışı bırakılmalı.

---

### P1-12 — Checkpoint kaybında genesis replay operasyonel risk oluşturur

Checkpoint Redis’te yoksa replay blok 0’dan başlıyor. Base mainnet’te bu:
- gereksiz RPC yükü
- uzun cold start
- timeout / rate limit riski
- restart anında kısmi servis dışılık

üretir.

**Karar:** Production için sabit bir `START_BLOCK` / deploy block referansı kullanılmalıdır.

---

### P1-13 — Trust proxy koşulları açıkça sınırlandırılmalı

Koşulsuz trust proxy yalnızca güvenilen ingress topolojisinde kabul edilebilir.  
Bu konu deployment dokümanında açıkça sınırlandırılmalıdır.

---

## 6.3. P2 — İlk faz sonrası kapatılması gereken bulgular

### P2-1 — Docs drift ve ekonomi dili temizliği
Cooldown, penalty, cancel fee, auth ve privacy dili kontratla ve runtime ile birebir hizalanmalı.

### P2-2 — PENDING -> OPEN yaşam döngüsü kırılgan ama tamamen sahipsiz değil
`cleanupPendingListings` job’u mevcut ve stale PENDING ilanları temizliyor. Bu nedenle sorun “hiç ele alınmamış” değil; ancak event gecikmesi, matching race ve cleanup kombinasyonu hâlâ kırılganlık üretir.

### P2-3 — Off-chain mirror spec yazılı değil
Event listener ile DB şeması ve frontend beklentileri arasında yazılı sözleşme yok. Mirror alanların authority seviyesi de açık değil.

### P2-4 — Frontend monolitik ve bakım riski yüksek
`App.jsx` teknik borç yaratıyor ama bu tek başına blocker değil.

### P2-5 — Client localStorage hijyeni iyileştirilmeli
Pending tx metadata ve benzeri alanlar daha sıkı hijyen ister.

### P2-6 — JWT blacklist Redis arızasında fail-open davranıyor
Redis geçici erişilemezse blacklist kontrolü “engelleme” yerine “izin verme” tarafına düşüyor. Bu doğrudan sistem kırıcı değildir, ama logout kesinliğini zayıflatır.

---

## 6.4. Kullanıcı doğrulamasıyla teyit edilen ek maddeler

Aşağıdaki maddeler v3’te eksik veya fazla sert kalan alanların düzeltilmiş özetidir:

### Teyit edilen doğru maddeler
- enforcement vs analytics ayrımı sorunu gerçek
- schema drift gerçek
- deploy hard guard ihtiyacı gerçek
- finansal tip uyumsuzluğu gerçek
- ABI single-source sorunu gerçek
- fatal process davranışı gerçek
- privacy dili kalibrasyonu gerekli

### v3’ün kaçırdığı veya zayıf anlattığı maddeler
- `cleanupReceipts` job’u görünürlük sorunu değil, fiilen eksik
- DLQ retry yapmıyor
- `consecutive_bans` / `max_allowed_tier` mirror alanları stale
- `SameSite=Strict` docs vs `lax` runtime farkı somut bir drift
- `cancel_proposal.approved_by` de schema drift kapsamına giriyor

### v3’te fazla sert kalan maddeler
- `PENDING -> OPEN` akışı kırılgan olsa da cleanup job tamamen yok sayılmamalı
- auth ayrışması artık genel değil; asıl problem spesifik davranış drift’leridir
- governance değerlendirmesi deployer / owner / treasury ayrımını daha dikkatli okumalıdır


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
- bu ayrımı route, job, dashboard ve docs katmanında aynı dille uygula

### Görev 2 — Event listener / schema tam hizalaması
- worker’ın yazdığı tüm field’leri listele
- model ile birebir hizala
- authoritative / mirror / cache / analytics sınıflandır
- schema dışı yazımları kapat
- `approved_by`, `proposed_at`, decay alanları ve finansal yan alanlar için karar ver

### Görev 3 — Finansal veri tipi kararı
- `crypto_amount`
- `total_decayed`
- `total_decayed_num`
- `decayed_amounts`
- diğer finansal alanlar için
tek tip ve tek semantik kararı ver

### Görev 4 — Event delivery güvenilirliğini yeniden tasarla
- live listener başarısızlığında checkpoint ilerleme politikasını düzelt
- reconnect sonrası replay semantiğini zorunlu hale getir
- DLQ’yu gerçek retry / re-drive katmanına çevir
- idempotency anahtarlarını event bazında standartlaştır
- production için `START_BLOCK` / deploy block kullan

### Görev 5 — Deploy hard guard sertleştirme
- explicit mainnet guard
- chain id hard fail
- mock deploy prod’da fiziksel kapatma
- supported token assert
- ownership devri öncesi smoke checks
- FE env auto-write kapatma
- prod deploy tamamlanma koşuluna “token support enabled” maddesi ekle

### Görev 6 — Guarded launch governance prosedürü
- deployer / owner / treasury ayrımı
- manual timelock
- second review
- tx simulation
- post-state assert
- owner işlem kayıt defteri

---

## 10.2. P1 görevler

### Görev 7 — Auth modeli ve docs hizalaması
- SameSite anlatısını runtime ile hizala
- exact origin tabanlı SIWE URI doğrulamasına geç
- cookie / PII token ayrımını docs’ta sadeleştir

### Görev 8 — Receipt lifecycle enforcement’ı gerçekten çalıştır
- `cleanupReceipts` job’unu yaz
- startup scheduling’e ekle
- runbook ve alarm koşulu tanımla

### Görev 9 — PII snapshot retention cleanup ekle
- `snapshot_delete_at` enforcement job’u ekle
- snapshot temizliğini receipt lifecycle’dan bağımsız ama tutarlı kurgula

### Görev 10 — ABI tek kaynak modeli
- artifact -> frontend tüketimi tek yola indir
- inline ABI kullanımını kaldır ya da build-time doğrulamaya bağla

### Görev 11 — `consecutive_bans` / `max_allowed_tier` kararını netleştir
- bu alanları ya senkronize et
- ya on-chain read-through kullan
- ya da DB mirror olarak tamamen kaldır
- `reputationDecay` aday seçimini stale alanlardan kurtar

### Görev 12 — Chargeback ack kararını netleştirme
- enforcement mi
- telemetri mi
- legal acknowledgement mı

tek satırlık kanonik kararla tanımla

### Görev 13 — Fatal process / readiness politikasını netleştirme
- fatal exception sonrası exit davranışı
- liveness vs readiness ayrımı
- `/health` endpoint’ini gerçek dependency kontrolleriyle güçlendir

### Görev 14 — Privacy model ve ürün dilini dürüstleştirme
- “zero private key backend” ifadesini düzelt
- relayer signer varlığını doğru anlat
- privacy-minimized vs server-blind ayrımını docs’ta sabitle

### Görev 15 — Route projection ve veri minimizasyonu
- trade endpoint projection’larını daralt
- gereksiz encrypted payload alanlarını response’lardan çıkar
- client’a sadece gerekli alanları döndür

---

## 10.3. P2 görevler

### Görev 16 — Frontend parçalama
### Görev 17 — Listing yaşam döngüsü stabilizasyonu
### Görev 18 — Log/metadata minimizasyonu
### Görev 19 — JWT/Redis hata modları için daha sert auth davranışı
### Görev 20 — Server-blind PII geçiş tasarımı

---

## 11. Guarded launch için güncellenmiş kapanış checklist

Aşağıdaki maddeler kapanmadan guarded launch önerilmemeli:

1. Enforcement vs analytics ayrımı yazılı ve testli hale geldi
2. Event listener ve schema drift kapatıldı
3. Finansal veri tipleri netleştirildi
4. Live event loss / checkpoint drift kapatıldı
5. Prod deploy guard sertleştirildi
6. Supported token runbook ve prod deploy assert tamamlandı
7. Mainnet start block / replay stratejisi yazıldı
8. Geçici tek-admin governance prosedürü yazıldı
9. Auth modeli ve docs hizalandı
10. SameSite ve SIWE URI doğrulaması gerçeğe göre düzeltildi
11. Receipt cleanup job’u yazıldı ve schedule edildi
12. PII snapshot cleanup enforcement eklendi
13. ABI tek kaynak yapısına geçirildi
14. `consecutive_bans` / `max_allowed_tier` mirror kararı netleştirildi
15. Fatal process / shutdown SOP tamamlandı
16. Health/readiness endpoint’leri ayrıştırıldı
17. Threat model güncellendi
18. Privacy dili gerçeğe göre daraltıldı
19. Trade response projection’ları daraltıldı
20. Mainnet smoke test, rollback ve incident runbook yazıldı

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

v4 değerlendirmesiyle bu hüküm biraz daha netleşmiştir:

> **Asıl risk kontrat çekirdeğinden çok, off-chain operasyonel doğruluk ve mirror güvenilirliğidir.**

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
9. **Özellikle event delivery, deploy runbook ve retention enforcement için ayrı görevler aç**
10. **Mirror alanları kullanmadan önce authority sınıfını sor**

Bu yaklaşım, dağınık güvenlik avcılığından daha verimli olacaktır.
