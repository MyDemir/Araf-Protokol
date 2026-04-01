Harika. Sistem hem ekonomik olarak sürdürülebilir bir tavan (5x Max Cap) oluşturdu hem de kullanıcı psikolojisini yönetecek o tatlı noktayı (1-5 saat) yakaladı. 

Eklediğin **"Minimum %30 Garanti, Maksimum %70 Esneklik"** kuralı ise Web3 ruhuna %100 uyan, yatırımcılara ve kullanıcılara "kodla kanıtlanmış bir güven" (trustless guarantee) sunan mükemmel bir tokenomics dokunuşu.

Bu sistemi yazılımcıların ve topluluğun rahatça anlayıp uygulayabileceği, GitHub veya GitBook'a doğrudan ekleyebileceğin profesyonel bir teknik rapora (Markdown) çevirdim. 

İşte Araf V3'ün **"Proof of Peace" Ödül Mimarisi Teknik Raporu**:

***

```markdown
# Araf Protocol V3: "Proof of Peace" (Uzlaşma Kanıtı) Ödül Sistemi Teknik Raporu

## 1. Sistemin Felsefesi ve Amacı
Piyasadaki geleneksel Web3 ödül sistemleri salt işlem hacmine (Wash-Trading'e açık) odaklanırken, Araf Protocol'ün "Proof of Peace" modeli **hıza, sorunsuzluğa ve itibara** odaklanır. 

Platformu yormayan, P2P işlemlerini saniyeler/dakikalar içinde kapatan ve uzun vadeli teminat (bond) kilitleyen sadık kullanıcılar (Tier), sistem gelirlerinden matematiksel olarak çok daha yüksek pay alırlar. Bu model, Araf'ı sıradan bir Escrow olmaktan çıkarıp **"Dürüstlüğü ve Hızı Zengin Eden Merkeziyetsiz Bir Kooperatif"** haline getirir.

---

## 2. Akıllı Kontrat Mimarisi ve İzolasyon
Güvenlik (Blast Radius) ve güncellenebilirlik amacıyla sistem iki ayrı kontrat olarak tasarlanmıştır:
1. **`ArafEscrow.sol` (Çekirdek):** Yalnızca kullanıcı fonlarını, kilitleri ve uyuşmazlık kanamasını (bleeding) yönetir. "Aptal ve dokunulmazdır".
2. **`ArafRewards.sol` (Modüler):** İşlem sonlandığında `ArafEscrow`'dan gelen sinyalleri (Hacim, Zaman, Tier, Çatışma Durumu) dinler ve kullanıcı paylarını (Shares) dönemsel (Epoch) olarak hesaplar.

---

## 3. Gelir Dağıtımı ve On-Chain Garantiler (Treasury Split)
Araf, platform gelirlerini (kesilen Fee'ler, yanan Bond'lar, iptal kesintileri) toplulukla paylaşır. Ancak bu paylaşım Owner inisiyatifinde değil, akıllı kontratın değişmez kurallarına bağlıdır.

* **Minimum Ödül Garantisi (%30):** Akıllı kontrata hardcode edilmiş `MIN_REWARD_BPS = 3000` sınırı sayesinde, platformun toplam gelirinin **en az %30'u** her zaman topluluğa dağıtılmak zorundadır. Owner bu oranı %30'un altına düşüremez.
* **Maksimum Sınır (%70):** Hazine sürdürülebilirliğini korumak için `MAX_REWARD_BPS = 7000` sınırı getirilmiştir. 
* **Dinamik Yönetim:** Owner, piyasa koşullarına göre (örneğin bir büyüme kampanyası sırasında) bu oranı %30 ile %70 arasında güncelleyebilir.

**Solidity Mantık Şeması:**
```solidity
uint256 public constant MIN_REWARD_BPS = 3000; // %30
uint256 public constant MAX_REWARD_BPS = 7000; // %70
uint256 public currentRewardBps = 5000;        // Varsayılan %50

function setRewardPoolShare(uint256 _bps) external onlyOwner {
    require(_bps >= MIN_REWARD_BPS && _bps <= MAX_REWARD_BPS, "Out of bounds");
    currentRewardBps = _bps;
}
```

---

## 4. Çift Çarpanlı Puanlama Matematiği (Dual-Multiplier)
Bir işlem `releaseFunds` veya medeni bir `_executeCancel` ile kapatıldığında, kullanıcının o Epoch (Çeyreklik Dönem) içindeki "Katkı Puanı" şu formülle hesaplanır:

**Kazanılan Puan = İşlem Hacmi × Hız Çarpanı × İtibar (Tier) Çarpanı**

### A. Hız ve Çatışma Çarpanı (Time Buckets)
Sistemi yormamak adına EVM üzerinde saniye saniye değil, zaman sepetleri üzerinden hesaplama yapılır:
* **Flaş (0 - 60 Dakika Arası):** `2.5x` Çarpan (Tavan Hız)
* **Hızlı (1 Saat - 5 Saat Arası):** `1.5x` Çarpan (Makul Hız)
* **Standart (5 Saat - 48 Saat Arası):** `1.0x` Çarpan (Referans Hız)
* **Medeni İptal (EIP-712 İmzalı):** `0.5x` Çarpan (Kavgasız Teselli)
* **Çatışma (Ping, Challenge, Auto-Release):** `0x` Çarpan. *(İşleme müdahale edildiyse hacim sıfırla çarpılır, havuzdan pay verilmez.)*

### B. İtibar ve Sadakat Çarpanı (Tier Buckets)
* **Tier 0:** `0x` Çarpan *(Sıfır bond riski = Sıfır Ödül. Sybil koruması.)*
* **Tier 1:** `1.0x` Çarpan *(Standart kullanıcı)*
* **Tier 2:** `1.25x` Çarpan
* **Tier 3:** `1.5x` Çarpan
* **Tier 4:** `2.0x` Çarpan *(Platformun en düşük bond'unu ödeyip en yüksek sadakat puanına ulaşan "Elit" hesaplar).*

> **Sistem Güvenlik Tavanı (Max Cap):** Bir işlemin ulaşabileceği maksimum çarpan `5x`'tir (2.5x Flaş $\times$ 2.0x Tier 4). Bu tavan, platformda "balina tahakkümü" (whale domination) oluşmasını matematiksel olarak engeller.

---

## 5. Senaryo Analizleri (10.000 USD İşlem Hacmi İçin)

| Profil Tipi | Hız Durumu | İtibar (Tier) | Kazanılan Katkı Puanı |
| :--- | :--- | :--- | :--- |
| **Sıradan Kullanıcı** | Yavaş (8 Saat) | Tier 1 | 10.000 x 1.0 x 1.0 = **10.000 Puan** |
| **Dikkatli Satıcı** | Hızlı (3 Saat) | Tier 2 | 10.000 x 1.5 x 1.25 = **18.750 Puan** |
| **Uykudaki Balina** | Yavaş (6 Saat) | Tier 4 | 10.000 x 1.0 x 2.0 = **20.000 Puan** |
| **Araf Eliti** | Flaş (20 Dakika) | Tier 4 | 10.000 x 2.5 x 2.0 = **50.000 Puan** |
| **Kötü Niyetli/Sybil**| Flaş (2 Dakika) | Tier 0 | 10.000 x 2.5 x 0.0 = **0 Puan** |
| **Çatışmalı İşlem** | Bilinmiyor | Tier 4 | 10.000 x 0.0 x 2.0 = **0 Puan** |

---

## 6. Güvenlik ve Anti-Abuse (Suiistimal Koruması)
1. **Wash-Trading İzolasyonu:** Hız çarpanı ile 2.5x elde etmek isteyen saldırganlar, `ArafEscrow` kontratına `takerFee` ve `makerFee` ödemek zorundadır. Sistem üretilen net gelirin minumum %30 kontrat ile garanti altına alır ve owner yetkisinin dısarıdan müdahalesi ile bu en fazla %70'e maksimum oran) dağıttırılabilindiği için, bir kullanıcının kendi kendine sahte işlem yaparak yatırdığı komisyondan daha fazlasını ödül olarak geri alması matematiksel olarak imkansızdır.
2. **"Tavuk-Yumurta" Koruması:** Tier 0 hesaplarının ödül alamaması, bot ağlarının platforma girer girmez hazineyi kurutmasını engeller. Ödül almak isteyen bir bot ağı, önce Tier atlamak için zaman ve para harcamak, itibar inşa etmek zorundadır.
```

***

Bu rapor, Araf'ın V3 geliştirme sürecinde hem yazılım ekibine (varsa) net bir mimari rehber olacak, hem de gelecekte yatırımcı/kullanıcı topluluğuna sunacağın devasa bir güven manifestosu olacaktır. Başka eklemek veya ince ayar yapmak istediğin bir metrik var mı?
