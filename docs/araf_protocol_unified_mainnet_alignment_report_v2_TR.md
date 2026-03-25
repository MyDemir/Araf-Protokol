# Araf Protocol — Birleşik Mimari, Güvenlik ve Mainnet Readiness Raporu (TR)

> Sürüm: v2  
> Hazırlayan yaklaşım: Mimari-tez analizi + kod/uygulama uyumu + Codex rapor kalibrasyonu  
> Amaç: Kurucu prensipleri, teknik gerçekliği ve release kararını tek belgede hizalamak

---

## 1. Bu dokümanın amacı

Bu doküman üç ayrı kaynağı tek çerçevede birleştirir:

1. **Kurucu tez ve sistem felsefesi**
2. **Kod tabanının mimari ve güvenlik açısından fiili davranışı**
3. **Codex tarafından üretilen mainnet readiness / güvenlik raporunun danışman kalibrasyonu**

Bu metin bir “tam ve nihai profesyonel audit sertifikası” değildir.  
Bunun yerine, **mainnet kararı vermek, dokümantasyonu düzeltmek, Codex ile uygulanabilir bir yeniden düzenleme yapmak ve ikinci faz kapsamlı araştırmayı yönlendirmek için hazırlanmış kanonik karar dokümanıdır.**

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

## 3. Kurucu prensipler ve değerlendirme

### 3.1. Gizlilik odaklı hedef

Kurucu hedef:

- kullanıcıdan minimum kişisel veri almak,
- yalnızca zorunlu banka bilgisi ve iletişim bilgisini tutmak,
- bunları da off-chain ve şifreli korumak,
- on-chain tarafı mümkün olduğunca PII’siz bırakmak.

### Değerlendirme

Bu hedef, repo içinde en iyi yansıtılmış alanlardan biridir.

Güçlü taraflar:

- PII verisi şifreli tutuluyor.
- AES-256-GCM + HKDF yaklaşımı düşünülmüş.
- Trade-scoped erişim ve aktif durum kontrolü var.
- LOCKED anında snapshot alınması veri bütünlüğü ve bait-and-switch önleme açısından doğru.

Sınırlar:

- Sistem “zero-knowledge” değil, **privacy-minimized** bir yapı.
- Backend bazı PII verilerini çözebiliyor.
- Metadata tarafında (özellikle log ve IP davranışında) “sıfır iz” seviyesi yok.

### Hüküm

**Prensip doğru ve büyük ölçüde korunmuş.**  
Ancak doğru anlatım şu olmalı:

> **Araf sıfır kişisel veri sistemi değil; minimum gerekli kişisel veri ile çalışan şifreli hibrit escrow sistemidir.**

---

### 3.2. Code is law hedefi

Kurucu hedef:

- hakem backend olmamalı,
- frontend karar verici olmamalı,
- gerçek karar ve state transition kontratta olmalı,
- backend yalnızca yardımcı/off-chain destek işlevi görmeli.

### Değerlendirme

Bu hedef kısmen güçlü biçimde gerçekleşmiş durumda:

- custody zincirde,
- state machine zincirde,
- release/challenge/burn gibi çekirdek işlemler zincirde,
- backend’in fon hareket ettiren bir özel anahtar katmanı görünmüyor.

Ama ana kırılma şurada:

> **Kontrat tek otorite olmak isterken, backend bazı konularda ikinci bir gerçeklik üretmeye başlıyor.**

En kritik örnek:
- reputasyon/dispute sonucu kontratta başka,
- event listener ve DB yansımasında başka yorumlanabiliyor.

Bu durum “code is law” ilkesini teoride değil, pratikte zayıflatır.

### Hüküm

**Custody ve çekirdek state transition seviyesinde code is law büyük ölçüde korunmuş.**  
Ancak **yorumlama, cache ve off-chain mirror seviyesinde** aynı ilke henüz tam hizalanmamış.

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
- klasik escrow platformuna göre çok daha hafif sunucu mimarisi var,
- backend signer/relayer custody modeli kullanılmıyor.

Ama burada önemli bir gerçek var:

> **Sunucu maliyeti düşük tutulurken, operasyonel tutarlılık maliyeti yükselmiş durumda.**

Neden?
- event replay,
- DLQ,
- checkpoint,
- reconnect,
- receipt cleanup,
- nonce/refresh/JWT/Redis davranışları,
- off-chain mirror consistency

gibi konular artık sistemin ana karmaşıklığını oluşturuyor.

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

Ancak bu modelin sınırı doğru anlatılmalı:

- Sistem “haklı tarafı bulmaz”.
- Sistem “hakikati doğrulamaz”.
- Sistem yalnızca uzatılmış çatışmayı pahalılaştırır.

Dolayısıyla güvenlik anlatısı şu şekilde kurulmalıdır:

> **Araf oracle-free truth engine değildir; Araf oracle-free settlement pressure engine’dir.**

### Hüküm

**Bu yaklaşım doğru, özgün ve savunulabilir.**  
Ama dokümantasyonda kapsamı doğru çizilmelidir.

---

## 4. Genel hüküm

Araf Protocol’ün **felsefesi sağlamdır**.  
Hatta birçok sıradan Web3 escrow tasarımına göre daha tutarlıdır.

Sorun felsefede değil.

Sorun şudur:

> **Bugünkü kod tabanı, bu felsefenin tamamını henüz aynı netlikte taşımıyor.**

Bu nedenle proje bugün şu sınıfa girer:

> **Fikren güçlü, uygulamada henüz tam hizalanmamış sistem**

Ve mainnet readiness açısından sonuç:

> **Doğrudan mainnet çıkışı için henüz uygun değil.  
> Önce sistem anlatısı, veri sözleşmeleri, deploy guard ve off-chain mirror uyumu stabilize edilmelidir.**

---

## 5. Birleşik ana bulgular

## 5.1. P0 — Mainnet öncesi zorunlu kapanması gereken bulgular

### P0-1 — On-chain / off-chain reputasyon ve dispute yorumu ayrışıyor

Bu sistemin en kritik bulgusudur.

Aynı dispute akışı kontratta ve backend event listener tarafında aynı şekilde yorumlanmıyor. Bu durumda:
- zincir başka şeyi söyler,
- backend DB başka şeyi saklar,
- frontend başka sonucu gösterebilir.

Bu yalnızca teknik bug değil, doğrudan tasarım ilkesine aykırıdır.

**Etkisi:**
- code-is-law ilkesini zayıflatır,
- kullanıcı güvenini bozar,
- tier/reward/ban mekaniklerini ileride temelden çarpıtabilir.

**Karar:** Mainnet öncesi kapanması zorunlu.

---

### P0-2 — Deploy guardrail’leri ve yanlış-ortam koruması yeterince sert değil

Mainnet deploy sürecinde:
- yanlış `NODE_ENV`,
- yanlış chain,
- mock deploy yolu,
- desteklenen token set edilmeden ownership devri,
- prod/non-prod ayrımının zayıf enforce edilmesi

gibi riskler mevcut.

Bu, iyi kontrat koduna rağmen yanlış deploy ile sistemi fiilen kullanılamaz ya da güvensiz hale getirebilir.

**Karar:** Mainnet pipeline explicit mainnet onayı, chain allowlist ve prod-only guard ile sertleştirilmeli.

---

### P0-3 — Treasury / ownership için güçlü governance zorunlu değil

Ownership’in tek EOA’ya devredilebilir olması mainnet için yeterli güvenlik seviyesi değildir.

Araf’ın ekonomik modeli ve pause/yönetim fonksiyonları düşünüldüğünde:
- Safe multisig,
- tercihen timelock,
- signer operasyon prosedürü

zorunlu hale getirilmelidir.

**Karar:** Mainnet öncesi governance hardening gerekli.

---

### P0-4 — Finansal veri modeli ile event işleyici arasında şema drift var

Bazı alanlar yorum düzeyinde string güvenliği ile ele alınırken, veri modeli `Number` kullanıyor. Ayrıca event listener’ın yazdığı bazı alanlar şemada tanımlı görünmüyor.

Bu, ileride:
- decay muhasebesi,
- reward katmanı,
- analytics,
- audit trail,
- idempotency

gibi alanlarda sessiz veri tutarsızlığı üretebilir.

**Karar:** Şema ve listener tam hizalanmadan tier/reward gibi yeni sistemler eklenmemeli.

---

## 5.2. P1 — Go-live öncesi güçlü biçimde düzeltilmesi gereken bulgular

### P1-1 — Mimari anlatı ile gerçek ürün davranışı aynı şey değil

Bugünkü repo içinde şu katmanlar tam aynı gerçeği anlatmıyor:
- `ARCHITECTURE.md`
- kontrat
- backend event mirror
- frontend UX akışı

Böyle bir durumda proje büyüdükçe ekip içi kararlar da tutarsızlaşır.

**Öneri:** Tek kanonik sistem anlatısı oluşturulmalı.

---

### P1-2 — Mimari dosyasının kendi içinde ekonomik model ve cooldown çelişkileri var

Aynı belge içinde:
- cooldown 24 saat / 4 saat,
- cancel fee var / yok,
- clean-slate reset davranışı farklı

şekilde anlatılmış.

Bu, ürünün yanlış anlaşılmasına yol açar.

---

### P1-3 — Auth modeli anlatıdan farklı

Doküman Bearer JWT anlatırken, uygulama cookie tabanlı auth kullanıyor.

Bu fark:
- tehdit modelini,
- CSRF/XSS değerlendirmesini,
- frontend entegrasyon mantığını

değiştirir.

---

### P1-4 — ABI için tek gerçek kaynağı yok

Deploy sırasında ABI artifact üretilmesine rağmen frontend elle yazılmış ABI kullanıyor.

Bu, kontrat güncellendiğinde sessiz uyumsuzluk üretme riskini artırır.

---

### P1-5 — Receipt deletion garantisi belgede net, runtime scheduling tarafında eksik

Receipt TTL alanları tanımlı ve bazı yerlerde set ediliyor; ancak cleanup akışının uygulama bootstrap tarafında açık biçimde zamanlandığı görünmüyor.

Bu konu hem gizlilik iddiası hem KVKK/GDPR anlatısı için önemlidir.

---

### P1-6 — Chargeback acknowledgment gerçek enforcement değil, yardımcı telemetri gibi çalışıyor

Chargeback ack teoride ciddi bir kanıt zinciri gibi sunuluyor; pratikte ise backend çağrısı başarısız olsa bile release akışı devam edebiliyor.

Bu konuda net karar gerekli:
- bu veri hukuki/iş mantığı için gerçekten zorunlu mu,
- yoksa sadece UI/telemetri mi?

---

### P1-7 — Fatal error davranışı mainnet-grade değil

`uncaughtException` ve `unhandledRejection` loglanıyor ama process sonlandırılmıyor.

Bu, bozulmuş süreçlerin yaşamaya devam etmesine neden olabilir.

---

### P1-8 — Trust proxy güven modeli açık biçimde şartlandırılmalı

Koşulsuz trust proxy yaklaşımı, yalnızca güvenilen ingress/reverse proxy topolojisinde kabul edilebilir.

Aksi halde IP tabanlı limit ve log güvenilirliği zayıflar.

---

## 5.3. P2 — İlk 30–90 gün içinde kapanması gereken bulgular

### P2-1 — Gizlilik dili gereğinden fazla iddialı

“Raw IP never stored” gibi ifadeler sistemin bütününü doğru yansıtmıyor.  
Doğru dil daha dar ve daha dürüst olmalı.

---

### P2-2 — PENDING → OPEN listing yaşam döngüsü operasyonel olarak kırılgan

Chain-first yaklaşım iyi niyetli ama event gecikmesi ve cleanup job mantığıyla birleşince görünmez ilan veya stale listing davranışı doğurabiliyor.

---

### P2-3 — Off-chain mirror katmanı için resmi bir sözleşme (spec) yok

Event listener, DB şeması ve frontend beklentileri arasında yazılı bir contract/spec bulunmuyor.

---

### P2-4 — Frontend monolitik ve bakım riski yüksek

Özellikle `App.jsx` büyüklüğü:
- regression riskini artırıyor,
- hızlı hotfix’i zorlaştırıyor,
- yeni feature’larda davranış sızıntısı üretebilir.

Bu önemli ama tek başına mainnet blocker değil; **yüksek teknik borç** olarak ele alınmalı.

---

### P2-5 — Client tarafı localStorage hijyeni iyileştirilmeli

Pending tx metadata gibi verilerin localStorage’da tutulması:
- XSS durumunda gereksiz metadata ifşası,
- istemci hijyeni zayıflığı

oluşturur.

Bu düşük/orta riskli, ama temizlenmesi doğru olur.

---

## 6. Codex raporunun danışman kalibrasyonu

Codex tarafından üretilen mainnet readiness raporu, **iyi bir release triage + backlog** taslağıdır.  
Ancak nihai güvenlik raporu kalibrasyonunda değildir.

### 6.1. Codex raporunda güçlü olan taraflar

- Sadece kontrata bakmıyor; backend, frontend, deploy ve operasyonu birlikte görüyor.
- “Koşullu Hold” sonucu yön olarak doğru.
- Deploy, governance, CI/release ve runbook ihtiyacını görünür kılıyor.
- Ekip yönetimi açısından görevleştirilebilir bir iskelet sunuyor.

### 6.2. Codex raporunda abartılı veya yeniden kalibre edilmesi gereken noktalar

Aşağıdaki maddeler önemlidir ama severity yeniden düşünülmelidir:

- `App.jsx` büyüklüğü → **BLOCKER değil, High maintainability risk**
- localStorage pending tx metadata → **BLOCKER değil, Low/Medium**
- trust proxy → **koşullu high**, mimari topolojiye bağlı
- bazı deploy/profile maddeleri → aynı kök problem altında birleştirilebilir

### 6.3. Codex raporunda eksik kalan kritik maddeler

Aşağıdakiler raporda mutlaka açık P0/P1 maddeleri olarak yer almalıdır:

1. On-chain / event listener reputasyon-dispute çelişkisi
2. Event listener ile `Trade` şeması arasında field drift
3. Receipt cleanup scheduling eksikliği
4. Chargeback ack’in “enforced business rule” değil “best-effort helper” gibi çalışması
5. Mimari belge ile gerçek auth modeli ayrışması

### 6.4. Codex raporu için doğru çerçeveleme

Bu belgeyi “tam audit” gibi değil, şu isimle konumlamak daha doğru olur:

> **Phase-1 Consolidated Mainnet Triage Report**

Yani:
- ilk konsolidasyon,
- karar destek,
- backlog üretimi,
- severity kalibrasyonu gereken ön rapor.

---

## 7. Sistem düzeyinde stratejik karar

Bu repo için önerilen ana strateji şudur:

> **Yeni özellik eklemeden önce sistem anlatısını ve veri sözleşmesini düzelt.**

Özellikle aşağıdaki planlanan gelecek işler:
- tier genişletmeleri,
- reward mekanizması,
- incentive/referral benzeri ekonomik katmanlar

mevcut tutarsızlıklar düzeltilmeden eklenirse, sorunları büyütür.

---

## 8. Dokümantasyon yeniden yapılanma planı

Bugünkü tek büyük mimari dosyayı birkaç ayrı belgeye bölmek daha sağlıklı olacaktır.

### 8.1. `docs/CORE_THESIS.md`

Kısa ve kurucu olmalı.

İçermesi gerekenler:
- proje tez cümlesi,
- ne olduğu,
- ne olmadığı,
- “truth engine değil settlement-pressure engine” açıklaması,
- tasarım sınırları.

---

### 8.2. `docs/ARCHITECTURE.md`

Yüksek seviyeli sistem görünümü.

İçermesi gerekenler:
- on-chain / off-chain ayrımı,
- custody modeli,
- auth modeli,
- privacy modeli,
- event mirror rolü,
- deploy ve ownership mantığı.

---

### 8.3. `docs/STATE_MACHINE.md`

Bu dosya kontrat ile birebir hizalı olmalı.

İçermesi gerekenler:
- tüm state’ler,
- hangi fonksiyon hangi state’i üretir,
- hangi outcome hangi reputasyon etkisini doğurur,
- cancel, release, burn, autoRelease sonuçları.

---

### 8.4. `docs/THREAT_MODEL.md`

İçermesi gerekenler:
- hangi saldırılar çözülmeye çalışılıyor,
- hangileri azaltılıyor,
- hangileri tamamen çözülemiyor,
- griefing / mule / chargeback / triangulation / sybil sınırları.

---

### 8.5. `docs/PRIVACY_MODEL.md`

İçermesi gerekenler:
- hangi veri neden tutuluyor,
- kim çözebilir,
- ne kadar süre tutulur,
- hangi metadata saklanır,
- hangi iddialar özellikle yapılmamalıdır.

---

### 8.6. `docs/OFFCHAIN_MIRROR_SPEC.md`

Bu belge çok kritik.

İçermesi gerekenler:
- event listener hangi event’i nasıl mirror eder,
- hangi alanlar authoritative değildir,
- DB alanları yalnızca cache mi, yoksa business logic girdisi mi,
- replay/idempotency kuralları,
- checkpoint/DLQ davranışı.

---

### 8.7. `docs/ECONOMICS_AND_INCENTIVES.md`

Buraya alınmalı:
- tier sistemi,
- collateral mantığı,
- decay modeli,
- reward sistemi tasarımı,
- fee modeli,
- future incentive roadmap.

---

### 8.8. `docs/MAINNET_READINESS.md`

Karar dosyası olmalı.

İçermesi gerekenler:
- P0 / P1 / P2 checklist,
- deploy runbook,
- smoke tests,
- incident response,
- “go / no-go” kriterleri.

---

## 9. Sistem düzenleme planı (Codex ile uygulanabilir görevler)

## 9.1. P0 görevler

### Görev 1 — Tek kanonik outcome mapping üret
Aşağıdaki sorular için tek gerçek tablo oluştur:
- `PAID -> releaseFunds()` sonucu kim kazanır?
- `CHALLENGED -> RESOLVED` reputasyon etkisi tam olarak nedir?
- `autoRelease` sonrası maker/taker sayaçları nasıl değişir?
- `burnExpired` sonrası her iki taraf için hangi reputasyon etkisi oluşur?
- `cancel` hangi state’lerde fee keser, hangilerinde kesmez?

Bu tablo:
- kontrat,
- backend event listener,
- docs,
- frontend text

tarafında aynı olmalıdır.

---

### Görev 2 — Event listener / Trade schema tam hizalaması
Yapılacaklar:
- listener’ın yazdığı tüm field’leri listele
- `Trade` şemasındaki tanımlarla karşılaştır
- eksik field’leri ekle ya da listener yazımlarını düzelt
- idempotency alanlarını açıkça tanımla
- “authoritative / approximate / cache-only” sınıflandırması yap

---

### Görev 3 — Deploy pipeline sertleştirme
Yapılacaklar:
- explicit `--mainnet` guard
- chain id hard fail
- mock deploy yolunu prod’da fiziksel kapat
- supported token doğrulaması
- ownership devrinden önce smoke checks
- post-deploy verify + sanity script

---

### Görev 4 — Governance hardening
Yapılacaklar:
- EOA yerine Safe multisig
- mümkünse timelock
- signer policy
- emergency pause/unpause SOP
- owner transfer acceptance checklist

---

## 9.2. P1 görevler

### Görev 5 — Auth modeli ve mimari belgenin hizalanması
Yapılacaklar:
- cookie auth gerçekliği docs’a geçir
- threat model’i buna göre yeniden yaz
- CSRF/XSS varsayımlarını açıklaştır
- frontend auth akışını dokümante et

---

### Görev 6 — Receipt lifecycle enforcement
Yapılacaklar:
- receipt cleanup job oluştur veya görünürleştir
- bootstrap scheduling’e ekle
- TTL path’leri test et
- dokümanda gerçek retention davranışını yaz

---

### Görev 7 — Chargeback ack kararını netleştir
İki yoldan biri seçilmeli:
1. gerçekten zorunlu iş kuralı ise release öncesi enforce et
2. sadece telemetri ise dokümanda öyle anlat

Ara durumda bırakılmamalı.

---

### Görev 8 — ABI tek kaynak modeli
Yapılacaklar:
- frontend hardcoded ABI’yi kaldır
- generated artifact/typed client kullan
- CI drift check ekle

---

### Görev 9 — Fatal error ve process health politikası
Yapılacaklar:
- uncaught fatal davranışını belirle
- readiness/liveness ayrımı yap
- shutdown timeout ekle
- supervisor altında restart stratejisi yaz

---

## 9.3. P2 görevler

### Görev 10 — `App.jsx` parçalama
Önerilen bölümler:
- auth/session
- profile/pii
- trade room
- marketplace
- stats/home
- modals
- hooks/services

---

### Görev 11 — Gizlilik dili temizliği
Yanlış veya aşırı iddialı cümleleri düzelt:
- “never stored”
- “zero data”
- “tam anonim”
- “tam hakem yok ama backend hiçbir etkide bulunamaz” gibi cümleler

Daha dürüst dil:
- minimum necessary data
- helper/off-chain mirror
- non-custodial but not zero-knowledge

---

### Görev 12 — Listing yaşam döngüsü stabilizasyonu
Yapılacaklar:
- PENDING -> OPEN geçişini test et
- stale cleanup davranışını gözden geçir
- event gecikmesinde UX fallback ekle
- görünmeyen ilan senaryolarını kapat

---

## 10. Mainnet kararı için kapanış checklist

Aşağıdaki maddeler kapanmadan “go” verilmemeli:

1. Reputasyon/dispute outcome mapping tekilleştirildi
2. Event listener ve schema drift kapatıldı
3. Prod deploy guard sertleştirildi
4. Mainnet token/runbook tamamlandı
5. Ownership multisig’e taşındı
6. Auth modeli ve docs hizalandı
7. Receipt cleanup enforcement netleştirildi
8. ABI tek kaynak yapısına geçirildi
9. Fatal process / shutdown SOP tamamlandı
10. Threat model güncellendi
11. Privacy model gerçek davranışla hizalandı
12. Mainnet smoke test ve incident runbook yazıldı

---

## 11. Son söz

Araf Protocol’ün temel fikri güçlüdür:

- insan hakemi kaldırır,
- hakikati ölçmeye çalışmaz,
- dürüstsüzlüğü ve uzlaşmazlığı pahalılaştırır,
- custody’yi zincirde bırakır,
- kullanıcıdan minimum gerekli veriyi toplamayı hedefler.

Fakat bugün için sorun fikirde değil;  
**uygulama, dokümantasyon ve off-chain yansıtma katmanlarının bu fikri tam aynı doğrulukta taşımamasındadır.**

Bu nedenle doğru karar şudur:

> **Araf bugün “mainnet-ready” değil.  
> Ama doğru yeniden hizalama ile güçlü ve özgün bir mainnet adayıdır.**

---

## 12. Ek: Codex ile çalışma prensibi

Codex’e bundan sonra yalnızca “bug bul” diye değil, şu çerçevede görev verilmelidir:

1. **Kanonik sistem davranışını yaz**
2. **Bu davranışın kontrat karşılığını doğrula**
3. **Backend/event mirror aynı şeyi yapıyor mu kontrol et**
4. **Frontend aynı sonucu mu gösteriyor bak**
5. **Docs aynı şeyi mi anlatıyor kıyasla**
6. **Uyumsuzluk varsa patch + test + doc üret**

Bu yaklaşım, dağınık güvenlik avcılığından daha verimli olacaktır.
