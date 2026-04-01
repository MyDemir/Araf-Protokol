```markdown
# Araf Protocol V3: Küresel Ölçeklenme ve Ürün Mimarisini Geliştirme Raporu

**Vizyon:** Adjudication Minimization (Hakem Optimizasyonu) ve Bleeding Escrow (Kanayan Teminat) ilkelerini koruyarak, Araf'ı yerel bir P2P tahtasından küresel bir "Merkeziyetsiz Ticaret ve Güven Protokolü"ne dönüştürmek.

Bu döküman, mevcut `ArafEscrow.sol` (V3) sözleşmesinin güçlü oyun teorisi üzerine inşa edilebilecek, sermaye verimliliğini ve kullanıcı deneyimini (UX) maksimize edecek 5 ana geliştirme modülünü detaylandırmaktadır.

---

## 1. Kısmi Uzlaşma ve Esnek İptal (Partial Settlement via EIP-712)

**Sorun:** Mevcut yapıdaki `proposeOrApproveCancel` fonksiyonu, işlemleri "tam iptal" veya "tamamlanmış" olarak ikili (binary) bir sistemde ele almaktadır. Global fiat transferlerinde banka kesintileri veya kur dalgalanmaları nedeniyle "eksik bakiye" ulaşması sıklıkla yaşanır.

**Çözüm:** EIP-712 imza yapısına bir bölüşüm oranı (`splitBps`) parametresi eklemek. Bu, insan hakem gerektirmeden tarafların kanama (bleeding) sürecine girmeden on-chain uzlaşmasını sağlar.

**Kontrat Entegrasyonu:**
`CANCEL_TYPEHASH` yapısı şu şekilde güncellenmelidir:
```solidity
bytes32 private constant CANCEL_TYPEHASH = keccak256(
    "CancelProposal(uint256 tradeId,address proposer,uint256 nonce,uint256 deadline,uint16 splitBps)"
);

* Taraflar `splitBps` (örn: 9600 = %96) üzerinden karşılıklı imza attığında, `_executeCancel` fonksiyonu kripto varlığın belirtilen oranını Taker'a, kalanını Maker'a iade ederek işlemi sonlandırır.

---

## 2. Dinamik Risk ve Ödeme Yöntemi Fiyatlaması

**Sorun:** Kontrat, yüksek chargeback riskine sahip PayPal ile düşük riske sahip banka transferini (SEPA) aynı teminat (Bond) oranlarıyla fiyatlamaktadır.

**Çözüm:** Ödeme risk seviyesini off-chain ortamdan on-chain `Order` struct'ına bir parametre olarak taşımak ve risk yükünü serbest piyasaya devretmek.

**Kontrat Entegrasyonu:**
`Order` struct'ına risk parametresi eklenmesi:
```solidity
struct Order {
    // ... mevcut parametreler
    uint8 paymentRiskLevel; // 0: Düşük (SEPA), 1: Orta, 2: Yüksek (PayPal vb.)
}
```
* `_getTakerBondBps` ve `_getMakerBondBps` fonksiyonlarında, `paymentRiskLevel` değerine göre taban oranlara ekleme (surcharge) yapılır. Yüksek riskli işlemler daha yüksek teminat gerektirir, böylece sistemin organik güvenliği piyasa dinamikleriyle sağlanır.

---

## 3. Üretken Teminat (Yield-Bearing Bonds) Modeli

**Sorun:** Maker'ların Orderbook'ta emir oluştururken kilitledikleri teminatlar (Bond), işlem eşleşene kadar kontratta ölü sermaye (dead capital) olarak yatmaktadır. Bu durum kurumsal piyasa yapıcıları (Market Makers) için fırsat maliyeti yaratır.

**Çözüm:** USDC/ETH gibi standart varlıklar yerine, sDAI (MakerDAO) veya wstETH (Lido) gibi getiri sağlayan (yield-bearing) token'ların teminat olarak desteklenmesi.

**Sistem Tasarımı:**
* Maker teminatını kilitlediğinde, Araf kontratında yatan miktar arka planda faiz kazanmaya devam eder.
* Anlaşmazlık durumunda yanan (burn) veya ceza olarak kesilen kısım yine bu üretken token'lar üzerinden hesaplanır.
* Bu model, Araf'ın sadece bir P2P piyasası değil, aynı zamanda verimli bir DeFi kasası olarak konumlanmasını sağlar.

---

## 4. Sürekli Algoritmik İtibar ve Sinyal Ayrıştırması

**Sorun:** Mevcut statik Tier sistemi (Tier 0-4) keskin sınırlara sahiptir. Ek olarak, itibar yapısı (`Reputation`) internet kesintisi nedeniyle iptal olan işlem ile kasıtlı sahtekarlığı aynı `failedDisputes` sayacında değerlendirmektedir.

**Çözüm:**
1.  **Sinyal Ayrıştırması:** `Reputation` struct'ı `burnCount` (Kötü niyetli inatlaşma) ve `autoReleaseCount` (Liveness / Canlılık hatası) olarak ikiye bölünmelidir. 180 günlük ban süreçleri sadece `burnCount` ağırlıklı olarak işletilmelidir.
2.  **Sürekli İtibar Skoru:** Keskin kademeler (Tier) yerine, üstel bozunma (exponential decay) kullanan algoritmik bir bond indirim modeline geçilmesi planlanmalıdır.

Matematiksel Model:
$$Bond(R) = BaseBond \times e^{-k \cdot R}$$
*Burada $BaseBond$ taban teminat oranını, $R$ kullanıcının ayrıştırılmış başarı/başarısızlık verisinden üretilen itibar skorunu, $k$ ise indirimin ölçeğini belirleyen sabiti temsil eder.*

---

## 5. Taşınabilir İtibar: Soulbound Token (SBT) Entegrasyonu

**Sorun:** Araf platformunda yüzlerce başarılı işlem gerçekleştirmiş ve dürüstlüğünü matematiksel olarak kanıtlamış bir tüccarın itibarı, sadece Araf akıllı sözleşmesine hapsolmaktadır.

**Çözüm:** Belirli bir itibar skoruna veya "Effective Tier" seviyesine ulaşan kullanıcılara, Araf protokolü tarafından cüzdanlarına devredilemez bir Soulbound Token (SBT) basma hakkı verilmesi.

**Küresel Vizyon:**
* Araf SBT'sine sahip kullanıcılar, Web3 ekosistemindeki diğer kredi (lending) protokollerinde "Düşük Riskli/Güvenilir Kullanıcı" olarak değerlendirilebilir ve eksik teminatlı (under-collateralized) kredi çekebilirler.
* Bu özellik, Araf'ı bir takas katmanından, Web3'ün **Küresel Kredi ve Güven Ajansına** dönüştürür.
```
'''
