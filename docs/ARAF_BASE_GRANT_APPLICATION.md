# Araf Protocol — Base Grant Application Package
**Başvuru Dokümanı | Mart 2026**

> Bu dosya üç ayrı Base fon programı için hazırlanmış başvuru materyalini içerir:
> 1. **Builder Grant** (1–5 ETH, retroaktif, hızlı)
> 2. **Base Batches Startup Track** ($10K grant + $50K yatırım imkânı)
> 3. **OP Retro Funding** (uzun vadeli, kamu yararı odaklı)

---

## Bölüm A — Builder Grant Başvurusu
*`paragraph.com/@grants.base.eth` — Retroaktif, shipped project için*

---

### A1. Proje Özeti (150 kelime — kopyala yapıştır kullan)

Araf Protocol, fiat para birimi (TRY, USD, EUR) ile stablecoin (USDT, USDC) takasını **hakem olmadan** mümkün kılan, Base L2 üzerinde çalışan oracle-bağımsız bir P2P escrow protokolüdür.

Mevcut P2P platformlarının (Binance P2P, Paxful) temel sorunu uyuşmazlıklarda insan moderatöre bağımlılıktır. Bu hem sansür riskini hem operasyonel maliyeti hem de keyfi karar riskini doğurur. Bisq ve Hodl Hodl gibi non-custodial alternatifler ise yalnızca BTC destekler ve masaüstü kurulum gerektirir.

Araf, bu sorunu **Bleeding Escrow** mekanizmasıyla çözer: Uyuşmazlıkta fonlar zaman geçtikçe eriyor — matematiksel olarak anlaşmak inatlaşmaktan daha kârlı hale geliyor. Kimse karar vermiyor. Kontrat yargılıyor.

**Durum:** Solidity kontrat tamamlandı, Hardhat test suite geçiyor, Node.js/Express backend ve React frontend çalışıyor. Base Sepolia testnet'te deploy hazır.

---

### A2. Base Ekosistemi Katkısı

| Metrik | Detay |
|--------|-------|
| **Base'e özgü deploy** | ArafEscrow.sol yalnızca Base L2'ye deploy edilmiştir |
| **İşlem başına on-chain tx** | Her P2P işlem: `createEscrow` + `lockEscrow` + `releaseFunds` = minimum 3 tx |
| **Stablecoin hacmi** | USDT/USDC akışı — Base TVL'ye doğrudan katkı |
| **Yeni kullanıcı segmenti** | Türkiye/MENA bölgesinde bankacılık kısıtlamaları nedeniyle kripto kullanmak zorunda kalan fiat kullanıcıları → Base'e ilk kez gelecek segment |
| **Güven modeli** | Coinbase'in non-custodial vizyonuyla %100 uyumlu — kullanıcı fonlarına platform el koyamaz |

---

### A3. Teknik Olgunluk Kanıtı

```
contracts/src/ArafEscrow.sol     → 900+ satır, OpenZeppelin v5, audit-ready
contracts/test/ArafEscrow.test.js → 40+ test case, tüm kritik yollar kapsanmış
backend/scripts/                  → Node.js relayer, sıfır private key mimarisi
frontend/src/                     → React 18 + Wagmi 2 + Viem, SIWE auth
```

**Güvenlik özellikleri:**
- ReentrancyGuard + CEI pattern her para transferinde
- EIP-712 imzalı iptal (gasless cancel)
- AES-256-GCM envelope encryption (IBAN/PII)
- On-chain Anti-Sybil: wallet age + dust limit + cooldown
- Zero private key backend — sunucu ele geçirilse bile fonlar güvende

---

### A4. Neden Base? (Değerlendirici bu soruyu soracak)

1. **Gas maliyeti:** Bleeding Escrow saatlik decay hesabı için her kullanıcı etkileşimi gaz tüketir. Ethereum mainnet'te bu işlemler $5–20 olur — ekonomik anlamsız. Base'de $0.01'ın altı.

2. **Coinbase dağıtım kanalı:** Coinbase'in 100M+ kullanıcısı mobil uygulamadan Base'e USDC transfer edebiliyor. Araf bu kullanıcıların P2P satıcısı bulabileceği yerdir.

3. **Stablecoin ekosistemi:** Base, USDC'nin native chain'i. Türkiye'de USDT/USDC P2P hacmi Bitcoin'i geçti — piyasa Base üzerinde olan stablecoin altyapısını bekliyor.

4. **Teknik altyapı:** Flashblocks (50ms block time) ile Bleeding Escrow'un saatlik timer'ları daha granüler hale gelebilir. Gelecek roadmap uyumu var.

---

### A5. Grant Kullanım Planı (1–5 ETH)

| Öncelik | Kullanım | Tahmini Maliyet |
|---------|----------|-----------------|
| 1 | Profesyonel akıllı kontrat güvenlik denetimi (audit) | ~3 ETH |
| 2 | Base Sepolia → Mainnet deploy + testnet likidite | ~1 ETH |
| 3 | Farcaster/X ekosistem içi topluluğa tanıtım | ~1 ETH |

**Not:** Audit, mainnet lansmanı için blokerlerin başındadır. Base Builder Grant bu adımı doğrudan hızlandırır.

---

## Bölüm B — Base Batches Startup Track Başvurusu
*$10K grant + Demo Day + $50K yatırım imkânı*

---

### B1. Elevator Pitch (30 saniye — sözlü için)

> "Binance P2P, 2024'te USDT-TRY işlemlerinde 50 milyar dolar hacim gördü. Bu hacmin %10'u için bile para gönderip gönderilmediğine *insan* karar veriyor. Araf'ta kimse karar vermiyor — fonlar zamanla eriyor ve taraflar matematiksel olarak anlaşmak zorunda kalıyor. Base üzerinde çalışan, USDT/USDC destekleyen ve hiçbir hakem gerektirmeyen tek P2P escrow protokolü."

---

### B2. Problem — Pazar Boyutu

**Küresel P2P kripto-fiat hacmi (2024 verileri):**
- Binance P2P: Tahmini yıllık $400–600B işlem hacmi
- LocalBitcoins kapandı (2023) → pazar boşluğu hâlâ dolmadı
- Paxful 2023'te donduruldu → güven hasarı kalıcı
- Türkiye, Arjantin, Nijerya, Ukrayna: en yüksek P2P talep bölgeleri

**Neden şimdi:** USDT, Türkiye'de 2023'ten itibaren dolar işlemlerinin %60'ından fazlasını oluşturuyor (Chainalysis Geography of Crypto 2024). Fiat→USDT takas talebi doğrudan yerel bankacılık kısıtlamalarıyla bağlantılı — yapısal, geçici değil.

**TAM (Total Addressable Market):** P2P kripto-fiat takası için hizmet verilebilir küresel pazar ~$2–3 trilyon/yıl

**SAM (Serviceable Available Market):** Non-custodial, stablecoin bazlı, düzenleyici basıncın yüksek olduğu Türkiye/MENA/LatAm bölgesi — ~$50–100 milyar/yıl

**SOM (Serviceable Obtainable Market):** İlk 12 ay Türkiye merkezli %0.01 pazar payı = ~$5–10M işlem hacmi → $10–20K protokol geliri (yıllık, %0.2 fee üzerinden)

---

### B3. Çözüm — Farklılaşma Matrisi

| | Binance P2P | Bisq | Hodl Hodl | Kleros | **Araf** |
|--|--|--|--|--|--|
| Non-custodial | ✗ | ✓ | ✓ | ✓ | **✓** |
| Oracle-free | ✗ | ✗ (DAO) | ✗ (mediator) | ✗ (jüri) | **✓** |
| Stablecoin | ✓ | ✗ BTC only | ✗ BTC only | ✓ | **✓** |
| Web tarayıcı | ✓ | ✗ masaüstü | ✓ | ✓ | **✓** |
| KYC yok | ✗ | ✓ | yarı | ✓ | **✓** |
| Sıfır operasyonel maliyet | ✗ | yarı | ✗ | ✗ | **✓** |

---

### B4. Teknik Mimari — Özet

```
[Kullanıcı A — Satıcı]          [Kullanıcı B — Alıcı]
        |                               |
        |──── createEscrow() ─────────►|
        |     (USDT + bond kilitlendi)  |──── lockEscrow() ───►|
        |                               |     (bond kilitlendi) |
        |                               |                       |
        |                    [Fiat transferi off-chain]         |
        |                               |                       |
        |                               |──── reportPayment() ─►|
        |◄──── releaseFunds() ──────────|                       |
        |      (USDT → Alıcı)          |                       |
        |      (Protokol: %0.2 fee)     |                       |
                        ↓
              [UYUŞMAZLIK DURUMU]
                        ↓
         ArafEscrow.sol Bleeding Escrow
         Her saat: bond'lar eriyor
         Her iki taraf da kaybediyor
         → Anlaşmak ekonomik zorunluluk
```

**Sıfır private key backend:** Backend relayer sadece event'leri MongoDB'ye yansıtır. Fon hareketi için backend'in imzası gerekmiyor — kullanıcı imzaları yeterli.

---

### B5. İş Modeli

**Gelir akışları:**

1. **Protocol fee:** Her başarılı işlemde %0.2 (simetrik: satıcıdan %0.1, alıcıdan %0.1) → Treasury'e otomatik aktarılır

2. **Burned bonds:** Uyuşmazlık 10 günü aşarsa tüm fonlar Treasury'e → Bu hem ceza hem gelir

3. **Tier sistemi:** Yüksek tier = düşük teminat = daha büyük işlem limiti → Deneyimli kullanıcılara ekonomik teşvik

**Unit economics (örnek senaryo):**
- Ortalama işlem: 500 USDT
- %0.2 fee: 1 USDT
- Günde 100 işlem: $100 gelir
- Yılda: $36.500 protokol geliri (operasyonel personel maliyeti: $0)

**Ölçeklendirme:** Protokol geliri + burned bonds → Retroactive Staking (gelecek faz) → Dürüst kullanıcılara dağıtım → Flywheel ekonomisi

---

### B6. Roadmap

**Faz 1 — Şu an (Tamamlandı):**
- [x] ArafEscrow.sol + test suite
- [x] Node.js backend (relayer mimarisi)
- [x] React frontend (SIWE auth, Trade Room, PIIDisplay)
- [x] Güvenlik denetimi planı hazır

**Faz 2 — Base Builder Grant sonrası (0–3 ay):**
- [ ] Profesyonel akıllı kontrat denetimi
- [ ] Base Sepolia public testnet lansmanı
- [ ] İlk 100 beta kullanıcı (Türkiye kripto topluluğu)
- [ ] Farcaster / Base ekosistemi içi tanıtım

**Faz 3 — Base Batches / Yatırım sonrası (3–9 ay):**
- [ ] Base mainnet lansmanı
- [ ] TRY/USD/EUR piyasaları aktif
- [ ] İlk 1.000 işlem → protocol fee verisi
- [ ] Güvenlik denetimi tamamlandı, audit raporu public

**Faz 4 — Uzun vadeli vizyon:**
- [ ] ZK IBAN doğrulama (araştırma fazı)
- [ ] Retroactive Staking / Philosophical Staking mekanizması
- [ ] Çoklu L2 desteği (Base + Optimism Superchain)

---

### B7. Kurucu Profili

**Solo founder, çalışan ürün, sıfır dış finansman.**

Bu yapı güçlü yanıdır:
- Kontrat, backend ve frontend'in tamamı tek geliştirici tarafından inşa edildi — teknik kapasiteyi kanıtlar
- Fon yokken bu kadar ilerleme, resourcefulness gösterir
- İlk grant/yatırım ile öncelik: tam zamanlı CTO + akıllı kontrat denetim firması

**İlk 60 gün planı (funding alındıktan sonra):**
- Hafta 1–2: Audit firması ile kontrat imzala
- Hafta 3–4: Testnet beta kullanıcılarına duyur
- Ay 2: CTO profili için ağ taraması (Base ekosistemi içi)

---

### B8. Sıkça Sorulan Sert Yatırımcı Sorularına Yanıtlar

**"Binance P2P sizi kopyalarsa ne olur?"**
Binance non-custodial olamaz — iş modeli fon saklama üzerine kurulu. Araf'ın değer önerisi tam olarak Binance'in yapamayacağı şey: fonlara dokunmamak.

**"Türkiye'de regülasyon riski?"**
MASAK uyumu: Araf KYC toplamıyor — kullanıcı cüzdan adresi ile işlem yapıyor. On-chain kimlik zaten public. Fiat transferi taraflar arasında off-chain gerçekleşiyor, platform aracı değil. Bisq modeli ile benzer regülasyon pozisyonu.

**"MAD mekanizması irrasyonel aktörlerde işe yaramaz?"**
Doğru. Bu bilerek kabul edilmiş bir kısıtlama. Tier sistemi irrasyonel aktörleri düşük limitli Tier 0'da tutarak zararı sınırlıyor. Yüksek değerli işlemler yüksek tier gerektiriyor — bu kullanıcılar reputasyonlarını koruma konusunda daha rasyonel.

**"Ekip yok, nasıl ölçeklenecek?"**
Grant/yatırım sonrası ilk işe alım: akıllı kontrat güvenlik uzmanı + CTO. Bu ikisi olmadan mainnet lansmanı yapılmıyor — kasıtlı bir güvenlik önlemi.

---

## Bölüm C — OP Retro Funding Notları
*Uzun vadeli, kamu yararı odaklı fon — önceki iki programın tamamlayıcısı*

Araf'ın OP Retro Funding için uygunluğu:

**Public goods argümanı:**
- Oracle-free P2P escrow mekanizması herhangi bir stablecoin protokolü tarafından kullanılabilir açık altyapı
- Bleeding Escrow game theory modeli açık kaynak ve kopyalanabilir
- Anti-Sybil mekanizmaları (wallet age + dust limit + cooldown) başka protokollerle paylaşılabilir

**OP Superchain uyumu:**
- Base, OP Superchain üyesi
- Araf ileride Optimism mainnet + Base arasında cross-chain escrow yapabilir
- "1 milyar kullanıcıyı on-chain getirme" misyonuna: Türkiye/MENA'dan fiat kullanıcıları katkısı

**Atlas'ta takip edilecek metrikler:**
- Unique wallet count (maker + taker)
- Total transaction volume (USDT)
- Dispute resolution rate (uyuşmazlıkların kaçı BURN'e gitmeden çözülüyor)
- Burned bonds → Treasury geliri

---

## Bölüm D — Outreach Şablonları

### D1. Base Team'e X/Twitter DM (kısa, doğrudan)

```
@base

Oracle-free P2P escrow built on Base — no arbitrators, just math.

USDT/USDC ↔ TRY/USD, fully deployed on Base Sepolia.
- Non-custodial (zero private key backend)
- Dispute: funds decay hourly until parties agree (Bleeding Escrow)
- Anti-Sybil on-chain (wallet age + bond + cooldown)

Applying for Builder Grant. Repo + demo available.
Would love feedback from the team. 🔵
```

### D2. Farcaster Cast (ekosisteme tanıtım)

```
Built a thing for /base:

Araf Protocol — P2P stablecoin escrow where disputes resolve themselves.

No moderator. No oracle. USDT/USDC ↔ TRY/USD.

If you don't release after I pay, your bond starts melting. 
Mine too. We both lose until we talk. 

That's the whole mechanism.

Testnet dropping soon. Solo built, fully on Base. 🔵

/defi /base-builds
```

### D3. Base Grants Discord (#builder-showcase kanalı için)

```
**Project:** Araf Protocol
**Category:** DeFi — P2P Escrow
**Status:** Base Sepolia testnet ready, applying for Builder Grant

**What it does:** Oracle-free P2P fiat↔stablecoin escrow on Base.
Disputes resolve via time-based fund decay (Bleeding Escrow) — no arbitrator.

**Why Base:** Gas economics make the hourly decay mechanism viable.
Mainnet ETH would make every interaction $10+. Base makes it cents.
Also targeting Coinbase's retail user base for TRY/USD/EUR pairs.

**Links:** [GitHub] [Demo] [Audit plan]

Happy to answer technical questions. 🔵
```

---

## Bölüm E — Başvuru Öncelik Sırası

Base'in üç fon programı arasında sıralama:

| Sıra | Program | Neden Önce | Beklenti |
|------|---------|------------|----------|
| **1** | Builder Grant | En hızlı, retroaktif — shipped code yeterli | 1–5 ETH, 2–4 hafta |
| **2** | Base Batches | Yatırım + mentorship + Demo Day | $10K + $50K imkânı |
| **3** | OP Retro Funding | Mainnet metrikler oluştuktan sonra | $50K+ uzun vadeli |

**Builder Grant önce olmalı çünkü:**
- Audit için acil nakit gerekiyor
- Retroaktif — çalışan ürün zaten var
- Kabul edilirse Base Batches başvurusuna güçlü referans oluyor

---

## Bölüm F — Hazırlık Kontrol Listesi (Başvuru Öncesi)

### Builder Grant için:
- [ ] GitHub repo public yap (veya private + review link)
- [ ] Base Sepolia'ya deploy et (mainnet değil, testnet yeterli)
- [ ] Demo video: 2–3 dakika, tam işlem akışı göster (Loom veya YouTube)
- [ ] README güncelle: setup, architecture, audit plan
- [ ] İşlem hacmi / test kullanıcısı varsa ekle (küçük de olsa)

### Base Batches için:
- [ ] Bu dokümandaki B bölümünü form yanıtlarına uyarla
- [ ] "Team" bölümüne: "Solo founder + ilk 60 günde CTO ve security audit" yaz
- [ ] Demo Day için pitch deck hazırla (PITCH_EN.md'den türet)
- [ ] Kurucu LinkedIn/Twitter profilini güncel tut

### OP Retro için:
- [ ] Atlas'a proje ekle (önce mainnet deploy şart)
- [ ] Farcaster üzerinde düzenli build güncellemeleri paylaş
- [ ] On-chain işlem metriklerini takip et

---

*Araf Protocol — "Trust the Time, Not the Oracle."*
*Base Sepolia → Mainnet Ready | Mart 2026*
