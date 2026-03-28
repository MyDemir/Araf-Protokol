# Araf Protocol için Escrow Sistemleri Araştırması
## Tasarım Aileleri, Karşılaştırmalı Analiz ve Mimari Öneriler

> Bu çalışma, Araf Protocol'ün mevcut mimari dokümanındaki tasarım ilkelerini esas alır: non-custodial, insan/hakem içermeyen, oracle-bağımsız, on-chain state machine temelli P2P fiat ↔ kripto escrow; backend ise custody katmanı değil, PII / order book / indexing / relay yüzeyidir. Araf’ın uyuşmazlık çözümü “Bleeding Escrow” ile zaman ve ekonomik aşınma üzerinden işler. Bu nedenle karşılaştırma, “hangi ürün popüler?” sorusundan çok “hangi güven modeli neyi mümkün kılıyor, neyi imkânsız kılıyor?” sorusu üzerinden yapılmıştır.

---

## 1. Yönetici Özeti

Bu araştırmanın ana sonucu şudur:

**Araf, piyasadaki escrow sistemleri arasında en sert “adjudication minimization” çizgilerinden birini temsil ediyor.**

Yani:
- fon custody’sini platformdan uzaklaştırıyor,
- dispute outcome alanını backend/support/jüri/oracle takdirine bırakmıyor,
- “haklıyı bulma” yerine “uzlaşmazlığı pahalılaştırma” stratejisi benimsiyor.

Bu, Araf’ı özellikle şu sistem ailelerinden ayırır:
- **custodial + support-arbitrated** pazar yerleri,
- **multisig + insan destekli dispute** sistemleri,
- **decentralized jury / arbitrator** tabanlı akıllı sözleşme escrow’ları,
- **hybrid self-custodial ama orderbook/reputation/dispute merkezi** protokoller.

Ancak bu gücün bedeli vardır:

**Araf, gerçeği yorumlayabilen sistemlere kıyasla daha dürüst ama daha kördür.**

Bu özellikle şu senaryolarda ortaya çıkar:
- yüksek reversibility taşıyan ödeme yöntemleri,
- chargeback / geri çağırma riski yüksek rails,
- “tam kazanan / tam kaybeden” yerine kısmi uzlaşma gerektiren anlaşmazlıklar,
- tarafların çevrimdışı kalmasının ekonomik sonucu bozduğu liveness ağır senaryolar.

Bu yüzden Araf için doğru yön, Binance ya da Kleros gibi olmak değildir. Doğru yön:

1. **payment method risk sınıflaması**,
2. **daha dinamik bond ekonomisi**,
3. **humanless ama kısmi settlement destekleyen primitive’ler**,
4. **reputation sinyallerinin ayrıştırılması**,
5. **watchtower / keeper / reminder tabanlı liveness altyapısı**,
6. **opsiyonel güçlü sybil direnci**,
7. çekirdeği bozmadan **opsiyonel arbitration lane** gibi genişleme yollarıdır.

---

## 2. Kapsam ve Metodoloji

### 2.1 Bu çalışma neyi kapsıyor?

“Dünyadaki tüm escrow sistemleri” ifadesi pratikte tam sayım olarak mümkün değildir. Çünkü:
- birçok sistem kapalı kaynak ya da özel operasyon mantığıyla çalışır,
- bazıları kendi support süreçlerini açıkça dokümante etmez,
- birçok escrow ürünü farklı pazarlarda farklı kurallarla işler.

Bu nedenle çalışma, **temsil gücü yüksek tasarım ailelerini** seçerek yapılmıştır.

### 2.2 İncelenen ana aileler

1. **Custodial platform escrow**
2. **Non-custodial multisig + human dispute**
3. **Lightning hold-invoice escrow**
4. **Smart-contract escrow + bounded arbitrator**
5. **Smart-contract escrow + decentralized jury**
6. **Hybrid self-custodial ama merkezi dispute / reputation / orderbook**
7. **Araf tipi autonomous, no-human, no-oracle economic closure**

### 2.3 Neden bu yöntem doğru?

Çünkü escrow sistemlerini asıl ayıran şey marka değil, şu eksenlerdir:
- custody kimde?
- uyuşmazlıkta son sözü kim söylüyor?
- delil inceleme var mı?
- taraflar arasında split settlement mümkün mü?
- liveness başarısızlığı nasıl fiyatlanıyor?
- sybil ve chargeback riski nasıl ele alınıyor?
- sistem “hakikati bulmaya mı” yoksa “uzlaşmazlığı kapatmaya mı” çalışıyor?

Bu çalışma, tam olarak bu eksenlerde konumlandırma yapar.

---

## 3. Araf’ın Baz Çizgisi: Hangi şeyle karşılaştırıyoruz?

Araf’ın mevcut mimari pozisyonu şu temel kabullere dayanıyor:

- **Escrow ve state machine on-chain otoritedir.**
- **Backend custody katmanı değildir.**
- **Backend release / dispute outcome / reputation truth üreticisi değildir.**
- **Oracle’lar uyuşmazlık kazananı belirlemek için kullanılmaz.**
- **Uyuşmazlık, Bleeding Escrow ile zaman bazlı ekonomik aşınma üzerinden kapanır.**
- **Tier, bond, anti-sybil ve decay mantığı kontrat tarafından enforce edilir.**
- **PII, order book ve operational coordination off-chain tutulur.**

Bu yaklaşım, Araf’ı klasik “escrow + support” ürününden çıkarıp bir **economic settlement protocol** sınıfına yaklaştırır.

Bunu akılda tutmak önemli. Çünkü aşağıdaki sistemlerin çoğu, bir noktada insan yorumuna, moderasyona, destek operasyonuna ya da evidence adjudication’a döner.

---

## 4. Escrow Tasarım Aileleri

## 4.1 Custodial Platform Escrow
### Örnek: Binance P2P

Bu ailede platform, güven modelinin merkezindedir.

Binance P2P dokümantasyonuna göre, satıcı kriptoyu serbest bırakmazsa müşteri hizmetleri devreye girer; belirli koşullarda Binance müşteri hizmetleri kriptoyu manuel olarak release edebilir.[1]

### Bu modelin özellikleri

- Kullanıcı deneyimi genellikle güçlüdür.
- Appeal / support akışı nettir.
- KYC, verified-name, payment rule enforcement gibi mekanizmalar dispute çözümünde merkezi rol oynar.
- Delil incelemesi insanlar tarafından yapılır.
- Gerektiğinde platform, trade sonucuna doğrudan müdahale eder.

### Güçlü tarafları

- Gerçek dünyadaki karmaşık ödeme hataları daha esnek ele alınabilir.
- “Bu durumda kim haklı?” sorusuna operasyonel yanıt üretilebilir.
- Yanlış remark, yanlış tutar, geciken banka havalesi gibi edge case’lerde kullanıcı lehine toparlayıcı bir merkez vardır.

### Zayıf tarafları

- Güven modeli platform dürüstlüğüne ve support kalitesine bağımlıdır.
- Kullanıcı, “protocol enforcement” yerine “platform arbitration” altında yaşar.
- Custody / freeze / manual intervention yetkisi mimarinin merkezindedir.

### Araf açısından ders

Araf bu modeli **bilinçli olarak reddediyor**. Çünkü Araf’ın felsefesi, “platform gerçeği biliyormuş gibi davranmasın” üzerine kurulu. Bu güçlü bir ayrım. Ama sonuç olarak Araf, Binance’in kullanıcı lehine yaptığı **operasyonel yumuşatmaları** yapamaz; onların yerine ekonomik teşvikleri daha iyi tasarlamak zorundadır.

---

## 4.2 Non-Custodial Multisig + Human Dispute
### Örnekler: Bisq, Hodl Hodl

Bu ailede platform fonu doğrudan custody etmez; ancak dispute resolution hala insan destekli katmanlara yaslanır.

### Bisq

Bisq dokümantasyonuna göre trade fonları, deposit ve fee’lerle birlikte **2-of-2 multisig escrow** içinde kilitlenir. Dispute resolution ise **trader chat, mediation ve arbitration** olmak üzere üç katmandan oluşur.[2] Bisq ayrıca security deposit’i açıkça teşvik mekanizması olarak kullanır; bu deposit’ler trade sonunda dispute yoksa otomatik iade edilir.[3]

#### Güçlü tarafları
- Custody minimizasyonu vardır.
- Taraf teminatları ciddi bir ekonomik caydırıcılık üretir.
- Dispute sürecinde kademeli çözüm vardır: önce taraflar, sonra mediator, sonra arbitrator.
- Fiat trade’lerin chargeback riski konusunda açık bir gerçekçilik taşır.[4]

#### Zayıf tarafları
- Sonuçta insan yorumuna döner.
- Liveness ve kullanıcı koordinasyonu güçlü operasyon gerektirir.
- UX daha ağırdır.

### Hodl Hodl

Hodl Hodl yardım sayfalarına göre disputes durumunda **support manager** vakayı inceler ve çözüm için talimat verir. Aynı zamanda BTC, **2-of-3 multisig escrow** içinde tutulur.[5]

#### Güçlü tarafları
- Custody minimizasyonu korunur.
- Platform doğrudan kullanıcı fonuna tek başına dokunmaz.
- İnsan destekli dispute süreci sayesinde daha fazla nüanslı karar verilebilir.

#### Zayıf tarafları
- Merkezî support katmanı hâlâ kritik rol oynar.
- “trust minimized” olsa da “judgment minimized” değildir.

### Araf açısından ders

Araf, Bisq ve Hodl Hodl’a göre daha ileri bir adım atıyor:
- fonu platform tutmuyor,
- support / mediator / arbitrator dispute outcome üretmiyor.

Ancak bu sistemlerin Araf’tan üstün olduğu alan şudur:

**Karmaşık uyuşmazlıkları kısmi, bağlama duyarlı ve insanî olarak çözebilirler.**

Bu yüzden Araf, insan hakem eklemeyecekse, bunun yerine ekonomik primitive’lerini daha zengin hale getirmelidir.

---

## 4.3 Lightning Hold-Invoice Escrow
### Örnek: RoboSats

RoboSats, P2P Bitcoin ↔ fiat işlemlerini Lightning tabanlı hold invoice mekanikleriyle güvence altına alır. Dokümantasyona göre hem maker hem taker için **fidelity bonds** kullanılır; bunlar Lightning hold invoice yapısı üzerindedir.[6] Trade escrow da yine Lightning hold invoice mantığıyla çalışır ve alıcıyı fraud / nonpayment riskine karşı korumayı amaçlar.[7]

### Bu modelin özellikleri

- Çok güçlü privacy ergonomisi sunabilir.
- Bonds ve escrow, custody yerine Lightning akışlarına dayanır.
- Order maker bond oranını belirli ölçüde özelleştirebilir; default bond %3’tür, 2%–15% arası seçilebilir.[6]
- Liveness ve wallet uyumluluğu kritik hale gelir.[6][8]

### Güçlü tarafları
- Düşük custody yüzeyi
- Lightning-native hız
- Güçlü incentive design
- Daha fazla privacy

### Zayıf tarafları
- Genel stablecoin escrow değil; Bitcoin/Lightning-eksenlidir.
- Wallet compatibility kritik bir UX kısıtı oluşturur.
- Ödeme yöntemi ve zamanlama uyumsuzluğu dispute riskini büyütür.[9]

### Araf açısından ders

RoboSats’in Araf’a verdiği en önemli ders şudur:

**Bond’lar yalnız “ceza” değildir; sistemin davranış fiziğidir.**

Araf zaten bond mantığına sahip. Ama RoboSats şunu gösteriyor:
- bond miktarı trade tipine göre değişebilir,
- rail uyumluluğu ve settlement süresi ekonomik tasarıma doğrudan bağlanabilir,
- her trade’i aynı risk profiliyle fiyatlamak gerekmeyebilir.

Bu, Araf için daha dinamik bond ekonomisinin güçlü bir gerekçesidir.

---

## 4.4 Smart-Contract Escrow + Bounded Arbitrator
### Örnek: Unicrow

Unicrow’da arbitrator tanımlanabilir; ancak contract tarafından ciddi biçimde sınırlandırılır. Dokümantasyona göre arbitrator yalnızca şu üç sonucu verebilir:
- buyer’a refund,
- seller’a release,
- iki taraf arasında split.[10]

Arbitrator, fonları başka bir adrese yönlendiremez veya contract’ı keyfi kilitleyemez.[10]

Ayrıca Unicrow’un “Dispute without a 3rd party” akışı, karşılıklı challenge period uzatmalarıyla üçüncü taraf olmadan da dispute eskalasyonu yürütülebileceğini gösterir.[11]

### Güçlü tarafları
- Custody düşük kalır.
- Arbitrator gücü bounded’dır.
- Split settlement yerleşik bir primitive’tir.
- No-third-party senaryolar için de düşünülmüş challenge modeli vardır.

### Zayıf tarafları
- Yine de bir yorum ve hüküm alanı vardır.
- Belirli use case’lerde challenge döngüsü uzayabilir.

### Araf açısından ders

Unicrow’un Araf için en büyük öğretisi **split settlement primitive**’idir.

Araf’ın bugün en önemli ürün boşluklarından biri, humanless felsefeyi korurken **kısmi uzlaşmayı** birinci sınıf primitive olarak işlememesidir.

Çünkü gerçek uyuşmazlıkların önemli kısmı:
- tam release,
- tam cancel,
- tam burn
üçlüsüne sığmaz.

İki taraf bir 70/30 ya da 85/15 sonuca razıysa bunu native primitive haline getirmek, Bleeding Escrow’a giden birçok akışı daha erken kapatır.

---

## 4.5 Smart-Contract Escrow + Decentralized Jury
### Örnek: Kleros Escrow

Kleros Escrow, dispute çözümünü decentralized jury sistemine bağlar. Kleros dokümantasyonuna göre dispute outcome appeal edilebilir; appeal funding başarılı olursa yeni bir round daha fazla juror ile yürür.[12] Tutorial dokümanında ayrıca:
- tarafların dispute için arbitration fee ödediği,
- evidence submission yaptığı,
- sürecin en az 5–7 gün sürebildiği,
- partial settlement ve remaining balance dispute mekaniklerinin bulunduğu açıkça görülür.[13]

### Güçlü tarafları
- “Gerçeğe yaklaşma” kapasitesi Araf’tan yüksektir.
- Kısmi settlement destekler.[13]
- Formal evidence katmanı vardır.[13]
- Appeal sistemi vardır.[12][13]

### Zayıf tarafları
- Gecikme ve maliyet büyüktür.
- Jüri kalitesi ve incentive tasarımı ayrı bir dünya problemidir.
- Tarafların süreç takibi, evidence üretimi ve fee ödemesi gerekir.

### Araf açısından ders

Kleros’un Araf’a öğrettiği şey, “juror ekle” değil; şu:

**Bir escrow sistemi kısmi settlement, explicit evidence surface ve appealability ekledikçe daha adil olabilir; ama daha pahalı, daha yavaş ve daha karmaşık hale gelir.**

Araf’ın asıl değeri tam da bunu yapmamasıdır. Fakat Araf, bu değeri korurken **kısmi settlement** ve **kalan bakiyeyi dispute edebilme** gibi bazı araçları insan hakem olmadan da ödünç alabilir.

---

## 4.6 Hybrid Self-Custodial Ama Merkezi Dispute / Reputation / Orderbook
### Örnek: OpenPeer

OpenPeer çok önemli bir kıyas örneği çünkü yüzeyde “decentralized P2P protocol” anlatısı taşırken, kendi dokümantasyonu hangi alanların merkezi kaldığını açıkça kabul eder.

OpenPeer dispute docs’a göre bir taraf dispute açıp delil sunduktan sonra diğer tarafın 24 saat counter-evidence sunma hakkı vardır; ardından **OpenPeer Labs team or affiliates** kazananı seçer ve dispute’u çözer.[14]

Ayrıca “What is decentralized and what is not?” sayfasında:
- **Disputes – Centralised**
- **Reputation – Centralised**
- **Offers / Orderbook – Centralised**
ifadeleri açıkça yer alır.[15]

### Güçlü tarafları
- Self-custodial escrow yüzeyi vardır.
- Ürün anlatısı ve kullanıcı onboarding’i merkezî P2P borsalara göre daha hafiftir.
- Merkezi dispute sayesinde bağlama duyarlı karar verilebilir.

### Zayıf tarafları
- Kritik yorum katmanı merkezidir.
- Reputation ve orderbook da merkezidir.[15]
- “trust minimized” anlatısı ile fiili karar yüzeyi arasında gerilim doğabilir.

### Araf açısından ders

Araf’ın OpenPeer’e göre üstün olduğu yer çok nettir:

**Araf, merkezi yorum katmanını daha sert biçimde sınırlar.**

Bu, mimari dürüstlük açısından önemli bir üstünlüktür. Ancak OpenPeer’in gösterdiği başka bir gerçek de vardır:

P2P fiat/crypto ürünlerinde orderbook, reputation ve dispute’i merkezi tutmak ürün geliştirmeyi ciddi biçimde kolaylaştırır.

Yani Araf daha “dürüst” bir yere konumlanırken, ürün tarafında daha fazla mekanik zekâ üretmek zorundadır.

---

## 4.7 Autonomous No-Human No-Oracle Economic Closure
### Örnek: Araf

Araf’ın diğerlerinden ayrıldığı çekirdek nokta şudur:

Araf, dispute çözümünü “kim haklı?” sorusuna bağlamaz.

Onun yerine:
- state machine on-chain’dir,
- bond ve decay ekonomisi önceden belirlenmiştir,
- oracle yoktur,
- moderator yoktur,
- jury yoktur,
- backend karara müdahale edemez,
- taraflar uzlaşmazsa zaman içinde ekonomik değer aşınır.

Bu yüzden Araf bir “truth-discovery escrow” değil, bir **cooperation-forcing settlement protocol** olarak okunmalıdır.

### Güçlü tarafları
- Mimari dürüstlük çok yüksektir.
- Backend takdiri minimize edilir.
- Oracle bağımlılığı yoktur.
- State machine’in authority alanı nettir.
- Uyuşmazlıkta sonsuz oyalama yerine deterministic closure vardır.

### Zayıf tarafları
- Nüanslı gerçekliklere kördür.
- Kısmi settlement primitive’leri zayıfsa gereksiz burn üretir.
- Payment rail riskini yeterince fiyatlamazsa yüksek-risk yöntemlerde sömürüye açık kalabilir.
- İnsan yoksa liveness altyapısı birinci sınıf sorun haline gelir.

---

## 5. Karşılaştırmalı Tasarım Matrisi

| Sistem Ailesi | Custody | Dispute Son Sözü | Delil İnceleme | Split Settlement | Liveness Hassasiyeti | Mimari Dürüstlük | Araf’a Göre Konum |
|---|---|---|---|---|---|---|---|
| Custodial platform escrow | Platform / platform-temelli kontrol | Support / platform | Güçlü | Genelde mümkün | Orta | Düşük-Orta | Daha esnek, daha merkezi |
| Non-custodial multisig + human dispute | Düşük custody | Mediator / support / arbitrator | Güçlü | Bazen mümkün | Orta-Yüksek | Orta | Daha nüanslı, daha insan bağımlı |
| Lightning hold-invoice escrow | Çok düşük custody | Kural + platform akışı | Sınırlı / ürün spesifik | Kısıtlı | Çok yüksek | Yüksek | Daha privacy-first, daha dar kullanım |
| Smart contract + bounded arbitrator | Düşük custody | Sınırlı arbitrator | Orta | Güçlü | Orta | Orta-Yüksek | Araf’a yakın ama yorum içerir |
| Smart contract + decentralized jury | Düşük custody | Jurors / arbitration court | Çok güçlü | Güçlü | Orta | Orta | Daha adil olabilir, daha pahalı ve yavaş |
| Hybrid self-custodial + centralized layers | Düşük custody | Merkezi dispute takımı | Güçlü | Kısıtlı | Orta | Orta | Ürünce kolay, protokolce daha zayıf |
| Araf tipi autonomous closure | Düşük custody | Hiç kimse / ekonomik state machine | Yok | Şu an sınırlı | Yüksek | Çok yüksek | En sert trust-minimization + en sert körlük |

---

## 6. Araf’ın Stratejik Olarak Güçlü Olduğu Yerler

## 6.1 Hakikati taklit etmeme cesareti

Birçok escrow ürünü doğrudan ya da dolaylı biçimde “gerçeği anlayacağız” iddiası taşır. Araf bunun yerine epistemik sınırını kabul eder:
- banka havalesi gerçeği on-chain bilinemez,
- insan niyeti doğrulanamaz,
- oracle kullanmak hakikat değil yalnız dış anlatı taşır.

Bu, Araf’ın en güçlü felsefi avantajıdır.

## 6.2 Backend yorum kapasitesini sınırlaması

Birçok sistem teknik olarak non-custodial olsa da fiiliyatta backend yorum tekelini korur. Araf’ta bu alan daha dar çizilmiş durumda.

Bu, güvenlik kadar **politik mimari** avantajıdır.

## 6.3 Deterministic closure

Bazı escrow sistemlerinde dispute, support kalitesi ve kullanıcı sabrına bağlı olarak uzar. Araf ise kapanışı ekonomik fizik içine gömer.

Bu, özellikle “sonsuz bekleme / sonsuz appeal / sonsuz support kuyrukları” dünyasına kıyasla ciddi bir farktır.

## 6.4 On-chain enforced anti-sybil, tier ve bond mantığı

Araf’ın tier, bond ve anti-sybil kontrollerini kontrat seviyesinde zorlaması önemlidir. Bu, UX seviyesindeki policy’nin kolayca esnetilememesini sağlar.

---

## 7. Araf’ın Asıl Kör Noktaları

## 7.1 Payment method homojenliği varsayımı

Bu en kritik sorunlardan biridir.

Banka transferi, FAST/instant transfer, havale, SWIFT, e-cüzdan, hediye kartı, PayPal benzeri rail’ler aynı dispute fiziğine sahip değildir.

- bazıları anlık ve geri döndürülemezdir,
- bazıları gecikmeli ama güvenilirdir,
- bazıları hızlı ama yüksek chargeback risklidir,
- bazıları delil incelemesi olmadan neredeyse yönetilemez.

Araf payment rail riskini yeterince sınıflandırmazsa, kötü aktörler en zayıf rail’lere akar.

## 7.2 Binary-ish closure riski

Tam release / tam cancel / burn ekseni, gerçek anlaşmazlık çeşitliliğini karşılamayabilir. Kısmi iş tamamlandıysa? Kısmi ödeme haklıysa? Taraflar kalan bakiyede anlaşmak istiyorsa?

Bu boşluk, gereksiz economic destruction doğurabilir.

## 7.3 Liveness ağır ürün tasarımı

İnsan olmayan sistemlerde çevrimdışı kalmak daha pahalıdır.

Bu nedenle:
- deadline kaçırma,
- sekmeyi kapatma,
- yanlış notification,
- mobil uyku modu,
- yanlış ağ,
- failed tx görünürlüğü
çok daha kritik hale gelir.

Araf bunu UX katmanında bir miktar tanıyor; ama dispute liveness’ı için daha da ileri gitmesi gerekir.

## 7.4 Reputation’ın tek boyutlu kalma tehlikesi

Başarısız dispute, liveness başarısızlığı, kasıtlı sahtekârlık, karşılıklı burn ve taktiksel challenge abuse aynı reputational sepete fazla yakın düşerse model körleşir.

## 7.5 Chargeback-gerçekçiliği eksik kalabilir

Araf chargeback’i “tam önlenemez” diye dürüstçe kabul ediyor; ancak bu riskin ürün ekonomisine sistematik biçimde gömülmesi gerekir.

---

## 8. Araf İçin Mimari Öneriler

## 8.1 P0 — Payment Method Risk Engine

### Öneri
Her listing / trade için bir **payment rail risk class** tanımla.

Örnek sınıflar:
- **Class A:** instant + düşük reversibility
- **Class B:** gecikmeli ama düşük chargeback
- **Class C:** hızlı ama yüksek reversal riski
- **Class D:** delil yoğun / abuse-prone rails

### Bu sınıf neleri etkilemeli?
- maker bond
- taker bond
- grace period
- challenge wait period
- crypto decay start
- max trade size
- eligible tiers

### Neden önemli?
Çünkü “aynı dispute physics’i” her ödeme yöntemi için kullanmak ürün düzeyinde adil görünse bile saldırı yüzeyi üretir.

### Tasarım etkisi
Bu öneri Araf’ın felsefesini bozmaz. Aksine dispute mekanizmasını gerçek risklere göre daha dürüst fiyatlar.

---

## 8.2 P0 — Dinamik Bond Motoru

### Öneri
Bond oranı yalnız tier ve temiz/kötü itibarla belirlenmesin. Aşağıdaki bileşenlerle birleşsin:
- payment rail class
- notional bucket
- first-time counterparty pairing
- recent liveness reliability
- challenge/burn geçmişi
- corridor risk

### Neden önemli?
Araf’ın asıl enforcement alanı ekonomidir. Hakikati bilmeyen sistem, davranışı fiyatlamada ne kadar iyiyse o kadar güçlü olur.

### Beklenen fayda
- yüksek riskli rails’de spam azalır,
- düşük riskli rails’de friction gereksiz yere yüksek kalmaz,
- Tier sistemi daha canlı hale gelir.

---

## 8.3 P0 — Native Partial Settlement Primitive

### Öneri
2/2 mutabakatla çalışan bir **split settlement** primitive ekle.

Örnek:
- `settleBySplit(tradeId, makerShare, takerShare, deadline, signatures...)`
- veya iki ayrı on-chain onayla işleyen bir settlement path.

### Neden önemli?
Gerçek dünyanın ciddi kısmı “kazanan her şeyi alsın” mantığında işlemez.

### Beklenen fayda
- gereksiz burn azalır,
- kullanıcılar Bleeding’e girmeden uzlaşabilir,
- humanless felsefe bozulmadan çözüm uzayı genişler.

### Ek not
Unicrow ve Kleros ailelerinin güçlü olduğu yer tam da burasıdır: **partial outcome kabulü**. Araf bunu insan hakem olmadan da native primitive haline getirebilir.[10][13]

---

## 8.4 P1 — Reputation Sinyallerini Ayrıştır

### Öneri
Reputation tek skor gibi davranmasın. En azından şu sinyaller ayrıştırılsın:
- successful settlements
- liveness failures
- auto-release caused losses
- burn participation
- challenge abuse attempts
- high-risk rail successful completions
- mutual settlement success rate

### Neden önemli?
Çünkü “failed dispute” tek başına yeterince semantik değildir.

### Beklenen fayda
- daha doğru tier progression,
- daha doğru bond pricing,
- daha anlamlı ban / ceiling logic.

---

## 8.5 P1 — Liveness’i Birinci Sınıf Mimari Katman Yap

### Öneri
Aşağıdakileri protokol çevresinin zorunlu parçası olarak düşün:
- push / email / Telegram / wallet notification çoğaltması,
- delegated keeper / watchtower modeli,
- deadline object’lerinin backend ve frontend’de first-class yönetimi,
- pending dispute action recovery,
- signed session + trade-specific action reminders,
- mobil öncelikli “urgent action required” akışları.

### Neden önemli?
Araf’ta insan support yoksa, “mesajı görmedim” doğrudan ekonomik kayıp demektir.

### Beklenen fayda
- dürüst kullanıcıların sistem yüzünden kaybetmesi azalır,
- protocol-level fairness artar,
- support ihtiyacı insan hükmü olmadan azaltılır.

---

## 8.6 P1 — Chargeback-Aware Trade Design

### Öneri
Belirli rails için şu ek alanları düşün:
- payment source consistency acknowledgement,
- chargeback risk declaration,
- delayed finality warning,
- post-release evidence retention window,
- counterparty-confirmed settlement notes.

### Neden önemli?
Araf chargeback’i çözemeyecek. Ama chargeback riskinin işlemsel yüzeyini daha şeffaf ve daha maliyetli hale getirebilir.

---

## 8.7 P2 — Opsiyonel Güçlü Sybil Direnci

### Öneri
World ID veya Proof of Humanity benzeri sinyalleri **zorunlu değil, opt-in tier accelerator** olarak düşün.

- World ID, anonim proof of human credential olarak kendini sunuyor; duplicate account ve abuse azaltma amacı taşıyor.[16]
- Proof of Humanity ise decentralized community tarafından doğrulanmış bir human registry olarak tanımlanıyor ve sybil-resistance use case’lerine odaklanıyor.[17]

### Bu nasıl kullanılmalı?
- herkes için zorunlu değil,
- ancak belirli tier geçişlerinde bond indirimi / daha hızlı tier unlock / daha yüksek limit gibi avantajlar sağlayabilir.

### Neden önemli?
Bu sayede Araf:
- anonim temel yolunu korur,
- fakat yüksek-tier spam’e karşı daha güçlü sinyaller elde eder.

---

## 8.8 P2 — Opsiyonel Arbitration Lane

### Öneri
Varsayılan çekirdek akış Bleeding-only kalsın. Ancak opsiyonel bir yüksek-tier lane düşün:
- maker ilan açarken “Araf Native” veya “Arbitrated Lane” seçsin,
- yalnız belirli notional üstünde ya da belirli rails için açık olsun,
- bounded arbitrator ya da jury entegrasyonu düşünülsün.

### Neden önemli?
Bazı kullanıcılar hakemsiz closure ister; bazıları ise büyük notional işlemde interpretive dispute resolution talep eder.

### Risk
Bu, Araf’ın felsefi saflığını zayıflatabilir. Bu yüzden çekirdeğe değil, **opsiyonel ürün katmanına** ait olmalı.

---

## 9. Araf’ın Yapmaması Gereken Şeyler

## 9.1 Backend’e manual release authority vermek

Bu, Araf’ın en güçlü fikrini öldürür.

Bir kez “istisnai durumlarda backend release eder” çizgisine girildiğinde artık:
- support queue,
- delil yorumlama,
- karar sorumluluğu,
- politik baskı,
- key compromise riski
kaçınılmaz hale gelir.

## 9.2 Oracle ile banka transferini “doğrulamak”

Bu, hakikati gerçekten çözmez; yalnızca başka bir dış anlatıyı sisteme sokar.

### Sonuç
Araf’ın esas değeri, bilmediğini biliyormuş gibi yapmamasıdır. Bunu bozmak, ürünü daha güçlü değil daha tutarsız yapar.

## 9.3 Her payment rail için aynı kuralları uygulamak

Bu, sadelik uğruna güvenliği feda eder.

## 9.4 Tamamen affedici ya da tamamen sonsuz damgalayıcı reputation

İki uç da zararlıdır. Araf’ın decay mantığı iyi bir başlangıç; ama sinyaller daha ayrık hale gelmelidir.

---

## 10. Araf’ın Rekabetçi Konumlandırması

Araf’ın doğru konumlandırması şu değildir:
- “Binance’den daha kullanıcı dostu destek sunuyoruz”
- “Kleros kadar adil dispute yapıyoruz”
- “Bisq kadar payment method-aware’ız”

Araf’ın doğru konumlandırması şudur:

> **Araf, hakemi ve oracle’ı sistemden çıkarıp, uzlaşmazlığı ekonomik olarak kapatan bir autonomous settlement protocol’dür.**

Bu pozisyonun alt başlıkları:
- non-custodial
- no moderator
- no jury
- no truth theater
- deterministic closure
- bounded backend
- economic honesty

Bu iddia nettir, savunulabilirdir ve mimari olarak tutarlıdır.

---

## 11. Mimari Dosyaya İşlenebilecek Yeni Bölüm Önerileri

## 11.1 Yeni bölüm: “Escrow Sistemleri Arasında Konumlandırma”

Bu bölümde şu fikir anlatılabilir:
- Araf custodial P2P’lerden neden ayrılır?
- Araf multisig + human dispute sistemlerinden neden farklıdır?
- Araf decentralized jury sistemlerinden neden farklı trade-off seçer?

## 11.2 Yeni alt bölüm: “Payment Rail Risk Modeli”

Mevcut tier/bond bölümünün altına eklenebilir.

## 11.3 Yeni alt bölüm: “Partial Settlement Path”

Uyuşmazlık sistemi altında native split settlement primitive olarak tanımlanabilir.

## 11.4 Yeni alt bölüm: “Liveness as Security”

Frontend UX ve güvenlik mimarisi bölümlerine bağlanabilir.

---

## 12. Son Hüküm

Araf’ın bugün en büyük gücü, **ahlaki ve mimari dürüstlüğü**dür.

Sistem:
- bilmediği şeyi biliyormuş gibi yapmıyor,
- support tiyatrosuna yaslanmıyor,
- oracle ile hakikat simülasyonu kurmuyor,
- kullanıcıyı “bir gün biri çözer” kuyruğuna hapsetmiyor.

Ama bu dürüstlük, tek başına yeterli değildir.

Eğer Araf gerçekten güçlü bir escrow protokolü olacaksa, çekirdeğini bozmadan şu üç şeyi ustalaştırmalıdır:

1. **riskin daha doğru fiyatlanması**
2. **humanless ama daha esnek settlement yolları**
3. **liveness’in ürün ve mimari seviyede sert biçimde desteklenmesi**

Benim nihai değerlendirmem:

**Araf, mevcut haliyle felsefi olarak çok güçlü, mimari olarak özgün ve stratejik olarak ayırt edici. Ancak ürün olarak gerçekten zorlaşacağı yer, “hakikati bilmeyen bir sistemin riskleri ne kadar ince fiyatlayabildiği” olacaktır.**

Burada başarırsan Araf yalnız iyi bir escrow sistemi olmaz.

Kendi kategori tanımını yapar.

---

## Kaynaklar

[1] Binance P2P Appeal Handling Rules — https://www.binance.com/en-TR/support/faq/detail/360041839052

[2] Bisq, Trading Rules and Dispute Resolution — https://docs.bisq.network/trading-rules.html

[3] Bisq Wiki, Security Deposit — https://bisq.wiki/Security_deposit

[4] Bisq Wiki, Frequently Asked Questions — https://bisq.wiki/Frequently_asked_questions

[5] Hodl Hodl Help / Dispute resolution system — https://hodlhodl.com/pages/help

[6] RoboSats, Maker and Taker Bonds — https://learn.robosats.org/docs/bonds/

[7] RoboSats, Trade Escrow — https://learn.robosats.org/docs/escrow/

[8] RoboSats, Wallet Compatibility — https://learn.robosats.org/docs/wallets/

[9] RoboSats, Fiat Best Practices — https://learn.robosats.org/docs/payment-methods/

[10] Unicrow, How it works — https://docs.unicrow.io/docs/introduction/how-it-works

[11] Unicrow, Dispute without a 3rd party — https://docs.unicrow.io/docs/introduction/dispute-challenge

[12] Kleros Escrow Specifications — https://docs.kleros.io/products/escrow/kleros-escrow-specifications

[13] Kleros Escrow Tutorial — https://docs.kleros.io/products/escrow/new-in-progress-kleros-escrow-tutorial

[14] OpenPeer, Dispute Arbitration — https://docs.openpeer.xyz/openpeer-docs/openpeer-protocol/dispute-arbitration

[15] OpenPeer, What is decentralized and what is not? — https://docs.openpeer.xyz/openpeer-docs/openpeer-protocol/what-is-decentralized-and-what-is-not

[16] World ID Overview — https://docs.world.org/world-id/overview

[17] Proof of Humanity FAQ — https://docs.kleros.io/products/proof-of-humanity/poh-faq
