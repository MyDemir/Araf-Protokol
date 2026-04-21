# Araf V3 Ürün Planı — Yeniden Kurgulanmış Sürüm

## 1. Bu sürüm neden yeniden yazıldı?

Bu sürüm, Araf’ın ürün tezini daha net bir çerçeveye oturtmak için yeniden kurgulandı.

Önceki plandaki geliştirme başlıkları korunmuştur. Ancak planın merkezine artık şu gerçek ürün iddiası yerleştirilmiştir:

**Araf, off-chain personel doğrulaması yapmadan, iki tarafın da mağduriyetini sınırlamayı amaçlayan, risk-görünür ve contract-authoritative bir escrow protokolüdür.**

Bu ifade önemlidir. Çünkü Araf:

- platform personeli aracılığıyla kullanıcı doğrulaması yapmaz,
- klasik anlamda merkezi bir hakem/operatör modeli kurmaz,
- güveni insan müdahalesinden değil, protokol semantiğinden, state machine disiplininden ve risk görünürlüğünden üretmeye çalışır.

Bu nedenle Araf’ın amacı “kimse dolandırıcılık yapamaz” demek değildir.

Araf’ın daha doğru ürün vaadi şudur:

**Dolandırıcılığı pahalı, zor, görünür ve sınırlı hale getirmek; kötü senaryoda iki tarafın da mağduriyetini minimize etmek.**

---

## 2. Ürün tezi

### 2.1 Araf ne değildir?

Araf:

- bir KYC doğrulama platformu değildir,
- bir manuel dispute operasyon şirketi değildir,
- “biz kimi güvenilir bulursak o kazanır” mantığında çalışan merkezî bir pazar yeri değildir,
- her davranış sinyalini ekonomik otoriteye çeviren kapalı bir risk motoru değildir.

### 2.2 Araf ne olmalıdır?

Araf şu kategoriye oturmalıdır:

**Trust-aware, human-verification-free social escrow.**

Bunun Türkçesi:

**İnsan doğrulamasına dayanmadan çalışan, kullanıcı güveninin kör noktalarını risk sinyalleri ve settlement disiplini ile dengeleyen escrow protokolü.**

### 2.3 Temel ürün iddiası

Araf’ın ana iddiası şu şekilde sabitlenmelidir:

1. Kullanıcılar birbirini tam doğrulamıyor olabilir.
2. Platform onları personel eliyle doğrulamıyor olabilir.
3. Buna rağmen protokol, kötü niyetin etkisini azaltmalı ve mağduriyeti sınırlamalıdır.
4. Risk sinyali görünür olmalı, ama ekonomik hüküm yetkisine dönüşmemelidir.
5. Settlement mantığı açık, audit edilebilir ve simetrik koruma üreten bir state machine olarak çalışmalıdır.

---

## 3. Ürünün omurgası: hangi probleme çözüm getiriyoruz?

P2P escrow dünyasında üç yaygın çözüm vardır:

1. **Personel doğrulaması**
   - Kullanıcıyı platform doğrular.
   - Güven, operatörün kararından türetilir.

2. **KYC / heavy compliance**
   - Kimlik, banka ve hesap doğrulaması platform tarafından yapılır.
   - Güven, kayıt ve erişim bariyeriyle üretilir.

3. **Kör güven / saf eşler arası model**
   - Kullanıcılar neredeyse tüm riski kendi başına üstlenir.
   - Platform yalnız listeleme yüzeyi sağlar.

Araf bunların tam ortasında başka bir yol önermelidir:

- platform personeliyle güven üretmez,
- ağır doğrulama ile güven üretmez,
- kullanıcıyı çıplak risk altında da bırakmaz.

Araf’ın çözümü:

- kontratta dar ama sert economic authority,
- backend/UI katmanında risk görünürlüğü,
- trade-scoped snapshot disiplini,
- simetrik koruma,
- audit edilebilir settlement semantiği,
- gerektiğinde friction üreten ama hüküm vermeyen risk katmanı.

---

## 4. Doğrulanabilen mevcut repo zemini

Bu plan, mevcut repo ve önceki teknik raporda görülen temel gerçekleri koruyarak yeniden yazılmıştır.

### 4.1 Authority sınırı
- Economic ve state-changing authority kontrattadır.
- Backend, trade read, PII koordinasyonu, cancel imza koordinasyonu ve audit yüzeyi rolündedir.
- V3’te public market nesnesi listing değil, order’dır; child trade gerçek escrow lifecycle’ını taşır.

### 4.2 Ödeme rayı gerçeği
- `PROFILE_SCHEMA` fiilen `TR_IBAN`, `US_ACH`, `SEPA_IBAN` ile sınırlı görünmektedir.
- Veri modelinde `UK_FPS` ve `SWIFT` gibi fazladan enum yüzeyleri görünmektedir.
- Bu nedenle ürünün anlattığı ödeme rayı ile doğrulanmış kod gerçeği tamamen hizalı değildir.

### 4.3 Snapshot yönelimi doğru ama eksik
- PII ve payout bilgisi trade-scoped snapshot mantığına yaklaşmaktadır.
- Bu, post-lock drift riskini azaltmak için doğru yöndür.
- Ancak risk ve health yüzeyi için gerekli bazı snapshot alanları henüz tam taşınmıyor görünmektedir.

### 4.4 Risk katmanı var ama karar verici olmamalı
- `trades.js` tarafında risk türetimi mantığına bir başlangıç bulunmaktadır.
- Buna rağmen veri yüzeyi eksiktir.
- Bu katman yalnız görünürlük ve friction üretmeli; dispute/settlement otoritesine dönüşmemelidir.

### 4.5 Operasyon yüzeyi kısmi
- Feedback yazma yüzeyi mevcut görünmektedir.
- Fakat admin okuma / operasyon paneli henüz doğrulanmış değildir.

### 4.6 Reputation kaba seviyede
- Mevcut reputation enforcement başarı/başarısızlık tipi kaba sinyallere dayanma eğilimindedir.
- Burn, auto-release, mutual cancel ve dispute outcome ayrımları henüz yeterince ince değildir.

---

## 5. Araf’ın değişmez ürün ilkeleri

Aşağıdaki ilkeler, tüm geliştirmelerin üstünde tutulmalıdır.

### 5.1 Kontrat authority’dir
Backend, admin panel veya risk servisi; release, cancel, burn veya payout outcome’u override edemez.

### 5.2 Oracle-free dispute çizgisi korunur
Harici kur, banka verisi, risk API’si, manuel operatör kararı veya davranışsal puan; escrow sonucunu doğrudan belirlememelidir.

### 5.3 Risk görünürdür ama hüküm vermez
Risk katmanı:
- uyarı verebilir,
- friction üretebilir,
- görünürlük azaltabilir,
- ek bond/pricing class etkisi oluşturabilir,
- ama kullanıcı adına nihai ekonomik hüküm veremez.

### 5.4 Simetrik koruma esastır
Sistem yalnız maker’ı veya yalnız taker’ı korumaya odaklanmamalıdır.
Her önemli kural için şu soru sorulmalıdır:
- Bu mekanizma maker’ı nasıl koruyor?
- Taker’ı nasıl koruyor?
- Kötü senaryoda iki tarafın da zararını nasıl sınırlıyor?

### 5.5 İnsan doğrulamasının yokluğu ürün zayıflığı değil, tasarım gerçeğidir
Araf, personel doğrulaması yapmadığı için bunu gizlememeli; tam tersine ürün mantığını bunun üzerine kurmalıdır.

### 5.6 Risk, güvenin yerine geçmez
Risk puanı “bu kullanıcı güvenlidir” anlamına gelmez.
Yalnızca “bu işlemin risk profili budur” demelidir.

### 5.7 Blast radius küçük tutulur
Rewards, analytics, admin, score, ticker ve benzeri modüller çekirdek escrow mantığını büyütmeden ayrı katmanlar olarak tasarlanmalıdır.

---

## 6. Başarı metrikleri yeniden tanımlanmalı

Araf’ın başarısı sadece büyüme metrikleriyle ölçülmemelidir.

Önerilen ana metrikler:

1. Fraud attempt başına gerçekleşen net zarar
2. Bir trade’de kötü senaryo oluştuğunda mağduriyetin kapanma süresi
3. Mutual cancel / orderly resolution oranı
4. Risk sinyali doğruyken kullanıcının korunma oranı
5. False positive ve false negative risk işaret oranı
6. Taker ve maker tarafında “tam güvenmeden işlem yapabilme” hissi
7. Payout/profile drift kaynaklı hata oranı
8. İnsan müdahalesi gerekmeksizin tamamlanan sağlıklı trade oranı

Bu metrikler, ürünün gerçek hedefi olan mağduriyet minimizasyonunu growth metriklerinden ayırır.

---

## 7. Ürün sütunları

### 7.1 Settlement Integrity
Araf’ın en büyük farkı, settlement mantığını insan müdahalesi yerine state machine disipliniyle kurması olmalıdır.

Bu sütuna giren konular:
- trade-scoped payout snapshot
- post-lock drift sınırlandırma
- agreed settlement semantiği
- audit izi temiz state transition modeli

### 7.2 Trust Transparency
Araf kullanıcıya sahte güven satmamalıdır.
Onun yerine risk görünürlüğü sunmalıdır.

Bu sütuna giren konular:
- maker için detaylı risk breakdown
- taker için sınırlı güven sinyali
- açıklanabilir reputation semantiği
- kaba tek sayı yerine olay-tabanlı trust göstergeleri

### 7.3 Symmetric Protection
Sistem, iki tarafı da korumaya çalışmalıdır.
Bu nedenle ürün dilinde de altyapı tasarımında da tek tarafı ödüllendiren söylemlerden kaçınılmalıdır.

Bu sütuna giren konular:
- auto-release ve burn semantik ayrımı
- karşı tarafın mağduriyetini artırmadan risk friction üretme
- uzlaşma akışlarının temiz tasarımı

### 7.4 Merchant-Grade Ops Without Custody
Araf personel doğrulaması yapmıyor olabilir; bu, amatör operasyon yüzeyi sunması gerektiği anlamına gelmez.

Bu sütuna giren konular:
- admin observability
- feedback analizi
- incomplete trade monitor
- rate-limit stratejisi
- payout profile risk monitörü

---

## 8. Karar matrisi — geliştirmeler korunarak yeniden konumlandırma

Bu bölümde önceki plandaki geliştirmeler korunmuştur. Ancak her madde artık şu soruya göre değerlendirilir:

**Bu özellik, insan doğrulaması olmayan ama mağduriyeti minimize eden escrow tezini güçlendiriyor mu?**

## 8.1 Hemen benimsenmesi gerekenler

### A. `decayReputation` temiz dönemini 3 aya çekmek
**Karar:** Kabul.

**Neden:**
- Araf’ın güven modeli personel doğrulamasına değil davranışsal sinyallere dayanacağı için reputation çok cezalandırıcı olursa sistem geri kazanımı zorlaştırır.
- 180 gün, özellikle insan doğrulaması olmayan bir modelde gereksiz sert kalabilir.
- 90 gün daha dengeli bir “clean slate” etkisi oluşturur.

**Ürün etkisi:**
- Kalıcı damgalama riskini azaltır.
- Yeni davranışla güven toparlama alanı açar.

**Teknik etki:**
- Kontrattaki eşik güncellenir.

**Öncelik:** P0

---

### B. Payout/profile veri modeli ile fiili ürün setinin hizalanması
**Karar:** Zorunlu kabul.

**Neden:**
- İnsan doğrulaması olmayan sistemlerde veri doğruluğu, ürün güveninin yerini alan en temel katmandır.
- Desteklenen rail ile model birbirini tutmuyorsa kullanıcı güveni ve audit kalitesi zayıflar.

**Ürün etkisi:**
- Kullanıcıya söylenen ile sistemin gerçekten desteklediği şey aynı olur.
- Operasyonel sürprizler azalır.

**Öncelik:** P0

---

### C. Risk snapshot alanlarının tamamlanması
**Karar:** Zorunlu kabul.

**Neden:**
- Risk görünürlüğü, Araf’ın ana farkıdır.
- Ancak risk verisi gerçek snapshot’a dayanmıyorsa bu katman güvenilir olmaz.

**Ürün etkisi:**
- Health score ve trust transparency katmanının zemini oluşur.
- Yanlış pozitif/negatif risk işaretleri azalır.

**Öncelik:** P0

---

### D. Admin panel
**Karar:** Kabul, fakat yalnız operasyon/izleme paneli olarak.

**Kesin sınır:**
- dispute outcome belirlemez,
- release/cancel/burn override etmez,
- reputation yazmaz,
- fon hareket ettirmez.

**Bu plan içindeki yeni gerekçesi:**
Araf insan doğrulaması yapmıyor olabilir; yine de sistemin kör olmaması gerekir. Bu panel, insan hakemliği için değil; ürünün kendisini izlemesi için vardır.

**İlk sürüm kapsamı:**
- feedback kayıtlarını listeleme
- DLQ / worker hata görünürlüğü
- snapshot incomplete trade listesi
- sistem health / readiness / config görünümü

**İkinci sürüm kapsamı:**
- riskli payout profile değişim monitörü
- rate limit hit logları
- risk dashboard / trend görünürlüğü

**Öncelik:** P1

---

### E. Trade ekranında canlı referans kur akışı
**Karar:** Kabul.

**Sınır:**
- yalnız informational / UX katmanı,
- bağlayıcı değil,
- dispute veya settlement authority üretmez.

**Ürün içindeki yeni gerekçesi:**
İnsan doğrulaması olmayan sistemlerde bilgi asimetrisini azaltmak önemlidir. Referans kur, güven üretmez; ama bağlam üretir.

**Öncelik:** P1

---

### F. Tier-aware backend rate limit politikası
**Karar:** Kabul.

**Neden:**
- Araf’ın güven modeli yalnız son kullanıcıya değil, yoğun işlem yapan market participant’lara da çalışmalıdır.
- İnsan doğrulaması olmayan sistemde abusive behavior’ı yalnız ban mantığıyla değil, akıllı yüzey kontrolüyle sınırlamak gerekir.

**Doğru uygulama:**
- read, coordination write, feedback ve admin yüzeylerini ayrı bucket’lara bölmek,
- tier’a göre tavanı değiştirmek,
- kontrat create/fill akışının bu katmandan bağımsız olduğunu kabul etmek.

**Öncelik:** P1

---

### G. Health score / tier-aware risk skoru
**Karar:** Kabul, ama kesin olarak backend/UI katmanında.

**Neden:**
- Bu modül Araf’ın “risk-görünür” kimliğinin merkezindedir.
- Fakat bu skorun role’i ekonomik hüküm değil, karar desteği olmalıdır.

**Gösterim kuralı:**
- Maker: detaylı breakdown
- Taker: yalnız sınırlı özet sinyal (`GREEN / YELLOW / RED` + kısa açıklama)

**Not:**
Bu modül, snapshot risk verisi tamamlanmadan açılmamalıdır.

**Öncelik:** P1

---

### H. İtibar sinyallerinin ayrıştırılması
**Karar:** Kabul.

**Neden:**
- İnsan doğrulaması olmayan bir sistemde reputation tek sayıdan ibaret kalamaz.
- Burn, auto-release, mutual cancel ve dispute çözümleri ayrı anlam taşır.

**Önerilen ayrım:**
- `burnCount`
- `autoReleaseCount`
- `mutualCancelCount`
- `disputedButResolvedCount` (opsiyonel)

**Uygulama sırası:**
1. Önce backend/UI analytics ve score breakdown
2. Sonra kontrat seviyesinde daha ince struct/event refactor

**Öncelik:**
- Backend/UI: P1
- Kontrat refactor: P2

---

## 8.2 Güçlü adaylar, ama ayrı semantic modül olarak ele alınmalı

### I. Kısmi uzlaşma (`splitBps`) / agreed settlement
**Karar:** Kabul.

**Neden:**
- İnsan doğrulaması olmayan sistemlerde iki tarafın ortak uzlaşıyla kontrollü çıkış yapabilmesi çok değerlidir.
- Bu, dispute yerine uzlaşma yüzeyi üretir.

**Doğru çerçeve:**
Bu, cancel flow’un küçük bir yaması değil; ayrı bir settlement semantiği olmalıdır.

**Doğru tasarım:**
- yeni `SettlementProposal` tipi,
- iki taraf imzası,
- `splitBps` ile dağıtım,
- finalizer state.

**Ürün değeri:**
- iki tarafın da mağduriyetini azaltan kontrollü kapanış
- binary sonucu aşan simetrik çözüm

**Öncelik:** P2

---

### J. `paymentRiskLevel` ile risk sınıfı fiyatlaması
**Karar:** Kabul.

**Neden:**
- Araf, behavioral risk’i on-chain hükme çevirmemelidir.
- Ama kullanıcı tarafından seçilmiş coarse risk class, fiyatlama ve bond semantiği için kabul edilebilir bir sinyaldir.

**Doğru sınır:**
- on-chain: coarse, user-declared risk class
- off-chain: behavioral risk, friction, görünürlük, warning

**Uygulama örnekleri:**
- bond surcharge
- min-tier koşulu
- daha görünür uyarı

**Öncelik:** P2

---

## 8.3 Çekirdekten ayrı tutulması gereken ekonomik ve deneysel modüller

### K. “Proof of Peace” ödül sistemi
**Karar:** Kabul edilebilir, ama ayrı kontrat/modül olarak.

**Neden:**
- Bu fikir ilgi çekicidir; ancak çekirdeğin önüne geçerse ürün odağını bozar.
- Rewards, mağduriyet minimizasyonu çekirdeği oturmadan açılmamalıdır.

**Doğru yaklaşım:**
- `ArafEscrow.sol` çekirdek olarak kalır
- `ArafRewards.sol` ayrı kontrat olur
- escrow kapanış sinyallerinden epoch bazlı reward muhasebesi türetilir

**Açılma koşulları:**
- state model stabil olmalı
- reputation ayrıştırması oturmuş olmalı
- observability canlı çalışıyor olmalı

**Öncelik:** P3

---

### L. Yield-bearing bonds
**Karar:** Araştırma hattında kalmalı.

**Neden:**
- çekirdek güvenlik yüzeyini büyütür,
- valuation ve accounting karmaşıklığı ekler,
- mağduriyet minimizasyonu çekirdeğinden dikkat çalar.

**Öncelik:** P4 / Research

---

### M. Sürekli algoritmik reputation
**Karar:** Araştırma hattında kalmalı.

**Neden:**
- erken aşamada anlatıyı gereksiz karmaşıklaştırır,
- açıklanabilirlik ve governance maliyeti yaratır,
- önce ayrışmış trust semantiği kurulmalıdır.

**Öncelik:** P4 / Research

---

### N. Soulbound / taşınabilir itibar
**Karar:** Araştırma hattında kalmalı.

**Neden:**
- Araf’ın bugünkü ana işi external composability değil, güvenilir settlement semantiğidir.
- Erken açılırsa reputation anlamı dış sistemlere taşınır ve çekirdek anlatı zayıflar.

**Öncelik:** P4 / Research

---

## 8.4 Felsefeye aykırı olanlar

### O. Off-chain davranış sinyallerini doğrudan kontrata taşıyıp ekonomik hüküm üretmek
**Karar:** Reddedilmeli.

**Örnekler:**
- banka değişim geçmişine göre otomatik ekonomik ceza,
- heuristik health score’a göre kontrat seviyesinde hak kısıtlaması,
- backend risk verisine göre tek taraflı economic override.

**Neden:**
- insan doğrulaması yapmayan bir sistem, bu boşluğu gizli merkezî risk yargıcıyla doldurmamalıdır,
- Araf’ın çekirdek tezi bozulur,
- risk katmanı güvenilir karar desteği olmaktan çıkıp görünmez hüküm motoruna döner.

**Doğru alternatif:**
- friction,
- görünür uyarı,
- coarse risk class,
- ops ve analytics katmanı.

---

## 9. Uygulama planı — yeni ürün tezine göre sıralanmış sürüm

## Faz 0 — Settlement omurgasını güvenilir hale getir
Bu faz bitmeden yeni değer vaadi açılmamalıdır.

1. Fee upper bound’ları ekle
2. `decayReputation` temiz dönemini 90 güne çek
3. Payout/profile veri modeli ile route validation uyumsuzluklarını kapat
4. Destekli ödeme raylarını ürün ve kod seviyesinde aynı hale getir
5. `trades.js` ve ilgili yüzeylerde gerçek snapshot risk alanlarını üret
6. Risk/health için gerekli event ve audit izlerini standardize et

**Çıktı:**
- güvenilir settlement zemini
- doğru veri tabanı
- güvenilir risk katmanına uygun input alanı

---

## Faz 1 — Risk görünürlüğü ve operasyonel göz
Bu fazın amacı hüküm vermek değil, sistemi görünebilir kılmaktır.

1. Tier-aware health score
2. Maker dashboard score breakdown
3. Taker summary signal (`GREEN / YELLOW / RED`)
4. Feedback admin read API
5. Admin observability panel v1
6. Tier-aware backend rate limiting
7. Trade ekranı referans kur widget’ı
8. Reputation sinyallerinin backend/UI seviyesinde ayrıştırılmış analitiği

**Çıktı:**
- trust transparency
- merchant-grade ops yüzeyi
- insan hakemi olmadan çalışan ama kör olmayan sistem

---

## Faz 2 — Simetrik çözüm semantiğini genişlet
Bu faz, sistemin iki tarafı da daha az mağdur eden çıkış yolları üretmesini hedefler.

1. Partial settlement / `SettlementProposal` / `splitBps`
2. `paymentRiskLevel` ile coarse risk class fiyatlaması
3. Contract-level reputation signal separation

**Çıktı:**
- daha esnek uzlaşma yolları
- daha açıklanabilir trust semantiği
- hâlâ oracle-free kalan çekirdek genişleme

---

## Faz 3 — Ekonomik modüller ama çekirdek dışında
Bu faz yalnız çekirdek istikrar sağlandıktan sonra açılmalıdır.

1. `ArafRewards.sol`
2. Epoch bazlı rewards accounting
3. Reward pool bound’ları
4. “Proof of Peace” mantığının kontrollü açılması

**Çıktı:**
- çekirdekten ayrılmış teşvik modülü
- ürün tezini gölgelemeyen ekonomik genişleme

---

## Faz 4 — Araştırma hattı
Bu faz vizyon taşır; çekirdeği bozmaz.

1. Yield-bearing bonds
2. Sürekli algoritmik reputation
3. Soulbound / taşınabilir itibar

**Çıktı:**
- ileri dönem opsiyonları
- ama çekirdek güvenlikten bağımsız deney alanı

---

## 10. Uygulama karar filtresi

Bundan sonra yeni her özellik şu filtreyle değerlendirilmelidir:

1. Bu özellik mağduriyet minimizasyonunu güçlendiriyor mu?
2. İki tarafı da simetrik biçimde koruyor mu?
3. Risk görünürlüğü sağlıyor mu, yoksa gizli hüküm mü üretiyor?
4. Kontrat authority sınırını bozuyor mu?
5. İnsan doğrulaması olmayan modelde güvenilir settlement semantiğini güçlendiriyor mu?
6. Çekirdeği büyütmeden modüler kalabiliyor mu?

Bu soruların çoğuna olumlu yanıt veremeyen özellikler ertelenmeli veya reddedilmelidir.

---

## 11. Sonuç

Araf’ın kazanma yolu en geniş P2P pazarı olmak değildir.

Araf’ın kazanma yolu şudur:

**İnsan doğrulaması olmadan da düzenli, görünür riskli ve mağduriyeti minimize eden escrow deneyimi üretmek.**

Bu nedenle doğru strateji sırası şöyledir:

- önce settlement omurgasını temizle,
- sonra risk görünürlüğünü ve operasyon yüzeyini aç,
- daha sonra simetrik uzlaşma ve trust semantiğini genişlet,
- rewards ve deneysel ekonomileri çekirdekten ayrı tut.

Araf’ın farkı “daha çok özellik” değil, şu iddiadır:

**Karşı tarafa tam güvenmek zorunda kalmadan işlem yapabilmeyi mümkün kılan bir protokol tasarımı.**

Bu planın amacı da tam olarak bu farkı koruyarak geliştirmeleri ileri taşımaktır.
