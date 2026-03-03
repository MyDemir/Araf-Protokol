
---

# 📜 BÖLÜM 1: ARAF P2P ESCROW PROTOKOLÜ (V2 MASTER DOKÜMAN)

## 1. Sistemin Temel Vizyonu

Bu platform, itibari para (TRY) ile kripto varlıkların (USDT vb.) takasını **aracısız, hakemsiz (humanless) ve %100 "Code is Law" (Kod Kanundur)** felsefesiyle gerçekleştiren bir Web3 protokolüdür. Geleneksel P2P platformlarının aksine, müşteri hizmetleri veya uyuşmazlık çözüm ekibi yoktur. Güvenlik, matematiksel Oyun Teorisi ile sağlanır.

## 2. Kullanıcı Kademeleri (Tiers) ve Teminat (Bond) Yapısı

Yeni kullanıcıların (Cold Start) platforma kolayca dahil olabilmesi için asimetrik bir yapı tasarlanmıştır:

* **Tier 1 (Yeni Başlayanlar):** 1.000 ₺'ye kadar işlem limiti. Satıcı %18 teminat kilitler, **Alıcı %0 teminat kilitler.**
* **Tier 2 (3+ Başarılı İşlem):** 25.000 ₺'ye kadar. Satıcı %15, Alıcı %8 teminat kilitler.
* **Tier 3 (Yüksek Hacim):** 25.000 ₺ üzeri. Satıcı %10, Alıcı %6 teminat kilitler.

## 3. Anti-Sybil ve Bot Kalkanı

Tier 1'deki %0 teminat avantajının troller tarafından suistimal edilmesini (Griefing) önlemek için **3 ücretsiz zincir-içi (on-chain) filtre** uygulanır:

1. **Cüzdan Yaşı:** Alıcının cüzdanı en az 7 günlük olmalıdır.
2. **Toz Bakiye (Dust Filter):** Alıcı cüzdanında işlem ücretini (Gas) karşılayacak minimum bir bakiye (örn. 2$ değerinde MATIC/BNB) bulunmalıdır.
3. **Soğuma Süresi (Cooldown):** Tier 1 kullanıcılar günde sadece 1 işlem açabilir.

## 4. Standart İşlem Akışı (Mutlu Senaryo)

1. **LOCKED (Kilitli):** Satıcı USDT'yi ve teminatını akıllı kontrata kilitler.
2. **PAID (Ödendi):** Alıcı off-chain (banka) TRY transferini yapar, dekont hash'ini kontrata işler. **48 Saatlik Serbest Bırakma Sayacı** başlar.
3. **RESOLVED (Çözüldü):** Satıcı parayı görür, kontrattan `Release` (Serbest Bırak) komutunu verir. USDT alıcıya, teminatlar sahiplerine gider. İşlem başarıyla kapanır (+1 İtibar Puanı).

## 5. Uyuşmazlık Çözümü: "Araf" ve "Eriyen Kasa" (Time-Decay Burn)

Eğer satıcı parayı almadığını iddia ederse veya alıcı sahte işlem yaparsa sistem şu şekilde işler:

1. **Challenge (İtiraz):** Satıcı itiraz eder. Sistem **Araf (Purgatory)** fazına girer.
2. **Müzakere (İlk 48 Saat):** Tarafların off-chain (Telegram vb.) görüşüp akıllı kontrat üzerinden `Mutual_Cancel` (Karşılıklı İptal) veya `Mutual_Release` (Karşılıklı Onay) butonlarında uzlaşmaları beklenir. Bu sürede ceza kesilmez.
3. **Eriyen Kasa (Bleeding Escrow):** 48 saat dolar ve taraflar hala inatlaşıyorsa, içeride kilitli olan tüm fon (USDT + Teminatlar) **her 24 saatte bir %10 oranında erimeye başlar.** Eriyen miktar Platform Hazinesine aktarılır.
4. **Oyun Teorisi Etkisi:** İnatlaşan her iki taraf da her gün para kaybeder. Bu "kanayan yara" psikolojisi, dürüst veya kötü niyetli fark etmeksizin tarafları gururu bırakıp hızla uzlaşmaya ve kalan paralarını kurtarmaya mecbur bırakır. Dolandırıcılık tamamen kârsız hale gelir.

---

# 💻 BÖLÜM 2: SOLİDİTY TEMEL FONKSİYON TASLAKLARI (MİMARİ İSKELET)

Bu kuralları blokzincirde çalıştıracak olan akıllı kontratın (Smart Contract) ana sinir sistemi şu fonksiyonlardan oluşacaktır:

### 1. İşlem Başlatma Fonksiyonları

* `createEscrow(uint256 _fiatAmount, uint256 _cryptoAmount, uint8 _tier)`
* **Kim Çağırır:** Satıcı (Maker).
* **Ne Yapar:** Satıcının satmak istediği USDT'yi ve belirlediği Tier'a uygun Satıcı Teminatını (Bond) kontrata kilitler. İlanı tahtaya düşürür (Durum: `OPEN`).


* `lockTrade(uint256 _escrowId)`
* **Kim Çağırır:** Alıcı (Taker).
* **Ne Yapar:** Anti-Sybil kontrollerini (Cüzdan yaşı, Dust bakiye, Cooldown) yapar. Tier 2 veya 3 ise Alıcı Teminatını kilitler. İşlemi başlatır (Durum: `LOCKED`).



### 2. Standart Akış Fonksiyonları

* `markAsPaid(uint256 _escrowId, string memory _receiptHash)`
* **Kim Çağırır:** Alıcı.
* **Ne Yapar:** İtibari para (TRY) ödemesinin yapıldığını bildirir, IPFS dekont hash'ini kaydeder. 48 saatlik Release Sayacını başlatır. (Durum: `PAID`).


* `releaseFunds(uint256 _escrowId)`
* **Kim Çağırır:** Satıcı.
* **Ne Yapar:** Parayı aldığını onaylar. Kilitli USDT'yi alıcıya gönderir, teminatları iade eder. Cüzdanlara +1 Başarılı İşlem puanı yazar. (Durum: `RESOLVED`).



### 3. Uyuşmazlık ve Araf (Purgatory) Fonksiyonları

* `openChallenge(uint256 _escrowId)`
* **Kim Çağırır:** Satıcı (Sadece `PAID` durumundayken ve 48 saat dolmadan).
* **Ne Yapar:** Araf fazını başlatır. 48 saatlik cezasız müzakere sayacını tetikler. (Durum: `CHALLENGED`).


* `mutualCancel(uint256 _escrowId)` / `mutualRelease(uint256 _escrowId)`
* **Kim Çağırır:** Her iki tarafın da imzası (onayı) gerekir.
* **Ne Yapar:** Taraflar off-chain anlaştığında çağrılır. `Cancel` edilirse USDT satıcıya, teminatlar sahiplerine döner. `Release` edilirse USDT alıcıya gider. Kalan (erimemiş) fonlar iade edilir. (Durum: `RESOLVED_BY_AGREEMENT`).



### 4. Eriyen Kasa (Bleeding Escrow) Fonksiyonu

* `executeTimeDecay(uint256 _escrowId)`
* **Kim Çağırır:** Herhangi biri çağırabilir (Public/Keeper botları) veya kullanıcılar işlem yaparken tetiklenir.
* **Ne Yapar:** Araf (Challenge) fazında 48 saatlik müzakere süresi dolmuşsa ve hala uzlaşma yoksa çalışır. Geçen her ekstra 24 saat için içerideki toplam fonun %10'unu (veya belirlenen oranı) kesip Platform Hazinesi (Treasury) adresine gönderir. Kalan fon miktarını günceller. Eğer 10 gün dolmuşsa fonu sıfırlar ve işlemi tamamen kapatır (Durum: `BURNED_TO_TREASURY`).
