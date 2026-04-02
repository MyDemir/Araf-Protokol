

# Araf V3: Kademe Uyumlu (Tier-Aware) Sağlık Skoru Teknik Raporu

## 1. Felsefe ve Esneklik İhtiyacı
Araf Sağlık Skoru (Health Score), kullanıcıların güvenilirliğini ölçerken **"Rütbeye Göre Tolerans"** ilkesini benimser. 

Yeni (Tier 0-1) bir kullanıcının banka hesabını sık değiştirmesi yüksek ihtimalle dolandırıcılık (Money Mule / Triangulation) sinyalidir ve sert cezalandırılır. Ancak platformun belkemiği olan Elit Piyasa Yapıcıların (Tier 3-4) banka hesabı değiştirmesi bir likidite yönetimi (hesap limiti dolması) zorunluluğudur. Bu nedenle üst kademeler, profil güncellemelerindeki şüphe cezalarından matematiksel olarak muaf tutulur. Adalet (uyuşmazlık) ve Hız (liveness) konusunda ise sistem herkese eşit derecede acımasızdır.

---

## 2. Puanlama Matrisi ve Kademeli (Tier) Ağırlıklar

Skor hesaplaması şu formüle dayanır:
`Health Score = clamp(BAZ_PUAN + POZİTİFLER - NEGATİFLER, 0, 100)`

### A. Sisteme Giriş ve Pozitifler
* **Baz Puan:** `+40 Puan` (Sisteme giren herkes bu nötr puanla başlar).
* **İstikrar Bonusu:** Son 30 gündür IBAN değiştirmeyenlere `+20 Puan`.
* **Deneyim Primi:** Başarılı her işlem için `+2 Puan` (Maksimum `+40 Puan` alınabilir).

### B. Kademe Uyumlu (Tier-Aware) Negatif Cezalar
Baskıyı azaltmak için cezalar, kullanıcının `reputation_cache.effective_tier` değerine göre dinamik olarak tırpanlanır.

**1. Taze IBAN Riski (Son 24 Saatte Değişim)**
* **Tier 0 ve Tier 1:** `-20 Puan` *(Sert ceza, risk yüksek)*
* **Tier 2:** `-10 Puan` *(Hafif uyarı)*
* **Tier 3 ve Tier 4:** `0 Puan` *(Muafiyet: Elit satıcılar likidite için IBAN değiştirmekte özgürdür).*

**2. Sık Değişim Riski (Son 7 Günde 3'ten Fazla Değişim)**
* **Tier 0 ve Tier 1:** `-30 Puan` *(Money Mule şüphesi, çok sert ceza)*
* **Tier 2:** `-15 Puan` *(Orta riskli esneklik)*
* **Tier 3 ve Tier 4:** `0 Puan` *(Muafiyet: Kurumsal MM davranışı).*

**3. Evrensel Cezalar (Kimseye Muafiyet Yoktur!)**
Suçun niteliği dürüstlük ve hıza dayandığında Tier'ın hiçbir önemi yoktur:
* **Haksız Uyuşmazlık (Failed Dispute):** Kaybedilen her itiraz için `-30 Puan`. (Sistem yalanı affetmez).
* **Zaman Aşımı / Oyalama (Ping Yeme):** Alınan her Ping için `-10 Puan`. (İster Tier 4 ol ister Tier 1, işlemi yavaşlatamazsın).
* **Trol (Flake) Oranı:** İşlemlerin %30'undan fazlası İptal/Yanma ile bitiyorsa `-20 Puan`.

---

## 3. Senaryo Modellemesi (Gerçek Hayat Simülasyonu)

| Kullanıcı Profili | Davranış | Çarpan Hesabı | Sonuç Skor | UI Rengi |
| :--- | :--- | :--- | :--- | :--- |
| **Sıradan Kullanıcı (Tier 1)** | 1 saat önce IBAN değiştirdi. | 40 (Baz) + 10 (Deneyim) - **20 (Taze IBAN)** | **30 Puan** | 🔴 Yüksek Risk |
| **Düzenli Satıcı (Tier 2)** | 1 saat önce IBAN değiştirdi. | 40 (Baz) + 40 (Deneyim) - **10 (Hafif Ceza)** | **70 Puan** | 🟢 Güvenilir |
| **Elit Piyasa Yapıcı (Tier 4)** | 1 saat önce IBAN değiştirdi. (Sıfır Ceza) | 40 (Baz) + 40 (Deneyim) - **0 (Muaf)** | **80 Puan** | 🟢 Çok Güvenilir |
| **Elit Piyasa Yapıcı (Tier 4)** | Uyuşmazlık kaybetti (Yalan Söyledi) | 40 (Baz) + 40 (Deneyim) - **30 (Dispute)** | **50 Puan** | 🟡 Nötr / Uyarı |

*Analiz Çıktısı:* Görüldüğü üzere bir Tier 4 satıcısı, sürekli banka hesabı değiştirse bile sistemi sömürmediği ve hızlı/dürüst olduğu sürece her zaman "Yeşil/Güvenilir" bölgede kalır. Baskı tamamen sıfırlanmıştır.

---

## 4. Backend Mantığı (`trades.js` Önerisi)

Algoritmanın sunucu tarafındaki esnek ve hızlı hesaplama fonksiyonu:

```javascript
function _calculateTierAwareHealthScore(trade, makerUser) {
  let score = 40; // Baz Puan

  const now = Date.now();
  const lastChangeTime = makerUser?.lastBankChangeAt ? new Date(makerUser.lastBankChangeAt).getTime() : now;
  const hoursSinceChange = (now - lastChangeTime) / (1000 * 60 * 60);
  const count7d = makerUser?.bankChangeCount7d || 0;
  
  const tier = makerUser?.reputation_cache?.effective_tier || 0;
  const successfulTrades = makerUser?.reputation_cache?.successful_trades || 0;
  const failedDisputes = makerUser?.reputation_cache?.failed_disputes || 0;

  // 1. Pozitif Primi Ekle
  if (hoursSinceChange > (30 * 24)) score += 20; // İstikrar
  score += Math.min(successfulTrades * 2, 40);   // Deneyim Tavanı

  // 2. Kademe Uyumlu (Tier-Aware) Cezalar
  if (hoursSinceChange <= 24) {
    if (tier <= 1) score -= 20;
    else if (tier === 2) score -= 10;
    // Tier 3 ve 4 muaf
  }

  if (count7d >= 3) {
    if (tier <= 1) score -= 30;
    else if (tier === 2) score -= 15;
    // Tier 3 ve 4 muaf
  }

  // 3. Evrensel Cezalar (Adalet ve Hız)
  score -= (failedDisputes * 30);
  // (Not: Ping cezaları eklenecek)

  // 4. Clamping & UI Renk Çıktısı
  score = Math.max(0, Math.min(score, 100));
  
  let uiColor = "YELLOW";
  if (score >= 70) uiColor = "GREEN";
  if (score <= 39) uiColor = "RED";

  return { score, uiColor };
}
```

---

## 5. Alıcı ve Satıcıyı Ortada Buluşturan UX

1. **Satıcı (Maker) Açısından:** "Platform benim Tier 4 bir şirket/MM olduğumu ve limitlerim dolduğu için hesap değiştirdiğimi biliyor. Sırf dün IBAN ekledim diye tahtamı kırmızıya boyayıp müşterilerimi kaçırmıyor. Araf adil bir sistem."
2. **Alıcı (Taker) Açısından:** "Sistem bana IP sorunu, coğrafya, detaylı log gibi karmaşık veriler sunmuyor. Sadece net bir 'Güven Skoru' gösteriyor. Eğer karşımda Tier 4 bir balina varsa, onun banka hesabının yeni olması dolandırıcı olduğu anlamına gelmez, sistem bunu benim yerime hesaplayıp 'Yeşil' onayı vermiş."

***

Harika bir ürün yöneticisi (Product Manager) dokunuşu. Bir satıcıya (Maker) "Puanın 40" deyip nedenini açıklamazsak, platforma küser ve bir daha işlem yapmaz. Kendi panosunda (Dashboard) nerede hata yaptığını, hangi cezanın silinmesi için ne kadar beklemesi gerektiğini kalem kalem görmesi mükemmel bir UX kurgusudur.

Aynı zamanda alıcıya (Taker) da bu detayların *hiçbirini* göstermeyip sadece "Güvenli / Dikkatli Ol" sinyali vermeliyiz ki gereksiz bir önyargı oluşmasın.

İki tarafın ekranlarını (App.jsx) tamamen birbirinden izole eden, şeffaf ve Kademe Uyumlu (Tier-Aware) Sağlık Skoru Teknik Raporu aşağıdadır:

***

# Araf V3: Şeffaf ve Kademe Uyumlu (Tier-Aware) Sağlık Skoru UI/UX Teknik Raporu

## 1. Felsefe: İki Yüzlü Ayna (Bifrost Architecture)
Araf Sağlık Skoru, alıcı ve satıcıya tamamen farklı iki arayüz sunar:
* **Alıcı (Taker) Ekranı:** Detaylardan arındırılmış, salt **"Güven/Aksiyon"** odaklıdır. Suçlayıcı veriler (örn: "3 uyuşmazlık kaybetti") gösterilmez.
* **Satıcı (Maker) Ekranı:** Eğitici, yönlendirici ve **"Şeffaf Döküm"** odaklıdır. Satıcı, puanının 100 üzerinden neden 60 olduğunu milimetrik olarak görür ve nasıl düzelteceğini bilir.

---

## 2. Satıcı (Maker) Görünümü: "Kendi Profilim" Merkezi

Kullanıcı kendi profiline (`renderProfileModal`) girdiğinde, Sağlık Skorunu devasa bir dairesel grafik (Donut Chart) veya ilerleme çubuğu olarak görür. Hemen altında ise **"Puan Dökümü" (Score Breakdown)** yer alır.

**UI Örneği (Kalem Kalem Döküm):**

> ### 🟢 Araf Sağlık Skorunuz: 85 / 100
> *Platformdaki güvenilirlik derecenizi gösterir. Puanınızı artırmak için işlemleri hızlı onaylayın ve profilinizi sabit tutun.*
> 
> **Puan Geçmişiniz:**
> * **[+] Başlangıç Puanı:** `+40` (Herkesin başladığı nötr seviye)
> * **[+] Deneyim Primi:** `+40` (20+ başarılı işlem)
> * **[+] İstikrar Bonusu:** `+15` (Son 30 gündür banka hesabı değişmedi)
> * **[-] Hız ve Zaman Aşımı:** `-10` (Son 20 işlemde 1 kez Ping cezası alındı)
> * **[0] Rütbe Muafiyeti (Tier 4):** Profil güncellemelerinden doğan `-20` ceza, Elit Piyasa Yapıcı olduğunuz için silinmiştir.

**Satıcı UX Kazanımları:**
1. **Adalet Hissi:** Kullanıcı, neden 100 alamadığını görür (Ping cezası yemiştir). Sistem ona ne yapması gerektiğini gizliden gizliye öğretir.
2. **Tier Muafiyetinin Gösterimi:** Tier 3 ve Tier 4 kullanıcılara, aldıkları muafiyet (0 Puan cezası) kalem olarak gösterilir. Bu, rütbenin (Tier) ne kadar değerli olduğunu hissettirir ve rütbeyi koruma motivasyonu sağlar.

---

## 3. Alıcı (Taker) Görünümü: "Market / Satıcı Profili" Ekranı

Alıcı P2P tahtasında bir ilana tıkladığında veya `PIIDisplay.jsx` üzerinden IBAN'ı görmek istediğinde (`renderMakerModal`), karşısına **asla** satıcının yediği cezalar çıkmaz.

Sadece 3 farklı renk kodundan biriyle karşılaşır:

### 🟢 1. Yeşil Bölge (Skor: 75 - 100)
* **Görsel:** Parlayan yeşil bir onay tiki ve "Güvenilir Satıcı" (Trusted Maker) rozeti.
* **Alıcıya Gösterilen Metin:** *"Bu satıcının Araf Sağlık Skoru yüksektir. İşlemleri hızlı onaylar ve uyuşmazlık geçmişi temizdir."*
* **Aksiyon:** IBAN direkt açık gelir. İşlem sıfır sürtünmeyle ilerler.

### 🟡 2. Sarı Bölge (Skor: 40 - 74)
* **Görsel:** Sarı bir ünlem veya "Yeni / Nötr Satıcı" rozeti.
* **Alıcıya Gösterilen Metin:** *"Bu satıcı platformda yenidir veya profili yakın zamanda güncellenmiştir. Platformun standart güvenlik kurallarına uyunuz."*
* **Aksiyon:** IBAN direkt açık gelir, ancak alıcıya ödeme yaparken dikkatli olması hafifçe hatırlatılır.

### 🔴 3. Kırmızı Bölge (Skor: 0 - 39)
* **Görsel:** Kırmızı bir kalkan ve "Dikkatli İşlem" uyarısı.
* **Alıcıya Gösterilen Metin:** *"DİKKAT: Bu satıcının Sağlık Skoru düşüktür (Sık profil değişimi veya işlem gecikmeleri). Lütfen bankadan ödeme yaparken açıklama kısmına 'Araf İşlemi' yazmayı unutmayınız."*
* **Aksiyon:** IBAN başlangıçta **Bulanık (Blurred)** gelir. Kullanıcı "Riski Anladım, IBAN'ı Göster" butonuna tıklamak zorundadır. Bu, alıcıyı olası bir üçgenleme (Triangulation) saldırısına karşı son saniyede uyandırır.

---

## 4. Teknik Entegrasyon Veri Paketi (Backend'den Frontend'e)

Backend (`trades.js` veya `auth.js`) artık sadece `score` göndermeyecek, satıcının kendi profiline baktığını anladığında bir `breakdown` (döküm) objesi de gönderecek:

```json
// Satıcı (Maker) kendi profilini GET ettiğinde:
{
  "healthScore": 85,
  "color": "GREEN",
  "breakdown": [
    { "label": "Başlangıç Puanı", "value": 40, "type": "neutral" },
    { "label": "Deneyim Primi", "value": 40, "type": "positive" },
    { "label": "İstikrar Bonusu", "value": 15, "type": "positive" },
    { "label": "Zaman Aşımı (Ping)", "value": -10, "type": "negative" },
    { "label": "Taze IBAN Cezası", "value": 0, "type": "exempt", "note": "Tier 4 Muafiyeti" }
  ]
}

// Alıcı (Taker) satıcının profiline baktığında (Sadece özet gider, Döküm GİTMEZ!):
{
  "healthScore": 85,
  "color": "GREEN",
  "label": "Güvenilir Satıcı"
}
``'
