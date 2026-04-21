# Frontend UX/UI Revizyon Planı — V2

## Amaç

Bu planın amacı Araf Protocol frontend'ini aşağıdaki açılardan sistematik biçimde iyileştirmektir:

- bilgi mimarisini sadeleştirmek
- kritik işlem akışlarını daha anlaşılır hale getirmek
- görsel yoğunluğu kontrol altına almak
- mobil deneyimi güçlendirmek
- güvenlik/güven hissini koruyup bilişsel yükü düşürmek
- ürün dilini teknik enum ve kontrat terminolojisinden kullanıcı diline çevirmek
- **hakemsiz escrow sisteminde kullanıcıyı doğru aksiyona hızla yönlendirmek**

Bu doküman bir tasarım eleştirisi değil, uygulanabilir ürün/arayüz revizyon planıdır.

---

## Kritik Ürün Nüansı

Bu revizyonda özellikle şu ayrım korunmalıdır:

### `LOCKED`, `PAID`, `CHALLENGED` iki farklı düzlemde vardır

1. **Trade Room state'i olarak**
   - Bir işlem odasının içinde bulunduğu gerçek protokol durumunu temsil eder.
   - O odada hangi ana aksiyonun gösterileceğini belirler.

2. **Kullanıcının aktif işlemlerine kısa erişim filtresi olarak**
   - Kullanıcı bir sekme/filtre olarak `LOCKED`, `PAID` veya `CHALLENGED`e tıkladığında,
     o durumdaki aktif işlemleri listeler.
   - Amaç yeni bir state üretmek değil, ilgili odalara hızlı erişim sağlamaktır.
   - Kullanıcı listeden bir işleme tıkladığında ilgili trade room'a yönlendirilir.

Bu yüzden frontend planında şu hata yapılmamalıdır:

- `LOCKED / PAID / CHALLENGED` yalnızca trade room ekran state'i gibi ele alınmamalı
- aynı zamanda **aktif işlemler için erişim/hızlı filtreleme yüzeyi** olarak korunmalıdır

---

## Mevcut Kodda Teyit Edilen Davranış

Mevcut frontend implementasyonunda bu davranış gerçekten vardır:

- Profil merkezi içinde `Aktif İşlemler` sekmesi bulunur.
- Bu sekmede `ALL`, `LOCKED`, `PAID`, `CHALLENGED` filtreleri yer alır.
- Filtre seçildiğinde yalnız ilgili state'teki aktif işlemler listelenir.
- Kullanıcı listeden bir item seçtiğinde:
  - profil modalı kapanır
  - ilgili trade aktif trade olarak atanır
  - kullanıcı rolü atanır
  - trade state atanır
  - chargeback ack state taşınır
  - kullanıcı `tradeRoom` görünümüne yönlendirilir

Bu nedenle bu alan yalnız görsel filtre değil; **odaya yönlendiren kısa erişim yüzeyidir**.

---

## Revizyonun Yeni Ana Prensipleri

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

### 7. Hakemsiz sistemde yönlendirme net olmalı
Araf bir insan hakemiyle çalışan ürün olmadığı için arayüz “bilgi gösteren” değil, **karar netliği sağlayan** bir yapıda olmalı.

### 8. Aktif işlemler erişim yüzeyi korunmalı
`LOCKED / PAID / CHALLENGED` hızlı erişim mantığı kaybolmamalı; tersine daha görünür ve daha hızlı hale getirilmeli.

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
2. Navigasyon yüzeyleri çoğalmış durumda.
3. Kullanıcıya gösterilen dil, bazı yerlerde ham domain/kontrat enum'larına çok yakın.
4. Kritik aksiyonlarda her zaman tek bir “şimdi ne yapmalıyım” odağı yok.
5. Çok küçük tipografi ve yüksek görsel yoğunluk okunabilirliği düşürüyor.
6. Mobil deneyimde önceliklendirme yetersiz.
7. Profile Center modal olarak fazla büyümüş ve ayrı sayfa olmayı hak ediyor.
8. Sidebar auto-close davranışı kullanılabilirliği zedeliyor.
9. Aktif işlemler filtre yüzeyi ürün açısından değerli ama bilgi mimarisinde yeterince merkezi değil.

---

## Revizyon Yol Haritası

## Faz 1 — Hızlı Kazanımlar

### 1. Sidebar auto-close kaldırılmalı
- auto-close tamamen kaldırılmalı
- aç/kapa yalnızca kullanıcı etkileşimiyle yapılmalı
- mobilde overlay click ile kapanma devam edebilir

### 2. Top banner sistemi tek katmanda toplanmalı
- tek bir `SystemStatusBar` bileşeni oluşturulmalı
- uyarılar öncelik seviyesine göre sıralanmalı
- aynı anda yalnızca en kritik 1 veya 2 durum gösterilmeli

### 3. Kullanıcı yüzeyinden ham enum'lar kaldırılmalı
Kullanıcıya görünen alanlarda teknik değerler yerine sade etiketler kullanılmalı.

Örnek:

| Sistem değeri | Kullanıcı etiketi (TR) | Kullanıcı etiketi (EN) |
|---|---|---|
| `SELL_CRYPTO` | Kripto Sat | Sell Crypto |
| `BUY_CRYPTO` | Kripto Al | Buy Crypto |
| `LOCKED` | Kilitli İşlem | Locked Trade |
| `PAID` | Ödeme Bildirildi | Payment Reported |
| `CHALLENGED` | İtiraz Süreci | Challenge Phase |
| `RESOLVED` | Tamamlandı | Resolved |
| `CANCELED` | İptal Edildi | Canceled |
| `BURNED` | Süresi Doldu / Yakıldı | Burned |

### 4. Minimum tipografi eşiği yükseltilmeli
- kritik body metni: minimum 14px
- yardımcı metin: minimum 12px
- yalnızca micro metadata: 11px
- 10px kullanımını büyük ölçüde kaldır

### 5. Dil tutarlılığı temizlenmeli
- tüm kullanıcıya görünen string'ler tek sözlük katmanına çekilmeli
- badge, helper, status, button, tooltip, modal metinleri tek yerden yönetilmeli

---

## Faz 2 — Ekran Bazlı UX/UI Revizyonu

## 2.1 Ana Sayfa

Ana sayfa şu sorulara tek bakışta cevap vermeli:
- Bu ürün ne yapar?
- Ben burada ne yaparım?
- İlk adımım nedir?
- Hakem yoksa sistem beni nasıl korur?

Önerilen yapı:
1. Hero alanı
2. Nasıl çalışır? (3 adım)
3. Risk ve güven modeli
4. Canlı sistem metrikleri
5. SSS

---

## 2.2 Marketplace

Her kartta kullanıcı önce şunu görmeli:
- varlık
- kur
- kalan miktar
- minimum limit
- ana aksiyon

Kart hiyerarşisi:
- Katman 1: birincil bilgi
- Katman 2: ikincil bilgi
- Katman 3: yardımcı bilgi

Not:
- maker profil detayları kartı boğmamalı
- anti-sybil ve cooldown gerekçeleri CTA ile yarışmamalı
- disabled nedenleri yardımcı metin olarak gösterilmeli

---

## 2.3 Maker Order Modalı

Akış şu sırayla okunmalı:
1. Ne yapmak istiyorsun?
2. Hangi varlık?
3. Ne kadar?
4. Hangi kur ve limitler?
5. Hangi tier?
6. Toplam kilit/teminat özeti

Bu alan section-based yapıya geçirilmeli.

---

## 2.4 Trade Room

Bu ürünün en önemli ekranı burasıdır.

### Kritik ayrım
Trade Room revizyonunda `LOCKED / PAID / CHALLENGED` state'leri **oda içi karar state'i** olarak ele alınmalıdır.
Ama bunlar aynı zamanda aktif işlemler listesinde hızlı erişim filtreleri olarak da yaşar.

Bu nedenle iki yüzey birbirine karıştırılmamalı:

- **Aktif İşlemler görünümü:** o state'teki işlemleri bulmak ve odaya girmek için
- **Trade Room görünümü:** girdikten sonra ne yapılacağını göstermek için

### Trade Room hedefi
Her state için ekran tek bir karar ekranı gibi çalışmalı.

#### A. LOCKED
Ana soru: Şimdi kim ne yapmalı?

- Taker için ana aksiyon: `Dekont Yükle ve Ödeme Bildir`
- Maker için ana mesaj: `Ödeme bekleniyor`
- Teknik notlar foldable panelde toplanmalı

#### B. PAID
Ana soru: Maker onay verecek mi, vermeyecek mi?

- büyük countdown
- tek ana CTA: `Fonları Serbest Bırak`
- ikincil CTA: `Uyuşmazlık / İtiraz Süreci`
- taker tarafında ana gösterim: `Onay Bekleniyor`

#### C. CHALLENGED
Ana soru: Sistem baskısı altında uzlaşma mı, bekleme mi?

- bleeding escrow görseli korunmalı
- ama yanında sade açıklama olmalı:
  - ne yanıyor
  - ne kadar süre kaldı
  - benim en mantıklı aksiyonum ne

### Trade Room genel prensibi
Üst bölümde sabit üç blok:
1. işlem özeti
2. mevcut durum
3. birincil aksiyon

Alt bölümde:
- yardımcı aksiyonlar
- güvenlik açıklamaları
- teknik detaylar
- PII ve iletişim bilgileri

---

## 2.5 Aktif İşlemler Kısa Erişim Yüzeyi

Bu bölüm önceki planda olduğundan daha açık tanımlanmalıdır.

### Ürün rolü
Bu yüzeyin amacı:
- kullanıcının o anda açık işlemlerini kısa yoldan bulması
- `LOCKED / PAID / CHALLENGED` durumuna göre filtrelemesi
- ilgili odaya tek tıkla geçebilmesi

### Bu alan ne değildir?
- yalnızca istatistik paneli değildir
- yalnızca liste görünümü değildir
- yalnızca trade state etiketi değildir

### Bu alan nedir?
- **aktif anlaşma yönetim merkezi**
- **trade room'a yönlendiren erişim paneli**

### Revizyon hedefi
Aktif İşlemler alanı daha görünür hale getirilmeli ama Profile Center içinde kaybolmamalıdır.

### Öneriler
- `ALL / LOCKED / PAID / CHALLENGED` filtreleri korunmalı
- filtre butonları state badge mantığıyla daha okunur hale getirilmeli
- her kartta şu alanlar tek bakışta görünmeli:
  - trade id
  - rol (maker/taker)
  - amount
  - karşı taraf
  - state
  - ana CTA: `Odaya Git`
- `PAID` ve `CHALLENGED` işlemler görsel öncelik kazanmalı
- mobilde bu alan tam genişlik kartlar halinde gösterilmeli

### Orta vadeli öneri
Bu alan yalnız Profile Center sekmesi olarak kalmak zorunda değil.
Ayrı route'a da taşınabilir:

- `/trades/active`
- `/trades/active?state=locked`
- `/trades/active?state=paid`
- `/trades/active?state=challenged`

Böylece kısa erişim mantığı korunur, hatta güçlenir.

---

## 2.6 PII Görüntüleme Akışı

Bu bileşen güvenlik hissini korurken daha sakin ve net olmalı.

Öneriler:
- şifreleme badge'i sadeleşmeli
- önemli alanlar önce gösterilmeli
- düşük önemdeki alanlar collapsed gelebilmeli
- kopyalama sonrası başarı state'i daha sakin sunulmalı

---

## 2.7 Profile Center

### Karar
Profile Center orta vadede modal olmaktan çıkarılmalı ve ayrı route olmalı.

### Bilgi mimarisi önerisi
- `/profile/settings`
- `/profile/reputation`
- `/profile/orders`
- `/profile/active-trades`
- `/profile/history`

### Önemli not
`Aktif İşlemler` bölümü burada yalnız pasif bir sekme olarak değil,
ürünün işlem takip merkezi olarak tasarlanmalıdır.

---

## Faz 3 — Mimari UX İyileştirmeleri

## 3.1 Router tabanlı bilgi mimarisi

Önerilen route yapısı:

- `/`
- `/market`
- `/trade/:tradeId`
- `/profile`
- `/profile/orders`
- `/profile/active-trades`
- `/profile/history`
- `/faq`

Ek öneri:
- aktif trade filtreleri query param ile desteklenmeli
  - `/profile/active-trades?state=paid`
  - `/profile/active-trades?state=challenged`

---

## 3.2 Design token standardizasyonu

Belirlenmeli:
- radius scale
- spacing scale
- font size scale
- semantic color set
- status badge sistemi
- button varyantları
- info/warning/error/success panel sistemi

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
- `ActiveTradeCard`
- `TradeStateFilterBar`

---

## Mobil Revizyon Planı

Mobilde şu sıra korunmalı:
1. durum
2. ana aksiyon
3. countdown
4. temel işlem özeti
5. detaylar

Aktif işlemler görünümünde:
- filtre bar daha büyük dokunma alanı almalı
- `Odaya Git` CTA ilk ekranda görünmeli
- `PAID` ve `CHALLENGED` kartları daha ayırt edilebilir olmalı

---

## Erişilebilirlik Planı

Yapılacaklar:
1. focus style ekle
2. durumları yalnız renkle anlatma
3. küçük metinleri büyüt
4. aria-label eksiklerini tamamla
5. tooltip'e bağımlı bilgi yoğunluğunu azalt

---

## Önceliklendirilmiş İş Listesi

## P1 — Acil
- Sidebar auto-close kaldır
- Top banner'ları tek system bar'a indir
- Ham enum'ları kullanıcı diline çevir
- Küçük tipografi kullanımını azalt
- Localization drift temizliği yap
- Marketplace kart hiyerarşisini sadeleştir
- Trade Room'da her state için tek ana CTA odağı kur
- Aktif İşlemler filtresini ürün merkezli dille yeniden tasarla

## P2 — Yakın vade
- Maker modalı section-based yapıya geçir
- Profile Center'i sadeleştir
- PII açık görünümünü sadeleştir
- Ortak status/badge/button bileşenlerini oluştur
- Mobilde aktif trade kartlarını optimize et
- `PAID / CHALLENGED` erişim önceliğini artır

## P3 — Orta vade
- Router mimarisine geç
- Profile Center'i ayrı sayfa yap
- Active Trades için ayrı route aç
- Design token standardizasyonu uygula
- Ortak layout ve state panel sistemi kur

---

## Başarı Kriterleri

Revizyon başarılı sayılabilmesi için:

1. Kullanıcı ilk 10 saniyede temel akışı anlayabilmeli.
2. Marketplace kartı tek bakışta okunabilmeli.
3. Trade Room'da kullanıcı her state'te ne yapacağını kararsız kalmadan görebilmeli.
4. Mobilde kritik bilgi ve ana aksiyon ilk ekranda görünmeli.
5. Türkçe ve İngilizce metinler tutarlı olmalı.
6. 10–11px kritik metin yoğunluğu ciddi biçimde azaltılmış olmalı.
7. Ürün karakteri korunurken görsel gürültü azalmış olmalı.
8. Kullanıcı `LOCKED / PAID / CHALLENGED` aktif işlemlerini hızlıca filtreleyip ilgili odaya gidebilmeli.
9. Aktif İşlemler yüzeyi yalnız liste değil, yönlendirme merkezi gibi çalışmalı.

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
- aktif işlemler kart/filtre iyileştirmesi
- PII bileşeni sadeleştirme

### Sprint 3
- profile area yeniden yapılandırma
- ortak bileşen seti
- mobil optimizasyon
- active trade quick access görünürlüğü

### Sprint 4
- router geçişi
- profile ayrı sayfa
- active trades ayrı route
- design token standardizasyonu

---

## Sonuç

Araf Protocol frontend'i tasarım karakteri ve ürün tonu açısından güçlü bir temel sunuyor. Revizyonun amacı bu karakteri bozmak değil; ürünü daha okunur, daha yönlendirici, daha hızlı erişilebilir ve hakemsiz sistem mantığına daha uygun hale getirmektir.

Bu plan uygulandığında beklenen sonuç:

- daha az teknik görünen
- daha çok güven veren
- daha hızlı öğrenilen
- daha az yorucu
- mobilde daha kontrollü
- kritik işlem anlarında daha net yönlendiren
- aktif işlemlere daha hızlı erişim veren
- trade room'a daha kısa yoldan yönlendiren

bir frontend deneyimidir.
