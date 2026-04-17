# Frontend UX/UI Revizyon Planı

## Amaç

Bu planın amacı Araf Protocol frontend'ini aşağıdaki açılardan sistematik biçimde iyileştirmektir:

- bilgi mimarisini sadeleştirmek
- kritik işlem akışlarını daha anlaşılır hale getirmek
- görsel yoğunluğu kontrol altına almak
- mobil deneyimi güçlendirmek
- güvenlik/güven hissini koruyup bilişsel yükü düşürmek
- ürün dilini teknik enum ve kontrat terminolojisinden kullanıcı diline çevirmek

Bu doküman bir tasarım eleştirisi değil, uygulanabilir ürün/arayüz revizyon planıdır.

---

## Mevcut Durum Özeti

Frontend tarafında güçlü bir ürün kimliği vardır:

- koyu tema
- yüksek güvenlik hissi
- kontrat/protokol odaklı sert ton
- state-driven trade room yaklaşımı
- hata ve risk senaryolarını görünür kılan yapı

Ancak mevcut arayüzde aşağıdaki problemler belirgindir:

1. Aynı anda çok fazla bilgi ve uyarı gösteriliyor.
2. Navigasyon yüzeyleri çoğalmış durumda (rail, sidebar, mobile nav, modal katmanları, floating feedback butonu, top banner'lar).
3. Kullanıcıya gösterilen dil, bazı yerlerde ham domain/kontrat enum'larına çok yakın.
4. Kritik aksiyonlarda her zaman tek bir "şimdi ne yapmalıyım" odağı yok.
5. Çok küçük tipografi ve yüksek görsel yoğunluk okunabilirliği düşürüyor.
6. Mobil deneyimde önceliklendirme yetersiz.
7. Profile Center modal olarak fazla büyümüş ve ayrı sayfa olmayı hak ediyor.
8. Sidebar auto-close davranışı kullanılabilirliği zedeliyor.

---

## Revizyonun Ana Prensipleri

### 1. Birincil aksiyon tek bakışta anlaşılmalı
Her ekran, özellikle kritik durumlarda, kullanıcıya birincil aksiyonu açık biçimde göstermeli.

### 2. Teknik doğruluk korunmalı, kullanıcı dili sadeleşmeli
Kontrat ve backend terminolojisi sistem içinde kalmalı; kullanıcı yüzeyinde sade karşılıkları görünmeli.

### 3. Güvenlik metinleri korunmalı ama dozajlanmalı
Risk uyarıları kaybolmamalı; ancak birincil akışın üzerine yığılmamalı.

### 4. Görsel enerji kontrollü kullanılmalı
Renk, glow, border, badge ve animasyon yalnızca gerçekten önemli noktalarda vurgu için kullanılmalı.

### 5. Modal yerine sayfa mantığı tercih edilmeli
Uzun, çok sekmeli ve kalıcı kullanım alanları modal yerine ayrı route/page olmalı.

### 6. Mobil deneyim ayrı bir önceliklendirme ile ele alınmalı
Desktop'taki yoğun bilgi yüzeyi mobilde aynı biçimde taşınmamalı.

---

## Revizyon Yol Haritası

## Faz 1 — Hızlı Kazanımlar

Bu faz davranış ve mimariyi kökten değiştirmeden, algılanan kaliteyi ve kullanılabilirliği hızlı artırır.

### 1. Sidebar auto-close kaldırılmalı
**Sorun:** Sidebar 5 saniye sonra otomatik kapanıyor.

**Etkisi:**
- filtre kullanımını zorlaştırıyor
- demo hissi veriyor
- kullanıcıyı acele ettiriyor

**Revizyon:**
- auto-close tamamen kaldırılmalı
- aç/kapa yalnızca kullanıcı etkileşimiyle yapılmalı
- mobilde overlay click ile kapanma devam edebilir

**Muhtemel dosyalar:**
- `frontend/src/App.jsx`
- `frontend/src/app/AppViews.jsx`

---

### 2. Top banner sistemi tek katmanda toplanmalı
**Sorun:** Aynı anda env, maintenance, wrong network, anti-sybil gibi birden çok üst uyarı çıkabiliyor.

**Etkisi:**
- ekranın üst kısmı kalabalıklaşıyor
- hiyerarşi bozuluyor
- mobilde alan daralıyor

**Revizyon:**
- tek bir `SystemStatusBar` bileşeni oluşturulmalı
- uyarılar öncelik seviyesine göre sıralanmalı
- aynı anda yalnızca en kritik 1 veya 2 durum gösterilmeli
- kalan durumlar "daha fazla" altında listelenebilir

**Öncelik sırası örneği:**
1. wrong network
2. bakım modu
3. auth/session mismatch
4. wallet registration / anti-sybil
5. env warning

**Muhtemel dosyalar:**
- `frontend/src/App.jsx`
- yeni: `frontend/src/components/SystemStatusBar.jsx`

---

### 3. Kullanıcı yüzeyinden ham enum'lar kaldırılmalı
**Sorun:** `SELL_CRYPTO`, `BUY_CRYPTO`, `LOCKED`, `PAID`, `CHALLENGED` gibi ham domain string'leri ekranda görünüyor.

**Etkisi:**
- ürün teknik görünür
- yeni kullanıcı için anlam eşiği yükselir
- güven yerine karmaşa oluşur

**Revizyon:**
Aşağıdaki gibi kullanıcı dostu label sistemi kullanılmalı:

| Sistem değeri | Kullanıcı etiketi (TR) | Kullanıcı etiketi (EN) |
|---|---|---|
| `SELL_CRYPTO` | Kripto Sat | Sell Crypto |
| `BUY_CRYPTO` | Kripto Al | Buy Crypto |
| `LOCKED` | Fon Kilitlendi | Funds Locked |
| `PAID` | Ödeme Bildirildi | Payment Reported |
| `CHALLENGED` | Uyuşmazlık Süreci | Dispute Phase |
| `RESOLVED` | Tamamlandı | Resolved |
| `CANCELED` | İptal Edildi | Canceled |
| `BURNED` | Süresi Doldu / Yakıldı | Burned |

**Muhtemel dosyalar:**
- `frontend/src/app/orderModel.js` veya yeni adıyla UI model dosyası
- `frontend/src/app/AppViews.jsx`
- `frontend/src/app/AppModals.jsx`

---

### 4. Minimum tipografi eşiği yükseltilmeli
**Sorun:** Çok fazla `text-[10px]`, `text-[11px]`, `text-xs` kullanılıyor.

**Etkisi:**
- kritik metinler okunmuyor
- güvenlik metinleri fark edilmiyor
- mobilde kullanım zorlaşıyor

**Revizyon hedefi:**
- kritik body metni: minimum 14px
- yardımcı metin: minimum 12px
- yalnızca micro metadata: 11px
- 10px kullanımını büyük ölçüde kaldır

**Tipografi hiyerarşisi önerisi:**
- H1: 32–40px
- H2: 24–28px
- H3: 18–20px
- primary body: 14–16px
- secondary body: 12–13px
- metadata: 11–12px

**Muhtemel dosyalar:**
- `frontend/src/app/AppViews.jsx`
- `frontend/src/app/AppModals.jsx`
- `frontend/src/components/PIIDisplay.jsx`

---

### 5. Dil tutarlılığı temizlenmeli
**Sorun:** Türkçe arayüz içinde İngilizce ve teknik kırıntılar kalıyor.

**Revizyon:**
- tüm kullanıcıya görünen string'ler tek sözlük katmanına çekilmeli
- badge, helper, status, button, tooltip, modal metinleri tek yerden yönetilmeli
- "Grace Period", "Remaining", "Connect", "End-to-End Encrypted", "Rail" gibi metinler lokalleştirilmeli

**Muhtemel dosyalar:**
- `frontend/src/App.jsx`
- `frontend/src/app/AppViews.jsx`
- `frontend/src/app/AppModals.jsx`
- `frontend/src/components/PIIDisplay.jsx`

---

## Faz 2 — Ekran Bazlı UX/UI Revizyonu

## 2.1 Ana Sayfa

### Mevcut sorunlar
- Ürün manifestosu güçlü ama onboarding yönlendirmesi zayıf
- İlk kez gelen kullanıcı için net başlangıç adımı yok
- İstatistik kartları anlamlı ama aksiyonla yeterince bağlanmıyor

### Revizyon hedefi
Ana sayfa şu sorulara tek bakışta cevap vermeli:
- Bu ürün ne yapar?
- Ben burada ne yaparım?
- İlk adımım nedir?
- Risk modeli nedir?

### Önerilen yapı
1. **Hero alanı**
   - başlık
   - kısa değer önerisi
   - iki ana CTA:
     - `Cüzdanı Bağla`
     - `Pazar Yerine Git`

2. **Nasıl çalışır? (3 adım)**
   - 1. Cüzdan bağla
   - 2. Order seç veya order aç
   - 3. İşlem odasında süreci tamamla

3. **Risk ve güven modeli**
   - hakem yok
   - kontrat kaynaklı kurallar
   - uyuşmazlıkta ekonomik baskı

4. **Canlı sistem metrikleri**
   - mevcut kartlar korunabilir ama sadeleştirilmeli

5. **SSS**
   - accordion yapısı korunabilir

### UI önerileri
- hero içinde daha fazla negatif alan
- istatistik kartlarında daha az border/gölge
- FAQ bloğunda daha sakin görünüm
- aynı anda birden fazla vurgu rengini azalt

---

## 2.2 Marketplace

### Mevcut sorunlar
- Her kart çok fazla bilgi taşıyor
- maker tooltip profili faydalı ama birincil içeriği bastırıyor
- anti-sybil ve cooldown açıklamaları CTA ile yarışıyor

### Revizyon hedefi
Her kartta kullanıcı önce şunu görmeli:
- varlık
- kur
- kalan miktar
- minimum limit
- ana aksiyon

### Kart hiyerarşisi önerisi
**Katman 1 — Birincil bilgi**
- side etiketi (kullanıcı diliyle)
- maker kısa kimlik
- kur
- kalan miktar
- CTA

**Katman 2 — İkincil bilgi**
- tier
- bond
- status
- min/max limit

**Katman 3 — Yardımcı bilgi**
- maker başarı oranı
- işlem sayısı
- anti-sybil açıklaması

### Revizyon önerileri
- maker profil tooltip'i kart üstünden alınmalı, küçük `Profil` veya `Detay` tıklamasıyla açılmalı
- anti-sybil/cooldown gerekçeleri butonun altında tek satırlık sistem mesajı olarak görünmeli
- `wrong network`, `token not configured`, `low balance` gibi disabled nedenleri küçük helper text olarak verilmeli
- side badge daha kullanıcı dostu hale getirilmeli
- kartlar masaüstünde daha yatay, mobilde daha dikey bloklar olarak ayrılmalı

### Filtre alanı
- mevcut filtre mantığı korunabilir
- ancak `search + token + low risk` bloğu daha düzenli bir filtre paneline dönmeli
- "Tier 0-1 düşük risk" ifadesi kullanıcı açısından açıklayıcı ama fazla uzun; kısa toggle label + helper tooltip önerilir

---

## 2.3 Maker Order Modalı

### Mevcut sorunlar
- form doğru ama tek blok halinde
- field grupları yeterince ayrışmıyor
- side seçimi teknik isimlerle gösteriliyor

### Revizyon hedefi
Modal şu sırayla akmalı:
1. Ne yapmak istiyorsun?
2. Hangi varlık?
3. Ne kadar?
4. Hangi kur ve limitler?
5. Hangi tier?
6. Toplam kilit/teminat özeti

### Yeni yapı önerisi
#### Bölüm 1 — İşlem tipi
- `Kripto Sat`
- `Kripto Al`

#### Bölüm 2 — Varlık ve para birimi
- token
- fiat currency

#### Bölüm 3 — Miktar ve kur
- order amount
- exchange rate

#### Bölüm 4 — Limitler
- minimum işlem
- maksimum işlem
- gerçek zamanlı toplam fiat değeri bilgisi

#### Bölüm 5 — Tier
- seçilebilir tier kartları
- kilitli tier'larda neden kullanılamadığı helper text ile gösterilmeli

#### Bölüm 6 — Özet
- reserve / bond
- toplam kilit
- kullanıcıya ne olacağı çok net anlatılmalı

### Validation UX önerileri
- tek bir hata satırı yerine field-level hata da gösterilmeli
- submit butonu disabled olduğunda neden disabled olduğu daha net görünmeli
- `Tier 0 max 150` gibi kural metinleri helper olarak alanın altında önceden gösterilmeli

---

## 2.4 Trade Room

Bu ürünün en önemli ekranı burasıdır.

### Mevcut güçlü yönler
- state bazlı aksiyonlar düşünülmüş
- maker/taker ayrımı net
- bleeding escrow görsellemesi ürün kimliği açısından güçlü
- countdown ve challenge akışı etkileyici

### Mevcut sorunlar
- aynı anda çok fazla uyarı ve metin var
- ana aksiyon her zaman birinci planda değil
- challenged ekranı çok yoğun
- bilgi, uyarı ve işlem butonları birbirine yakın ağırlıkta

### Revizyon hedefi
Trade Room her state için tek bir karar ekranı gibi çalışmalı.

### Önerilen state bazlı yapı

#### A. LOCKED
**Ana soru:** Şimdi kim ne yapmalı?

- Taker için ana aksiyon: `Dekont Yükle ve Ödeme Bildir`
- Maker için ana mesaj: `Ödeme bekleniyor`
- İkincil bilgi: karşı taraf, miktar, süre, güvenlik notu

**Revizyon önerisi:**
- receipt upload ve report payment iki ayrı buton yerine daha birleşik akışa dönüştürülebilir
- maker tarafında taker name fraud uyarısı ayrı bir `Güvenlik Uyarısı` kutusunda verilmeli
- teknik notlar foldable info panelde toplanmalı

#### B. PAID
**Ana soru:** Maker onay verecek mi, vermeyecek mi?

- büyük countdown
- tek ana CTA: `Fonları Serbest Bırak`
- ikincil CTA: `Uyuşmazlık / İtiraz Süreci`
- taker tarafında ise tek ana gösterim: `Onay Bekleniyor`

**Revizyon önerisi:**
- chargeback acknowledgement checkbox ana CTA ile daha yakın konumlanmalı
- maker challenge akışı, release akışının görsel hiyerarşisini bozmamalı
- taker tarafında ping/auto-release süreci tek bir durum kartı halinde sunulmalı

#### C. CHALLENGED
**Ana soru:** Sistem baskısı altında uzlaşma mı, bekleme mi?

- bleeding escrow görseli korunmalı
- ama yanında tek bakışta sade açıklama olmalı:
  - ne yanıyor
  - ne kadar süre kaldı
  - benim en mantıklı aksiyonum ne

**Revizyon önerisi:**
- mevcut dramatik bar korunabilir ancak çevresindeki copy sadeleşmeli
- `Release`, `Cancel`, `BurnExpired` gibi aksiyonlar ayrı risk seviyelerine göre gruplanmalı
- "geri dönüşü olmayan" işlemler için ayrı danger zone bölümü oluşturulmalı

### Trade Room genel tasarım prensibi
Her durumda ekranın üst bölümünde şu üç blok sabit olmalı:
1. işlem özeti
2. mevcut durum
3. birincil aksiyon

Alt bölümde ise:
- yardımcı aksiyonlar
- güvenlik açıklamaları
- teknik detaylar
- PII ve iletişim bilgileri

---

## 2.5 PII Görüntüleme Akışı

### Güçlü yönler
- reveal gating doğru
- secure-context copy handling iyi
- görsel güvenlik hissi iyi

### Revizyon hedefi
Bu bileşen güvenlik hissini korurken daha sakin ve net olmalı.

### Öneriler
- `End-to-End Encrypted` badge biraz daha sadeleştirilmeli
- açık görünümde unnecessary field dump azaltılmalı
- kullanıcıya en önemli alanlar önce gösterilmeli:
  1. ad soyad
  2. IBAN
  3. Telegram
- düşük önemdeki payout alanları default collapsed olabilir
- `Hide` butonu secondary style ile kalabilir
- kopyalama sonrası success state daha sakin olabilir

---

## 2.6 Profile Center

### Mevcut sorun
Bu alan modal için fazla büyük ve fazla kalıcı kullanım içeriyor.

### Revizyon kararı
Profile Center orta vadede modal olmaktan çıkarılmalı ve ayrı bir route olmalı.

### Yeni önerilen bilgi mimarisi
- `/profile/settings`
- `/profile/reputation`
- `/profile/orders`
- `/profile/active-trades`
- `/profile/history`

### Kısa vadeli geçiş çözümü
Route'a geçmeden önce mevcut modal sadeleştirilebilir:
- tab sayısı azaltılmalı veya gruplanmalı
- iç içerik kartları daha net ayrılmalı
- `itibar` sekmesi daha az metin, daha çok görsel ilerleme odaklı olmalı
- `aktif işlemler` sekmesinde tek satır özet yerine daha düzenli kart yapısı kullanılmalı
- `orderlarım` kartlarında kullanıcı diline geçilmeli

---

## Faz 3 — Mimari UX İyileştirmeleri

## 3.1 Router tabanlı bilgi mimarisi

### Mevcut sorun
`currentView` state yaklaşımı:
- derin link üretmiyor
- geri/ileri davranışını sınırlıyor
- kullanıcıya kalıcı konum hissi vermiyor

### Revizyon hedefi
Aşağıdaki route yapısı önerilir:

- `/`
- `/market`
- `/trade/:tradeId`
- `/profile`
- `/profile/orders`
- `/profile/history`
- `/faq`

### Kazanımlar
- paylaşılabilir URL
- daha doğal browser navigation
- hata ayıklama kolaylığı
- analytics/event takibi kolaylığı

---

## 3.2 Design token standardizasyonu

### Sorun
Border, radius, text size ve vurgu yoğunluğu yer yer dağınık.

### Revizyon
Tasarım token seti belirlenmeli:

- radius scale
- spacing scale
- font size scale
- semantic color set
- status badge sistemi
- button varyantları
- info/warning/error/success panel sistemi

### Önerilen semantic renkler
- primary action: emerald
- secondary action: slate
- warning: amber/orange
- danger: red
- info: blue
- neutral metadata: slate

---

## 3.3 Ortak bileşen seti

Tekrarlanan yapılar ortaklaştırılmalı:

- `StatusBadge`
- `ActionPanel`
- `SystemMessage`
- `MetricCard`
- `SectionCard`
- `DangerZone`
- `CountdownCard`
- `EmptyState`

Bu sayede görsel tutarlılık ve bakım kolaylığı artar.

---

## Mobil Revizyon Planı

## Ana hedef
Mobilde içerik azaltılmalı, hiyerarşi sertleştirilmeli.

### 1. Sabit eleman sayısı azaltılmalı
- floating feedback butonu mobilde ya küçültülmeli ya da alt nav içine alınmalı
- top banner alanı tek katmana indirilmeli
- mobilde ikinci derece bilgi collapsed gelmeli

### 2. Trade Room mobil önceliklendirme
Mobilde şu sıra önerilir:
1. durum
2. ana aksiyon
3. countdown
4. temel işlem özeti
5. detaylar

### 3. Modal davranışı
- profile modal tam sayfa sheet mantığına yaklaşmalı
- maker modal mobilde çok adımlı akışa bölünebilir
- form alanları arasında daha fazla dikey boşluk verilmeli

### 4. Dokunma hedefleri
- küçük ikon butonlar büyütülmeli
- text butonlar minimum 44px yüksekliğe yaklaşmalı

---

## Erişilebilirlik Planı

### Hedefler
- minimum kontrast iyileştirmesi
- font boyutu standardizasyonu
- keyboard/focus görünürlüğü
- renk dışında da durum anlatımı
- icon-only alanları azaltma

### Yapılacaklar
1. tüm interaktif elemanlara belirgin focus style ekle
2. badge ve state bilgilerini yalnız renkle anlatma
3. çok küçük metinleri büyüt
4. aria-label eksik alanları tamamla
5. tooltip'e bağımlı bilgi yoğunluğunu azalt

---

## Önceliklendirilmiş İş Listesi

## P1 — Acil
- Sidebar auto-close kaldır
- Top banner'ları tek sistem bar'a indir
- Ham enum'ları kullanıcı diline çevir
- Küçük tipografi kullanımını azalt
- Localization drift temizliği yap
- Marketplace kart hiyerarşisini sadeleştir
- Trade Room'da her state için tek ana CTA odağı kur

## P2 — Yakın vade
- Maker modalı section-based yapıya geçir
- Profile Center'i sadeleştir
- PII açık görünümünü sadeleştir
- Ortak status/badge/button bileşenlerini oluştur
- Mobilde floating feedback yaklaşımını gözden geçir

## P3 — Orta vade
- Router mimarisine geç
- Profile Center'i ayrı sayfa yap
- Design token standardizasyonu uygula
- Ortak layout ve state panel sistemi kur

---

## Başarı Kriterleri

Revizyon başarılı sayılabilmesi için aşağıdaki sonuçlar hedeflenmelidir:

1. Kullanıcı ilk 10 saniyede temel akışı anlayabilmeli.
2. Marketplace kartı tek bakışta okunabilmeli.
3. Trade Room'da kullanıcı her state'te ne yapacağını kararsız kalmadan görebilmeli.
4. Mobilde kritik bilgi ve ana aksiyon ilk ekranda görünmeli.
5. Türkçe ve İngilizce metinler tutarlı olmalı.
6. 10–11px kritik metin yoğunluğu ciddi biçimde azaltılmış olmalı.
7. Ürün karakteri korunurken görsel gürültü azalmış olmalı.

---

## Önerilen Uygulama Sırası

### Sprint 1
- sidebar
- top banner birleşimi
- enum label dönüşümü
- tipografi revizyonu
- localization cleanup

### Sprint 2
- marketplace kart sadeleştirme
- maker modal section layout
- trade room state bazlı CTA revizyonu
- PII bileşeni sadeleştirme

### Sprint 3
- profile area yeniden yapılandırma
- ortak bileşen seti
- mobil optimizasyon

### Sprint 4
- router geçişi
- profile ayrı sayfa
- design token standardizasyonu

---

## Sonuç

Araf Protocol frontend'i tasarım karakteri ve ürün tonu açısından güçlü bir temel sunuyor. Revizyonun amacı bu karakteri bozmak değil; ürünün güçlü yönlerini koruyup daha okunur, daha yönlendirici ve daha sürdürülebilir bir kullanıcı deneyimine dönüştürmektir.

Bu plan uygulandığında beklenen sonuç:

- daha az teknik görünen
- daha çok güven veren
- daha hızlı öğrenilen
- daha az yorucu
- mobilde daha kontrollü
- kritik işlem anlarında daha net yönlendiren

bir frontend deneyimidir.
