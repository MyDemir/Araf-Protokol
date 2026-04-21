> ⚠️ **Historical/Archive Document (Non-Canonical)**
>
> Bu dosya tarihsel analiz notları içerir ve güncel V3 source-of-truth referansı değildir.
> Kanonik mimari için: `docs/TR/ARCHITECTURE.md` ve `docs/EN/ARCHITECTURE.md` dosyalarını esas alın.
>

# 🌀 Araf Protokolü — Kanonik Mimari & Teknik Referans

> **Versiyon:** 2.37 | **Ağ:** Base (Katman 2) | **Durum:** Testnete Hazır | **Son Güncelleme:** Mart 2026

> **Sürüm Notu (aktif çalışma kopyası):** Bu revizyon, teyitli `v2_36` tabanı üzerine `App.jsx` içindeki kalan doğrulanmış katmanların işlendiği 2.37 sürümüdür. Bu turda eklenen kapsam: (1) `App` ana bileşeninin root orchestration rolü, (2) pending transaction recovery ve auto-resume davranışı, (3) provider listener lifecycle (`bind`) ve cleanup semantiği, (4) türetilmiş zaman katmanı (`useMemo` + `useCountdown`), (5) raw-token → display dönüşüm sınırları ve render içine gömülü iş kuralı/IIFE riskleri.

---

## İçindekiler

1. [Vizyon ve Temel Felsefe](#1-vizyon-ve-temel-felsefe)
2. [Hibrit Mimari: On-Chain ve Off-Chain](#2-hibrit-mimari-on-chain-ve-off-chain)
3. [Sistem Katılımcıları](#3-sistem-katılımcıları)
4. [Tier ve Teminat Sistemi](#4-tier-ve-teminat-sistemi)
5. [Anti-Sybil Kalkanı](#5-anti-sybil-kalkanı)
6. [Standart İşlem Akışı (Happy Path)](#6-standart-işlem-akışı-happy-path)
7. [Uyuşmazlık Sistemi — Bleeding Escrow](#7-uyuşmazlık-sistemi--bleeding-escrow)
8. [İtibar ve Ceza Sistemi](#8-itibar-ve-ceza-sistemi)
9. [Güvenlik Mimarisi](#9-güvenlik-mimarisi)
10. [Veri Modelleri (MongoDB)](#10-veri-modelleri-mongodb)
11. [Hazine Modeli](#11-hazine-modeli)
12. [Saldırı Vektörleri ve Bilinen Sınırlamalar](#12-saldırı-vektörleri-ve-bilinen-sınırlamalar)
13. [Kesinleşmiş Protokol Parametreleri](#13-kesinleşmiş-protokol-parametreleri)
14. [Gelecek Evrim Yolu](#14-gelecek-evrim-yolu)
15. [Frontend UX Koruma Katmanı (Mart 2026)](#15-frontend-ux-koruma-katmanı-mart-2026)

---

## 1. Vizyon ve Temel Felsefe

Araf Protokolü; fiat para birimi (TRY / USD / EUR) ile kripto varlıklar (USDT / USDC) arasında güvensiz ortamda takas yapmayı mümkün kılan, **emanet tutmayan, insansız ve oracle-bağımsız** bir eşten eşe escrow sistemidir. Moderatör yok, hakeme başvuru yok, müşteri hizmetleri yok. Uyuşmazlıklar on-chain zamanlayıcılar ve ekonomik oyun teorisi ile özerk olarak çözülür.

> *"Sistem yargılamaz. Dürüstsüzlüğü pahalıya mal eder."*

### Temel İlkeler

| İlke | Açıklama |
|---|---|
| **Emanet Tutmayan (Non-Custodial)** | Platform kullanıcı fonlarına hiçbir zaman el sürmez. Tüm varlıklar şeffaf bir akıllı sözleşmede kilitlenir. |
| **Oracle-Bağımsız Uyuşmazlık Çözümü** | Hiçbir dış veri kaynağı anlaşmazlıklarda kazananı belirlemez. Çözüm tamamen zaman bazlıdır (Bleeding Escrow). |
| **İnsansız** | Moderatör yok. Jüri yok. Kodu ve zamanlayıcılar her şeye karar verir. |
| **MAD Tabanlı Güvenlik** | Karşılıklı Garantili Yıkım (MAD) oyun teorisi: dürüstsüz davranış her zaman dürüst davranıştan daha pahalıya mal olur. |
| **Non-custodial Backend Anahtar Modeli** | Backend kullanıcı fonlarını kontrol eden custody anahtarı tutmaz; operasyonel automation/relayer signer olabilir ancak kullanıcı fonlarını doğrudan hareket ettiremez. |

### Oracle-Bağımsızlık Açıklaması

**Oracle KULLANILMAYAN alanlar:**
- ❌ Banka transferlerinin doğrulanması
- ❌ Uyuşmazlıklarda "haklı taraf" kararı
- ❌ Escrow serbest bırakmayı tetikleyen herhangi bir dış veri akışı

**Off-chain yaşayan veriler (ve nedeni):**
- ✅ PII verisi (IBAN, Telegram) — **GDPR / KVKK: Unutulma Hakkı**
- ✅ Emir defteri ve ilanlar — **Performans: 50ms altı sorgu**
- ✅ Analitik — **Kullanıcı deneyimi: gerçek zamanlı istatistikler**

> Ayrımın önemi: Oracle'lar yalnızca yasal veri depolama için kullanılır — **asla uyuşmazlık sonuçları için değil.**

---

## 2. Hibrit Mimari: On-Chain ve Off-Chain

Araf **Web2.5 Hibrit Sistem** olarak çalışır. Güvenlik açısından kritik operasyonlar on-chain'de; gizlilik ve performans açısından kritik veriler off-chain'de yaşar.

### Mimari Karar Matrisi

| Bileşen | Depolama | Teknoloji | Gerekçe |
|---|---|---|---|
| USDT / USDC Escrow | On-Chain | ArafEscrow.sol | Değiştirilemez, emanet tutmayan, güvensiz |
| İşlem Durum Makinesi | On-Chain | ArafEscrow.sol | Bleeding zamanlayıcısı tamamen özerk |
| İtibar Puanları | On-Chain | ArafEscrow.sol | Kalıcı, sahte olunamaz geçmiş kanıtı |
| Teminat Hesaplamaları | On-Chain | ArafEscrow.sol | Hiçbir backend cezaları manipüle edemez |
| Anti-Sybil Kontrolleri | On-Chain | ArafEscrow.sol | Cüzdan yaşı, dust, cooldown zorunlu kılınmış |
| PII Verisi (IBAN / İsim) | Off-Chain | MongoDB + KMS | GDPR / KVKK: Unutulma Hakkı |
| Emir Defteri ve İlanlar | Off-Chain | MongoDB | 50ms altı sorgular, ücretsiz filtreleme |
| Olay Önbelleği | Off-Chain | MongoDB | Hızlı UI için işlem durumu aynası |
| Operasyonel Geçici Durum | Bellekte | Redis | Nonce, rate limit, checkpoint, DLQ, kısa ömürlü koordinasyon |

### Teknoloji Yığını

| Katman | Teknoloji | Detaylar |
|---|---|---|
| Akıllı Sözleşme | Solidity + Hardhat | 0.8.24, optimizer runs=200, `viaIR`, `evmVersion=cancun` — Base L2 (Chain ID 8453) / Base Sepolia (84532) |
| Backend | Node.js + Express | CommonJS, non-custodial relayer |
| Veritabanı | MongoDB + Mongoose | v8.x — İlanlar, İşlemler, Kullanıcılar; `maxPoolSize=100`, `socketTimeoutMS=20000`, `serverSelectionTimeoutMS=5000` |
| Önbellek / Auth / Koordinasyon | Redis | v4.x — Hız limitleri, nonce'lar, event checkpoint, DLQ, readiness gate |
| Zamanlanmış Görevler | Node.js jobs | Pending listing cleanup, PII/dekont retention cleanup, on-chain reputation decay, günlük stats snapshot |
| Şifreleme | AES-256-GCM + HKDF + KMS/Vault | Zarf şifreleme, cüzdan başına deterministik DEK, üretimde harici anahtar yöneticisi |
| Kimlik Doğrulama | SIWE + JWT (HS256) | EIP-4361, 15 dakika geçerlilik |
| Frontend | React 18 + Vite + Wagmi | Tailwind CSS, viem, EIP-712 |
| Sözleşme ABI | Deploy'da otomatik oluşturulur | `frontend/src/abi/ArafEscrow.json` |

### Çalışma Zamanı Bağlantı Politikaları

Araf'ın gerçek çalışma zamanı davranışı yalnızca teknoloji seçimiyle değil, **bağlantı ve hata politikalarıyla** tanımlanır:

- **MongoDB havuz politikası:** Event replay/worker yükü ile eşzamanlı API trafiği aynı anda Mongo'ya binebilir. Bu nedenle bağlantı havuzu düşük tutulmaz; havuz doygunluğu sonucu kullanıcı isteklerinin `serverSelectionTimeoutMS` ile düşmesi önlenir.
- **Timeout hizalama:** Mongo `socketTimeoutMS`, reverse proxy/CDN timeout'ının altında tutulur. Amaç, istemci bağlantısı koptuktan sonra arka planda uzun süre yaşayan "zombi" sorgular bırakmamaktır.
- **Fail-fast DB yaklaşımı:** Mongo bağlantısı `disconnected` event'i ile koparsa süreç kendini sonlandırır. PM2 / Docker / orchestrator temiz bir process ile yeniden başlatır. Kısmi reconnect yerine temiz başlangıç tercih edilir.
- **Redis readiness-first yaklaşımı:** Redis yalnızca bağlanmış olmakla yetinmez; `isReady` durumu uygulama tarafından kontrol edilir. Böylece Redis'e bağlı middleware'ler tek nokta hatasına dönüşmez.
- **Managed Redis / TLS uyumu:** `rediss://` veya TLS zorunlu servislerde güvenli bağlantı yerel config tarafından desteklenir. Self-signed sertifika bypass yalnızca geliştirme içindir.

### Sıfır Güven Backend Modeli

Off-chain altyapı kullanılmasına rağmen **backend fonları çalamaz veya sonuçları manipüle edemez:**

```
✅ Backend'de kullanıcı fonları için custody anahtarı yoktur (operasyonel signer olabilir)
✅ Backend escrow serbest bırakamaz (yalnızca kullanıcılar imzalayabilir)
✅ Backend Bleeding Escrow zamanlayıcısını atlayamaz (on-chain zorunlu)
✅ Backend itibar puanlarını sahte gösteremez (on-chain doğrulanır)
⚠️  Backend PII'yı şifre çözebilir (UX için zorunlu kötülük — hız sınırlama + denetim logları ile azaltılmış)
```

### Kontrat Otoritesi ve Backend Aynası

`ArafEscrow.sol`, protokolün **tek otoritatif durum makinesidir**. Backend, event listener ve Mongo aynası yalnızca bu gerçeği indeksler; iş kurallarını tek başına değiştiremez.

Bunun pratik anlamı:
- `TradeState` geçişleri kontratta zorunlu kılınır; backend yalnızca yansıtır.
- Tier limiti, teminat BPS'leri, maksimum tutarlar, anti-sybil kapıları ve decay matematiği kontrat sabitlerinden gelir.
- Backend bir UX yüzeyi sağlar ama kontratın reddettiği bir akışı “geçerli” hale getiremez.
- Mimari uyuşmazlıklarda **kontrat gerçekliği esas alınır**; backend mirror alanları en fazla cache / görüntüleme kolaylığıdır.
- Event adları, Mongo aynaları, route cevapları ve analitik özetler **yardımcı yorum katmanlarıdır**; kontrat storage'ı ve state-changing fonksiyonlarıyla çelişiyorsa otorite sayılmaz.

---

## 3. Sistem Katılımcıları

| Rol | Etiket | Yetenekler | Kısıtlamalar |
|---|---|---|---|
| **Maker** | Satıcı | İlan açar. USDT + Teminat kilitler. Serbest bırakabilir, itiraz edebilir, iptal önerebilir. | Kendi ilanında Taker olamaz. Teminat işlem çözülene kadar kilitli kalır. |
| **Taker** | Alıcı | Fiat'ı off-chain gönderir. Taker Teminatı kilitler. Ödeme bildirebilir, iptal onaylayabilir. | Anti-Sybil filtrelerine tabidir. Yasak/ban kapısı yalnız taker girişinde uygulanır. |
| **Hazine** | Protokol | %0.2 başarı ücreti + eriyip/yanan fonları alır. | İlk adres deploy sırasında verilir; ancak kontrat sahibi `setTreasury()` ile güncelleyebilir. Backend tek başına değiştiremez. |
| **Backend** | Relayer | Şifreli PII'yı depolar, emir defterini indeksler, JWT yayınlar, API sunar. | Kullanıcı fonları için custody anahtarı yoktur; operasyonel signer olabilir. Kullanıcı fonlarını hareket ettiremez. On-chain durumu değiştiremez. |

---

## 4. Tier ve Teminat Sistemi

5 kademeli sistem **"Soğuk Başlangıç" sorununu** çözer: yeni cüzdanlar yüksek hacimli işlemlere anında erişemez, böylece deneyimli kullanıcılar test edilmemiş karşı taraflardan korunur. Tüm teminat sabitleri on-chain zorunlu kılınmıştır ve backend tarafından değiştirilemez.

### Tier Tanımları

> **YENİ KURAL:** Bir kullanıcı, yalnızca mevcut efektif tier seviyesine eşit veya daha düşük seviyedeki ilanları açabilir veya bu ilanlara alım emri verebilir.

| Tier | Kripto Limiti (USDT/USDC) | Maker Teminatı | Taker Teminatı | Cooldown | **Erişim İçin Gerekli İtibar (On-Chain Zorunlu)** |
|---|---|---|---|---|---|
| **Tier 0** | Maksimum 150 USDT | %0 | %0 | 4 saat / işlem | **Varsayılan:** Tüm yeni kullanıcılar buradan başlar. |
| **Tier 1** | Maksimum 1.500 USDT | %8 | %10 | 4 saat / işlem | ≥ 15 başarılı işlem, 15 gün aktiflik, **≤ 2 başarısız uyuşmazlık** |
| **Tier 2** | Maksimum 7.500 USDT | %6 | %8 | Sınırsız | ≥ 50 başarılı işlem, **≤ 5 başarısız uyuşmazlık** |
| **Tier 3** | Maksimum 30.000 USDT | %5 | %5 | Sınırsız | ≥ 100 başarılı işlem, **≤ 10 başarısız uyuşmazlık** |
| **Tier 4** | Limitsiz (30.000+ USDT) | %2 | %2 | Sınırsız | ≥ 200 başarılı işlem, **≤ 15 başarısız uyuşmazlık** |

Not: Limitler Kur Manipülasyonunu (Rate Manipulation) engellemek adına tamamen Kripto varlık (USDT/USDC) üzerinden hesaplanır. Fiat (TRY/USD) kurları limit belirlemede dikkate alınmaz.

### Kontrat Tarafından Zorlanan Tier Gerçekliği

Kontrat, frontend veya backend varsayımlarına güvenmez; aşağıdaki kuralları doğrudan `createEscrow()` ve `lockEscrow()` içinde zorlar:

- `createEscrow()` için istenen tier, maker'ın **efektif tier** değerinden yüksek olamaz.
- `lockEscrow()` için taker'ın efektif tier'ı trade tier'ını karşılamalıdır.
- Tier 0–3 için maksimum escrow tutarı on-chain sabittir; Tier 4 bilinçli olarak sınırsızdır.
- `GOOD_REP_DISCOUNT_BPS` ve `BAD_REP_PENALTY_BPS` maker/taker bond hesabına kontrat içinde uygulanır.
- `listingRef == bytes32(0)` olan escrow oluşturma çağrıları doğrudan revert eder; kanonik olmayan create yolu kabul edilmez.

### Efektif Tier Hesaplaması

Bir kullanıcının işlem yapabileceği maksimum tier, iki değerin **en düşüğü** alınarak belirlenir:
1.  **İtibar Bazlı Tier:** Yukarıdaki tabloya göre kullanıcının `successfulTrades` ve `failedDisputes` sayılarına göre ulaştığı en yüksek tier.
2.  **Ceza Bazlı Tier Tavanı (`maxAllowedTier`):** Ardışık yasaklamalar sonucu uygulanan tier düşürme cezası.

Örnek: Bir kullanıcı normalde Tier 3 için yeterli itibara sahip olsa bile, eğer bir ceza sonucu `maxAllowedTier` değeri 1'e düşürülmüşse, bu kullanıcı yalnızca Tier 0 ve Tier 1 işlemleri yapabilir.

Ek kontrat kuralı: Kullanıcı başarı sayısıyla Tier 1+ eşiğine ulaşmış olsa bile, ilk başarılı işleminin üzerinden en az **15 gün** (`MIN_ACTIVE_PERIOD`) geçmeden efektif tier'ı 0'ın üstüne çıkamaz. Yani performans tek başına yeterli değildir; zaman bileşeni de kontrat tarafından zorlanır.

### İtibar Temelli Teminat Düzenleyicileri

Tier 1–4 için temel teminat oranlarının üzerine uygulanır (Tier 0'a uygulanmaz):

| Koşul | Etki |
|---|---|
| 0 başarısız uyuşmazlık + en az 1 başarılı işlem | −%1 teminat indirimi (temiz geçmiş ödülü) |
| 1 veya daha fazla başarısız uyuşmazlık | +%3 teminat cezası |

---

## 5. Anti-Sybil Kalkanı

Her `lockEscrow()` çağrısından önce dört on-chain filtresi çalışır. Backend bunları **atlayamaz veya geçersiz kılamaz.**

| Filtre | Kural | Amaç |
|---|---|---|
| **Kendi Kendine İşlem Engeli** | `msg.sender ≠ maker adresi` | Kendi ilanlarında sahte işlemi engeller |
| **Cüzdan Yaşı** | Kayıt ≥ ilk işlemden 7 gün önce | Yeni oluşturulan Sybil cüzdanlarını engeller |
| **Dust Limiti** | Yerel bakiye ≥ `0.001 ether` | Sıfır bakiyeli tek kullanımlık cüzdanları engeller |
| **Tier 0 / 1 Cooldown** | Maksimum 4 saatte 1 işlem | Düşük teminatlı tierlerde bot ölçekli spam saldırısını sınırlar |
| **Challenge Ping Cooldown** | `PAID` durumundan sonra `pingTakerForChallenge` için ≥ 24 saat beklemek zorunlu | Hatalı itirazları ve anlık tacizi önler |
| **Ban Kapısı (yalnız taker rolü)** | `notBanned` sadece `lockEscrow()` girişinde uygulanır | Yasaklı cüzdanın alıcı rolünde yeni trade'e girmesini engeller; maker rolünü veya mevcut trade kapanışlarını tek başına dondurmaz |

### İlgili Kontrat Fonksiyonları

| Fonksiyon | Açıklama |
|---|---|
| `registerWallet()` | Bir cüzdanın, 7 günlük "cüzdan yaşlandırma" sürecini başlatmasını sağlar. `lockEscrow` fonksiyonundaki Anti-Sybil kontrolü için zorunludur. |
| `antiSybilCheck(address)` | `aged`, `funded` ve `cooldownOk` alanlarını döndüren bilgi amaçlı bir `view` helper'ıdır. Bu fonksiyon UX ve ön-bilgilendirme içindir; bağlayıcı karar yine `lockEscrow()` içinde alınır. |
| `getCooldownRemaining(address)` | Cooldown penceresinde kalan süreyi döndürür. Kullanıcıya "ne kadar beklemeliyim?" bilgisini vermek için yararlıdır; cooldown kuralını kendisi uygulamaz. |

---

## 6. Standart İşlem Akışı (Happy Path)

```
Maker createEscrow() çağırır
  → AÇIK (USDT + Maker Teminatı on-chain kilitlenir)
    → Taker lockEscrow() — Anti-Sybil geçer
      → KİLİTLİ (Taker Teminatı on-chain kilitlenir)
        → Taker reportPayment() + IPFS makbuz hash'i
          → ÖDENDİ (48 saatlik Grace Period zamanlayıcısı on-chain başlar)
            → Maker releaseFunds() çağırır
              → ÇÖZÜLDÜ ✅ (%0.2 ücret kesilir, fonlar dağıtılır)
```

### Durum Tanımları

| Durum | Tetikleyen | Açıklama |
|---|---|---|
| `OPEN` (Açık) | Maker `createEscrow()` | İlan yayında. USDT + Maker teminatı on-chain kilitli. |
| `LOCKED` (Kilitli) | Taker `lockEscrow()` | Anti-Sybil geçti. Taker teminatı on-chain kilitli. |
| `PAID` (Ödendi) | Taker `reportPayment()` | IPFS makbuz hash'i on-chain kaydedildi. 48 saatlik zamanlayıcı başladı. |
| `RESOLVED` (Çözüldü) | Maker `releaseFunds()` | %0.2 ücret alındı. USDT → Taker. Teminatlar iade edildi. |
| `CANCELED` (İptal) | 2/2 EIP-712 imzası | **LOCKED durumunda:** Ücret yok, tam iade. **PAID veya CHALLENGED durumunda:** Kalan miktarlar üzerinden %0.2 protokol ücreti kesilir, net tutar iade edilir. Her iki durumda itibar cezası uygulanmaz. |
| `BURNED` (Yakıldı) | 240 saattan sonra `burnExpired()` | Tüm kalan fonlar → Hazine. |

### İlan Yaşam Döngüsü (Off-Chain Vitrin + On-Chain Otorite)

1. Maker `POST /api/listings` çağrısı yapar.
2. Backend, session wallet eşleşmesini ve on-chain `effectiveTier` değerini doğrular.
3. İlan MongoDB'de önce `PENDING` oluşturulur; `listing_ref` deterministik olarak türetilir.
4. Frontend/kontrat akışı `EscrowCreated` olayını üretir.
5. Event listener ilgili kaydı `OPEN` durumuna geçirir ve vitrine görünür hale getirir.
6. Eğer ilan on-chain'e hiç düşmezse, cleanup job 12 saat sonra kaydı `DELETED` durumuna süpürür.

Bu akış, pazar yeri vitrininin hızlı kalmasını sağlarken otoriteyi yine zincirde bırakır; backend tek başına "gerçek" açık ilan uydurmaz.

### Kanonik Oluşturma Yolu ve Pause Semantiği

Kontratta escrow oluşturmanın tek geçerli yolu `createEscrow(token, amount, tier, listingRef)` çağrısıdır. Legacy üç parametreli overload artık bilinçli olarak `InvalidListingRef()` ile revert eder. Böylece kimliksiz / canonical bağdan kopuk escrow üretilemez.

Ayrıca `pause()` durumu tüm sistemi dondurmaz:
- **Yeni** `createEscrow()` ve `lockEscrow()` çağrıları durur.
- Mevcut işlemler için `releaseFunds`, `autoRelease`, `proposeOrApproveCancel`, `burnExpired` gibi kapanış yolları açık kalır.

Bu tercih, emergency modda yeni risk alınmasını engellerken canlı trade'lerin kilitli kalıp kullanıcıları sonsuza kadar hapsetmesini önler.

### Frontend Orkestrasyon Gerçekliği (App.jsx)

`App.jsx`, happy-path akışını tek transaction olarak modellemez; özellikle listing oluşturma ve taker kilitleme tarafında çok aşamalı bir frontend orkestrasyonu uygular:

1. **Maker listing hazırlığı:** `handleCreateEscrow()` önce backend `POST /api/listings` çağrısı ile canonical `listing_ref` üretir. Bu referans yoksa on-chain `createEscrow()` çağrısına hiç gidilmez.
2. **Maker allowance + create:** aynı akışta maker bond ve ana escrow tutarı için allowance kontrol edilir; gerekirse `approve()` çağrılır, ardından `createEscrow(token, amount, tier, listingRef)` çalıştırılır.
3. **Taker allowance + lock:** `handleStartTrade()` önce on-chain `getTrade()` okuyarak miktar ve token adresini doğrular; gerekirse taker bond için `approve()` yapar, sonra `lockEscrow()` çağırır.
4. **Mirror gecikmesi toleransı:** on-chain lock sonrası backend `tradeId` kaydı hemen gelmezse frontend bunu anında hata saymaz; `_pendingBackendSync` geçiş durumuyla trade room'a girer ve event listener gecikmesini tolere eder.

Bu nedenle frontend market ve escrow başlatma katmanı, kontrat otoritesinin yerine geçen bir state machine değil; **off-chain hazırlık + on-chain çağrı + backend mirror senkronizasyonu** arasında çalışan çok aşamalı bir orkestrasyon yüzeyidir.

### Trade Room Kritik Aksiyon Gerçekliği (App.jsx)

`App.jsx`, trade room içindeki kritik aksiyonları tek tip “butona bas → kontrat çağrısı” modeliyle ele almaz; off-chain kanıt yükleme, backend audit izi, on-chain çağrı ve yerel runtime state güncellemesi arasında ayrışmış bir orkestrasyon kurar:

1. **Dekont yükleme ile ödeme bildirimi ayrıdır:** `handleFileUpload()`, dosyayı backend'e yükler ve dönen SHA-256 hash'ini `paymentIpfsHash` state'ine yazar; `handleReportPayment()` ise yalnız bu hash hazırsa on-chain `reportPayment()` çağrısına gider. Böylece kanıt yükleme ve zincire “ödedim” beyanı iki ayrı adım olarak korunur.
2. **Karşılıklı iptal koordinasyonu hibrittir:** `handleProposeCancel()`, nonce'u kontrattan okur, EIP-712 imzasını frontend'de üretir, önce backend `propose-cancel` rotasına gönderir; yalnız relay tarafı `bothSigned` döndürdüğünde on-chain `proposeOrApproveCancel()` çağrısı yapar. Böylece imza koordinasyonu off-chain, nihai iptal state'i on-chain kalır.
3. **Chargeback beyanı iki katmanlıdır:** `handleChargebackAck()` yalnız UI checkbox state'ini günceller. Asıl audit izi `handleRelease()` içinde backend `POST /api/trades/:id/chargeback-ack` çağrısı ile yazılmaya çalışılır; ardından on-chain `releaseFunds()` çağrılır. Backend log başarısız olsa bile kontrat çağrısı sürdürülür.
4. **PAID ve CHALLENGED release yolları ayrıdır:** Frontend, `PAID` durumunda `chargebackAccepted` işaretini zorunlu tutar; `CHALLENGED` durumunda bu guard atlanır. Bu, aynı `releaseFunds()` fonksiyonunun iki farklı operasyonel bağlamda kullanıldığını UI düzeyinde de yansıtır.
5. **Challenge akışı iki adımlıdır:** `handleChallenge()` önce `pingTakerForChallenge()` sonra 24 saat sonra `challengeTrade()` çağrısı yapar; her iki adımdan sonra `fetchMyTrades()` çağrılarak 15 saniyelik polling beklenmeden trade room senkronize edilir.
6. **Taker ping / auto-release yolu da ayrı bir zaman kapısıdır:** `handlePingMaker()` ve `handleAutoRelease()` taker'ın maker pasifliğine karşı kullandığı ayrı bir timeout yoludur; `renderTradeRoom()` içinde derived timer'lar (`makerPingEndDate`, `makerChallengePingEndDate`, `makerChallengeEndDate`) ile UI görünürlüğü yönetilir, fakat nihai enforcement yine kontrattadır.

Bu nedenle trade room, yalnız kontrat fonksiyonlarını gösteren bir ekran değil; **backend audit izi + off-chain kanıt taşıma + on-chain state geçişi + polling/refresh senkronizasyonu** arasında çalışan ayrı bir uygulama orkestrasyon katmanıdır.

### Okuma, Polling ve Senkronizasyon Gerçekliği (App.jsx)

`App.jsx`, happy-path ve trade room deneyimini tek seferlik veri yükleme ile bırakmaz; kontrat ve backend yüzeylerini farklı amaçlarla kullanan canlı bir okuma/senkronizasyon katmanı kurar:

1. **Kontrattan otoritatif okunan canlı değerler:** `fetchFeeBps`, `loadTokenDecimals`, `fetchAmounts`, `fetchUserReputation`, `fetchSybil` ve `fetchPausedStatus`; fee, token decimals, challenged bleeding miktarları, itibar, anti-sybil ve pause durumunu doğrudan kontrat read'leriyle toplar.
2. **Backend'den okunan operasyonel özetler:** `fetchStats` ve `fetchMyTrades`; hızlı kart görünümü, aktif trade odası listesi ve kullanıcı paneli için backend mirror / aggregation yüzeyini kullanır.
3. **Polling mimarinin parçasıdır:** challenged trade için bleeding miktarları periyodik okunur; anti-sybil, pause ve aktif trade görünümü interval tabanlı güncellenir. Frontend burada pasif ekran değil, canlı senkronizasyon yapan bir runtime coordinator gibi davranır.
4. **Visibility-resync davranışı vardır:** sekme tekrar görünür olduğunda `onVisibilityChange` aktif trade verisini ve ilgili polling yüzeylerini yeniden tetikler; arka plan sekmesi gecikmelerinin trade room'da stale görünüm yaratması azaltılır.

Bu nedenle App düzeyindeki veri akışı tek kaynaklı değildir; **ekonomik/kural verileri için kontrat-read, operasyonel hız ve listeleme için backend-read** birlikte kullanılır.

### Ücret Modeli

- **Taker ücreti:** Taker'ın aldığı USDT'den %0,1 kesilir
- **Maker ücreti:** Maker'ın teminat iadesinden %0,1 kesilir
- **Toplam:** Başarıyla çözülen her işlemde %0,2
- **İptal edilen işlemler:** Karşılıklı iptal (CANCELED) durumunda, varsa kanamadan (decay) kurtulan net tutar üzerinden de standart protokol ücreti alınır.

### Event Semantiği İçin Kontrat Notu

Kontrat bazı event adlarını birden fazla ekonomik yol için yeniden kullanır:
- `EscrowReleased` hem `releaseFunds()` hem de `autoRelease()` içinde emit edilir; ancak event alanları ikinci durumda standart başarı ücretini değil **ihmal cezalarını** temsil eder.
- `EscrowCanceled` hem `cancelOpenEscrow()` hem de karşılıklı iptal `_executeCancel()` yolunda emit edilir; ekonomik bağlam aynı değildir.

Bu yüzden backend analitiği veya event mirror'u yalnız event adına bakarak iş kararı veremez; ilgili önceki state ve çağrı yolu da dikkate alınmalıdır.

### İlgili Kontrat Fonksiyonları

| Fonksiyon | Açıklama |
|---|---|
| `createEscrow(...)` | Maker'ın bir ilan oluşturmasını ve fonları kilitlemesini sağlar. |
| `lockEscrow(tradeId)` | Taker'ın bir ilana girmesini ve teminatını kilitlemesini sağlar. |
| `reportPayment(tradeId, ipfsHash)` | Taker'ın ödemeyi yaptığını bildirmesini sağlar. |
| `releaseFunds(tradeId)` | Maker'ın ödemeyi onaylayıp fonları serbest bırakmasını sağlar. |
| `cancelOpenEscrow(tradeId)` | Sadece Maker'ın çağırabildiği, henüz bir Taker tarafından kilitlenmemiş (`OPEN` durumdaki) bir ilanı iptal etmesini ve kilitlediği tüm fonları geri almasını sağlar. |
| `getTrade(tradeId)` | Belirtilen `tradeId`'ye sahip işlemin tüm detaylarını (`Trade` struct) döndüren bir `view` fonksiyonudur. |

**Önemli kontrat sınırı:** `reportPayment()` on-chain tarafta `ipfsHash` için yalnızca **boş olmama** kontrolü yapar. CID biçimi / içerik doğrulaması kontrat garantisi değildir; bu hijyen katmanı backend mirror ve route doğrulamalarında sağlanır.

---

## 7. Uyuşmazlık Sistemi — Bleeding Escrow

Araf Protokolünde hakem yoktur. Bunun yerine, uzun süreli uyuşmazlıkları matematiksel olarak pahalıya mal eden **asimetrik zaman çürümesi mekanizması** kullanılır. Bir taraf ne kadar uzun süre iş birliği yapmayı reddederse, o kadar çok kaybeder.

### Tam Durum Makinesi

```
ÖDENDİ
  │
  ├──[Maker Serbest Bırak'a basar]──────────────── ÇÖZÜLDÜ ✅
  ├──[48 saat geçti, Taker 'pingMaker'e basar] → [24 saat daha geçti, Taker 'autoRelease'e basar]
  │   └── ÇÖZÜLDÜ ✅ (Maker'a +1 Başarısız itibar, her iki teminattan %2 ihmal cezası)
  │
  └──[24 saat geçti, Maker 'pingTakerForChallenge'e basar] → [24 saat daha geçti, Maker 'challengeTrade'e basar]
      │
    İTİRAZ AÇILDI
        GRACE PERIOD (48 saat) — mali ceza yok
        ├──[Müşterek İptal (2/2 EIP-712)]────────── İPTAL 🔄
        ├──[Karşılıklı Serbest Bırakma]──────────── ÇÖZÜLDÜ ✅
        │
        └──[48 saat sonra anlaşma yok]
                    │
                KANAMA ⏳ (özerk on-chain çürüme)
                ├── Taker teminatı: 42 BPS/saat
                ├── Maker teminatı: 26 BPS/saat
                ├── Escrowed kripto: 34 BPS/saat (Kanama'nın 96. saatinde başlar)
                │
                ├──[İstediği zaman serbest bırakma]── ÇÖZÜLDÜ ✅ (kalan fonlar)
                ├──[İptal (2/2)]──────────────────── İPTAL 🔄 (kalan fonlar)
                └──[240 saat geçti — anlaşma yok]
                          │
                        YAKILD 💀 (tüm fonlar → Hazine)
```

### Karşılıklı Dışlayıcı Ping Yolları

Kontrat iki ayrı liveness yolu tanımlar ve bunların aynı anda açılmasına izin vermez:

- **Maker yolu:** `pingTakerForChallenge()` → 24 saat sonra `challengeTrade()`
- **Taker yolu:** `pingMaker()` → 24 saat sonra `autoRelease()`

Bu iki yol `ConflictingPingPath` hatasıyla birbirini dışlar. Yani maker challenge penceresini açtıysa taker aynı trade üzerinde auto-release ping yolu başlatamaz; taker auto-release yolunu açtıysa maker sonradan challenge ping yoluna geçemez. Bu, aynı trade için iki çelişkili zorlayıcı çözüm hattının paralel açılmasını önler.

### Kanama Çürüme Oranları

| Varlık | Taraf | Oran | Başlangıç |
|---|---|---|---|
| **Taker Teminatı** | Taker (itiraz açan) | 42 BPS / saat (~günde %10,1) | Kanama'nın 0. saati |
| **Maker Teminatı** | Maker | 26 BPS / saat (~günde %6,2) | Kanama'nın 0. saati |
| **Escrowed Kripto** | Trade'in ana escrow tutarı | 34 BPS / saat (~günde %8,2) | Kanama'nın 96. saati |

> Bleeding decay tek kalemli değildir. Kontrat; **maker bond** için 26 BPS/saat, **taker bond** için 42 BPS/saat ve **escrowed crypto** için 34 BPS/saat uygular. `totalDecayed`, bu üç bileşenin toplamıdır.

> **USDT neden Kanama'nın 96. saatinde (itirazdaki 144. saatte) başlar?**
> 48 saatlik grace period + hafta sonu banka gecikmelerine karşı 96 saatlik tampon. Dürüst tarafları anında zarar görmekten korurken aciliyeti sürdürür.

### Müşterek İptal (EIP-712)

Her iki taraf da `LOCKED`, `PAID` veya `CHALLENGED` durumunda karşılıklı çıkış önerebilir. Ancak kontrat modeli, backend'in iki imzayı toplayıp üçüncü bir taraf adına tek seferde submit ettiği bir batch yol değildir. Her taraf kendi EIP-712 imzasını üretir ve **kendi hesabıyla** `proposeOrApproveCancel()` çağrısını yapar. Backend bu akışta yalnız koordinasyon, audit ve UX kolaylaştırıcı rol üstlenir.

Ekonomik sonuç kontrat içinde `_executeCancel()` ile belirlenir:
- erimiş (`decayed`) kısım önce hazineye gider,
- `PAID` / `CHALLENGED` durumlarında standart protokol ücretleri uygulanır,
- kalan net tutarlar iade edilir,
- ek itibar cezası yazılmaz.

İmza tipi: `CancelProposal(uint256 tradeId, address proposer, uint256 nonce, uint256 deadline)`

Önemli kontrat gerçeği: `sigNonces` sayaçları **cüzdan başına globaldir**. Bu nedenle off-chain saklanan bir cancel imzası, aynı cüzdanın başka bir trade üzerinde onay vermesi veya önceki bir cancel çağrısının başarıyla işlenmesi sonrası bayatlayabilir. İmza deposu otorite değildir; son geçerlilik kontrolü her zaman kontrat nonce'ı ile yapılmalıdır.

### `autoRelease` ve İhmal Cezası

Taker, `pingMaker` fonksiyonunu çağırdıktan 24 saat sonra hala yanıt alamaması durumunda `autoRelease` fonksiyonunu çağırarak fonları tek taraflı serbest bırakabilir. Bu durumda standart işlem ücreti yerine, hem Maker'ın hem de Taker'ın teminatından **%2'lik bir ihmal cezası** (`AUTO_RELEASE_PENALTY_BPS`) kesilir ve Hazine'ye aktarılır. Bu mekanizma, Taker'ın da süreci zorla sonlandırmasının küçük bir maliyeti olmasını sağlayarak sistemi dengeler ve Maker'a karşı kötüye kullanımı caydırır.

### İlgili Kontrat Fonksiyonları

| Fonksiyon | Açıklama |
|---|---|
| `pingTakerForChallenge(tradeId)` | Maker'ın, itiraz etmeden önce Taker'a "ödeme gelmedi" uyarısı göndermesini sağlar. `challengeTrade` için zorunlu bir ön koşuldur. |
| `challengeTrade(tradeId)` | Maker'ın, `pingTakerForChallenge`'dan 24 saat sonra bir işleme itiraz ederek "Bleeding Escrow" fazını başlatmasını sağlar. |
| `pingMaker(tradeId)` | Taker'ın, 48 saatlik `GRACE_PERIOD` dolduktan sonra pasif kalan Maker'a "hayat sinyali" göndermesini sağlar. Bu, `autoRelease` fonksiyonunu çağırmak için bir ön koşuldur. **Not:** ConflictingPingPath hatasını önlemek için Maker ilk uyarıyı (`pingTakerForChallenge`) yaptıysa bu fonksiyon kullanılamaz. |
| `autoRelease(tradeId)` | Taker'ın, `pingMaker`'dan 24 saat sonra hala yanıt vermeyen Maker'a karşı fonları tek taraflı serbest bırakmasını sağlar. |
| `proposeOrApproveCancel(...)` | Tarafların EIP-712 imzasıyla müşterek iptal teklif etmesini veya onaylamasını sağlar. |
| `burnExpired(tradeId)` | 10 günlük kanama süresi dolan işlemlerdeki tüm fonların Hazine'ye aktarılmasını sağlar. Sadece `CHALLENGED` durumunda çalışır ve `onlyOwner`/taraf kısıtı yoktur; timeout dolduktan sonra **permissionless** sonlandırma yoludur. |
| `getCurrentAmounts(tradeId)` | Bir uyuşmazlık durumunda, "Bleeding Escrow" mekanizması sonrası anlık olarak kalan kripto ve teminat miktarlarını hesaplayıp döndüren bir `view` fonksiyonudur. |

`getCurrentAmounts()` özellikle frontend simülasyonu, analitik ve üçüncü taraf doğrulaması için önemlidir: backend mirror'ın hesapladığı bir tahmin değil, kontratın o andaki ekonomik durumunu doğrudan verir.

---

## 8. İtibar ve Ceza Sistemi

### İtibar Güncelleme Mantığı

| Sonuç | Maker | Taker |
|---|---|---|
| Uyuşmazlıksız kapanış (ÇÖZÜLDÜ) | +1 Başarılı | +1 Başarılı |
| Maker itiraz etti → sonra serbest bıraktı (S2) | +1 Başarısız | +1 Başarılı |
| `autoRelease` — Maker 48 saat pasif kaldı | +1 Başarısız | +1 Başarılı |
| YAKILDI (10 günlük timeout) | +1 Başarısız | +1 Başarısız |

### Yasak ve Ardışık Eskalasyon

**Tetikleyici:** İlk ban, kullanıcı `failedDisputes >= 2` eşiğine ulaştığında başlar. Bundan sonra **her ek başarısız uyuşmazlık**, `consecutiveBans` sayacını tekrar artırır ve yeni/uzatılmış ban-escalation yaratır; model “her iki başarısızlıkta bir” değil, eşik aşıldıktan sonra **her yeni başarısızlıkta yeniden cezalandırma** mantığıyla çalışır. Yasak **yalnızca Taker'a** uygulanır — kontrattaki `notBanned` modifier'ı sadece `lockEscrow()` üzerinde durur. Yani yasaklı bir cüzdan yeni bir trade'e alıcı olarak giremez; ancak maker olarak ilan açması veya mevcut trade'lerini kapatması bu modifier nedeniyle otomatik engellenmez.

| Yasak Sayısı | Süre | Tier Etkisi | Notlar |
|---|---|---|---|
| 1. yasak | 30 gün | Tier değişimi yok | `consecutiveBans = 1` |
| 2. yasak | 60 gün | `maxAllowedTier −1` | `consecutiveBans = 2` |
| 3. yasak | 120 gün | `maxAllowedTier −1` | `consecutiveBans = 3` |
| N. yasak | 30 × 2^(N−1) gün (maks. 365) | Her yasakta `maxAllowedTier −1` (alt sınır: Tier 0) | Kalıcı on-chain hafıza |

> **Tier Tavanı Zorunluluğu:** `createEscrow()`, istenen tier > `maxAllowedTier` ise revert eder.
> Örnek: Tier 3 cüzdan 2. yasağı alır → `maxAllowedTier` 2'ye düşer. Tier 3 veya Tier 4 ilan açamaz.

### Otoritatif İtibar Notu

İtibarın bağlayıcı kaynağı kontrattaki `reputation` mapping'idir. Backend'deki `reputation_cache` ve `reputation_history` alanları yalnız aynalama / analitik amaçlıdır.

Dikkat edilmesi gereken önemli nokta: kontrat mantığında `CHALLENGED` durumundan `releaseFunds()` ile çıkılırsa `makerOpenedDispute = true` kabul edilir ve **maker başarısız uyuşmazlık** alır. Backend event mirror'ında bu akışın bazı yorum katmanları farklı işaretlenmiş olabilir; mimari otorite kontrattır.

Ayrıca `ReputationUpdated` event'i `consecutiveBans` veya `maxAllowedTier` değerlerini doğrudan taşımaz; bu alanlar kontrat storage'ında vardır ama event payload'ı sınırlıdır. Off-chain kullanıcı aynası bu alanları yalnız event'lerden türetmeye çalışırsa eksik/stale kalabilir; gerektiğinde `getReputation()` ve ilişkili state alanlarıyla mutabakat yapılmalıdır.

### İlgili Kontrat Fonksiyonları

| Fonksiyon | Açıklama |
|---|---|
| `getReputation(address)` | Sınırlı bir itibar özeti döndürür: `successful`, `failed`, `bannedUntil`, `consecutiveBans` ve `effectiveTier`. `hasTierPenalty`, `maxAllowedTier` veya `firstSuccessfulTradeAt` gibi tüm ilişkili state alanlarını tek başına taşımaz. |
| `getFirstSuccessfulTradeAt(address)` | Tier yükselişinin zaman bileşenini açıklamak için ilk başarılı işlemin zamanını döndürür. `MIN_ACTIVE_PERIOD` kuralının ne zaman dolacağını frontend ve analitik katmanı buradan görünür kılabilir. |
| `decayReputation(address)` | "Temiz Sayfa" kuralını on-chain'de uygular. Bir kullanıcının son yasağının üzerinden 180 gün geçtiyse, `consecutiveBans` sayacını sıfırlar, `hasTierPenalty` bayrağını kaldırır ve `maxAllowedTier` değerini tekrar 4'e çeker. Bu yol `onlyOwner` değildir; izinli bir admin değil, **permissionless bakım çağrısı** olarak tasarlanmıştır. Kullanıcının kendisi, backend relayer'ı veya herhangi bir üçüncü taraf uygun koşul oluştuğunda çağırabilir. |

---

## 9. Güvenlik Mimarisi

### 9.1 Kimlik Doğrulama Akışı (SIWE + JWT)

| Adım | Aktör | İşlem | Güvenlik Özelliği |
|---|---|---|---|
| 1 | Frontend | `GET /api/auth/nonce` | Nonce Redis'te 5 dakika TTL ile saklanır |
| 2 | Kullanıcı | Cüzdanda EIP-4361 SIWE mesajı imzalar | `siwe.SiweMessage` sınıfı ile standart format |
| 3 | Frontend | `POST /api/auth/verify` — mesaj + imza | Nonce atomik olarak tüketilir (`getDel` — tekrar korumalı) |
| 4 | Backend | SIWE imzasını doğrular, `type: "auth"` JWT üretir | Auth JWT yalnızca httpOnly `araf_jwt` cookie'sine yazılır; normal auth için Bearer fallback kapalıdır |
| 5 | Backend | Korumalı rotalar `requireAuth` ile cookie'den JWT okur | JWT blacklist / `jti` kontrolü her istekte çalışır |
| 6 | Backend | Gerekli rotalar `requireSessionWalletMatch` ile `x-wallet-address` başlığını doğrular | Header tek başına auth kaynağı değildir; cookie'deki wallet ile eşleşme zorunludur |
| 7 | Backend | Uyuşmazlıkta session invalidation uygulanır | Refresh token ailesi revoke edilir, `araf_jwt` ve `araf_refresh` temizlenir, `409 SESSION_WALLET_MISMATCH` döner |
| 8 | Backend | PII erişimi ayrı `type: "pii"` token ile yapılır | `requirePIIToken` yalnızca Bearer authorization kabul eder; token trade-scoped ve kısa ömürlüdür |

**Route düzeyi otorite sınırı**
- `GET /api/auth/me`, artık yalnızca "geçerli cookie var mı" kontrolü yapan pasif bir session probe değildir. Frontend `x-wallet-address` gönderirse, bu değer normalize edilip cookie içindeki `req.wallet` ile karşılaştırılır.
- Uyuşmazlık halinde backend aktif olarak session sonlandırır: `araf_jwt` ve `araf_refresh` temizlenir, refresh token ailesi revoke edilir ve `409 SESSION_WALLET_MISMATCH` döner. Böylece `/me`, wallet/session authority boundary'nin parçası olur.
- `POST /api/auth/logout`, mevcut JWT'yi blacklist'e alır, refresh token ailesini iptal eder ve cookie'leri temizler; logout sadece istemci taraflı bir UI reseti değildir.

**Profil güncelleme akışı**
- `PUT /api/auth/profile`, `requireAuth` + `requireSessionWalletMatch` + `authLimiter` ile korunur; yani hem geçerli cookie session hem de bağlı cüzdan eşleşmesi gerekir.
- Route, `bankOwner`, `iban`, `telegram` alanlarını normalize eder; Joi ile doğrular; ardından `encryptPII()` çağırarak yalnızca şifreli alanları (`pii_data.*_enc`) MongoDB'ye yazar.
- Plaintext PII kalıcı olarak saklanmaz; route katmanı yalnızca kısa ömürlü validation/normalization yüzeyi olarak çalışır.
- Frontend `App.jsx`, profil merkezini signed-session guard arkasında açar; wallet bağlı olması profile update yüzeyine erişim için yeterli sayılmaz. Bu nedenle PII update akışı, on-chain wallet registration veya basit cüzdan bağlantısından ayrı bir backend session otoritesine dayanır.

**SIWE servis otoritesi ve token politikası**
- `getSiweConfig()` production'da gevşek fallback kabul etmez: `SIWE_DOMAIN` ve `SIWE_URI` zorunludur; `SIWE_URI` mutlaka `https` olmalı ve host değeri `SIWE_DOMAIN` ile birebir eşleşmelidir. Böylece imza mesajında farklı origin/domain kullanılarak session elde edilmesi engellenir.
- `generateNonce()` Redis'i nonce için **tek otorite** kabul eder. Aynı cüzdan için eşzamanlı iki istek yarışırsa, `SET NX` başarısız olan taraf kendi yerel nonce'ını döndürmez; Redis'te gerçekten yaşayan nonce'ı tekrar okuyup onu döndürür. Bu sayede frontend'e verilen nonce ile Redis'te doğrulanacak nonce drift etmez.
- `consumeNonce()` `getDel` semantiğiyle çalışır; nonce tek kullanımlıktır ve başarılı/başarısız verify denemesi sonrası yeniden kullanılamaz.
- `verifySiweSignature()`, imzayı doğrulamadan önce domain/origin eşleşmesini ve nonce bütünlüğünü kontrol eder; sonra `SiweMessage.verify()` ile imza doğrular. Böylece önce context, sonra kriptografik doğrulama zinciri kurulmuş olur.
- `JWT_SECRET` yalnızca tanımlı olmakla yetmez; minimum uzunluk, placeholder yasakları ve Shannon entropy kontrolünden geçmelidir. Secret yeterince güçlü değilse servis başlangıçta fail eder.
- JWT blacklist kontrolü Redis erişim hatasında ortama göre fail-mode uygular: production'da varsayılan **fail-closed**, geliştirmede varsayılan **fail-open**. Bu seçim `JWT_BLACKLIST_FAIL_MODE` ile override edilebilir.
- Refresh token'lar tekil değerler halinde değil **family** mantığıyla yönetilir. Normal rotasyonda kullanılan token tek seferlik tüketilir ve aynı aile içinde yeni token üretilir; reuse / geçersiz token denemesinde ilgili wallet'ın tüm aileleri kapatılır.
- `revokeRefreshToken(wallet)` tek bir token'ı değil, o cüzdana ait tüm aktif refresh ailelerini temizler. Böylece logout, session mismatch veya güvenlik ihlali sonrası backend tarafında kalıntı refresh yolu bırakılmaz.
- Frontend `App.jsx`, backend session'ı pasif varsaymaz; sayfa yüklenince `GET /api/auth/me` çağrısını **aktif bağlı cüzdanı `x-wallet-address` başlığıyla göndererek** yapar. Session yalnız `data.wallet === connectedWallet` ise geçerli kabul edilir; aksi durumda backend'e best-effort logout gönderilir, local session state temizlenir ve kullanıcı yeniden imzaya zorlanır.
- Frontend'deki `authenticatedFetch` wrapper'ı auth kararını üç kademeli yürütür: normal istek → `409 SESSION_WALLET_MISMATCH` ise backend logout denemesi + local cleanup → `401` ise tek seferlik refresh denemesi + orijinal isteğin yeniden oynatılması. Refresh başarısızsa session canlı tutulmaya çalışılmaz; kullanıcı yeniden imzaya yönlendirilir.
- `App.jsx` içinde `hasSignedSessionForActiveWallet = isConnected && connectedWallet && isAuthenticated && authenticatedWallet === connectedWallet` türevi, kritik UI akışlarının yerel guard'ıdır. Bu ifade kontrat otoritesi değildir; ancak maker modalı, profil güncellemesi ve benzeri hassas UX yolları bu exact wallet-session eşleşmesi olmadan açılmaz.
- `handleLogoutAndDisconnect`, backend oturumunu kapatmayı dener (`/api/auth/logout`) ve ardından local session state'i temizleyip cüzdan bağlantısını keser. Böylece logout yalnız cüzdan disconnect'i değil, backend cookie session'ının da kapanması olarak modellenir.
- `loginWithSIWE`, SIWE domain ve URI değerlerini frontend'de hardcode etmez; `GET /api/auth/nonce` yanıtından `siweDomain` ve `siweUri` alır, imzayı bu değerlerle üretir ve `POST /api/auth/verify` sonrası dönen `wallet` alanını bağlı cüzdanla tekrar karşılaştırır. Verify başarılı olsa bile `verifiedWallet !== connectedWallet` ise frontend session'ı restore etmez; best-effort logout + local cleanup uygular.
- Connector runtime olayları (`accountsChanged`, `disconnect`, `chainChanged`) provider seviyesinde dinlenir. `handleWalletRuntimeEvent`, runtime cüzdanın authenticated wallet ile ayrıştığını görürse session'ı geçerli saymaya devam etmez; backend logout denemesi, local cleanup ve yeniden imza uyarısı birlikte çalışır.
- `authChecked` bayrağı, frontend'in session probe tamamlanmadan wallet/signed-session durumunu kesin kabul etmemesi için bootstrap senkronizasyon işareti olarak kullanılır. Böylece ilk render sırasında yanlış oturum varsayımıyla hassas UI göstermekten kaçınılır.


### 9.2 Müşterek İptal Akışı (EIP-712 ile Gassız Anlaşma)

Protokol, tarafların on-chain bir işlem yapmadan (ve gas ödemeden) anlaşmaya varmalarını sağlamak için **EIP-712** standardını kullanır. Bu, özellikle "Müşterek İptal" senaryosunda kritik bir rol oynar.

**EIP-712 Nedir?** Kullanıcıların cüzdanlarında anlamsız onaltılık dizeler yerine, insan tarafından okunabilir, yapılandırılmış verileri imzalamalarına olanak tanır. Bu, güvenlik ve kullanıcı deneyimi açısından büyük bir adımdır.

**Akış Adım Adım (kontrat gerçekliği):**

1.  **Teklif (Frontend):** Bir kullanıcı (örn: Maker) "İptal Teklif Et" butonuna tıklar.
2.  **Veri Yapılandırma (Frontend):** Arayüz, `CancelProposal(uint256 tradeId, address proposer, uint256 nonce, uint256 deadline)` yapısını on-chain verilerle doldurur.
    *   `tradeId`: Mevcut işlemin ID'si.
    *   `proposer`: çağrıyı yapacak cüzdanın adresi.
    *   `nonce`: `ArafEscrow.sol` kontratındaki `sigNonces(proposer)` değeridir. Bu sayaç her başarılı on-chain cancel çağrısından sonra artar.
    *   `deadline`: İmzanın geçerli olacağı son zaman damgası; kontrat ayrıca bunu **en fazla 7 gün ileriye** izin verecek şekilde sınırlar.
3.  **İmzalama (Kullanıcı Cüzdanı):** Kullanıcı, kendi hesabı için yapılandırılmış veriyi imzalar.
4.  **Koordinasyon (Backend / Frontend):** İmza ve deadline bilgisi `POST /api/trades/propose-cancel` ile off-chain saklanabilir; bu adım UX/koordinasyon katmanıdır.
5.  **İlk On-Chain Onay:** İmzalayan taraf **kendi hesabıyla** `proposeOrApproveCancel(tradeId, deadline, sig)` çağrısını yapar. Kontrat `ECDSA.recover` ile adresi kurtarır ve `recovered == msg.sender` eşleşmesini zorlar.
6.  **İkinci On-Chain Onay:** Karşı taraf da **kendi hesabıyla** aynı trade için kendi imzasını göndererek aynı fonksiyonu çağırır.
7.  **Nihai Yürütme (Kontrat):** İkinci onay geldiğinde kontrat iki boolean bayrağın (`cancelProposedByMaker`, `cancelProposedByTaker`) da `true` olduğunu görür ve `_executeCancel()` ile işlemi `CANCELED` durumuna geçirir.

**Önemli düzeltme:** Mevcut kontrat, iki imzayı backend'de toplayıp tek transaction ile üçüncü bir relayer'ın submit ettiği bir batch-cancel yolu sunmaz. Kanonik model, her tarafın kendi hesabıyla ayrı on-chain onay vermesidir. Bu nedenle backend'de tutulan imzalar tek başına iptali finalize etmez; yalnız koordinasyon ve UX kolaylığı sağlar.

Kontratın cancel doğrulama zinciri şunları zorlar:
- trade state yalnız `LOCKED`, `PAID` veya `CHALLENGED` olabilir
- `deadline` geçmemiş olmalıdır
- `deadline`, `block.timestamp + MAX_CANCEL_DEADLINE` tavanını aşamaz
- imza `msg.sender` ile birebir eşleşmelidir
- başarılı çağrıdan sonra `sigNonces[msg.sender]` artırılır ve replay engellenir

Önemli kontrat gerçeği: `sigNonces` sayaçları **cüzdan başına globaldir**. Bu nedenle backend'de saklanan bir mutual-cancel imzası, aynı cüzdanın başka bir trade için cancel imzası kullanmasıyla veya aynı trade üzerinde daha önce başarılı bir on-chain onay vermesiyle bayatlayabilir. Off-chain imza deposu otorite değildir; imzanın halen geçerli olup olmadığı son anda kontrat nonce'ı ile mutabakat edilmelidir.

### 9.3 PII Şifreleme (Zarf Şifreleme)

IBAN, banka sahibi adı, Telegram ve dekont payload'ı yalnızca backend tarafında AES-256-GCM ile şifreli tutulur. Düz metin PII kalıcı depoya yazılmaz. Master Key üretimde uygulama ayar dosyasından okunmaz; çalışma zamanında harici anahtar yöneticisinden çözülür/alınır ve kısa süreli bellekte tutulur. Her cüzdan için DEK, **aynı cüzdan için deterministik ama cüzdanlar arasında benzersiz** olacak şekilde HKDF (RFC 5869, SHA-256) ile türetilir.

| Özellik | Değer |
|---|---|
| Algoritma | AES-256-GCM (doğrulanmış şifreleme) |
| Anahtar Türetme | Node.js native `crypto.hkdf()` ile HKDF (SHA-256, RFC 5869 tam uyum) |
| Salt Politikası | Sıfır-salt değil; `wallet` bağımlı deterministik salt (`sha256("araf-pii-salt-v1:<wallet>")`) |
| DEK Kapsamı | Cüzdan başına deterministik DEK — depolanmaz, ihtiyaç anında yeniden türetilir |
| Ciphertext Formatı | `iv(12B) + authTag(16B) + ciphertext`, hex-encoded |
| Master Key Kaynağı | Development: `.env` (`KMS_PROVIDER=env`) / Production: **AWS KMS** veya **HashiCorp Vault** |
| Production Koruması | `NODE_ENV=production` iken `KMS_PROVIDER=env` bilinçli olarak engellenir |
| Master Key Cache | KMS/Vault çağrı maliyetini azaltmak için bellek içi kısa ömürlü cache; shutdown/rotation'da zero-fill ile temizlenir |
| IBAN Erişim Akışı | Auth JWT → PII token (15 dk, işlem kapsamlı) → **anlık trade statü kontrolü** → şifre çözme |

**Anahtar yönetimi ve operasyon politikası**
- `_getMasterKey()` bir sağlayıcı soyutlamasıdır: `env` yalnızca geliştirme içindir; üretimde `aws` veya `vault` beklenir.
- AWS KMS modunda uygulama, şifreli data key'i runtime'da KMS `Decrypt` ile çözer; plaintext key yalnızca proses belleğinde yaşar.
- Vault modunda uygulama, Transit / datakey uç noktasından plaintext master key alır; yine yalnızca proses belleğinde tutulur.
- Master key her encrypt/decrypt çağrısında tekrar tekrar uzaktan alınmaz; performans için cache'lenir. Ancak bu cache kalıcı değildir; restart veya `clearMasterKeyCache()` çağrısıyla silinir.
- DEK kullanım penceresi `_withDataKey()` ile daraltılır; operasyon bitince türetilen anahtar buffer'ı `fill(0)` ile sıfırlanır.
- HKDF implementasyonu önceki özel/elle yazılmış türetme mantığı yerine native `crypto.hkdf()`'e taşınmıştır. Bu, şifreleme formatı ve türetme zinciri açısından **migrasyon etkisi** doğurur; eski ciphertext'ler için yeniden şifreleme planı gerekebilir.
- Cüzdan formatı normalize edilmeden türetme veya şifre çözme yapılmaz; büyük/küçük harf varyasyonları ayrı anahtar uzaylarına dönüşmez.

**PII route otorite kuralları**
- `GET /api/pii/my`, yalnızca kullanıcının kendi `pii_data` alanını çözer; erişim `piiLimiter` ile sınırlandırılır ve loglarda tam cüzdan yerine kısaltılmış kimlik kullanılır.
- `POST /api/pii/request-token/:tradeId`, yalnızca **taker** tarafından çağrılabilir. Token yalnızca `LOCKED`, `PAID` veya `CHALLENGED` durumlarındaki trade'ler için ihraç edilir. Böylece trade daha token alınırken aktiflik açısından doğrulanır.
- `GET /api/pii/:tradeId`, yalnızca `requirePIIToken` ile yetinmez; şifre çözmeden hemen önce trade'in **hala** `LOCKED`, `PAID` veya `CHALLENGED` durumda olup olmadığını tekrar kontrol eder. Trade `CANCELED` / `RESOLVED` / başka bir sona ermiş duruma geçtiyse token süresi dolmamış olsa bile erişim reddedilir.
- Maker'ın taker adını gördüğü `GET /api/pii/taker-name/:onchainId` endpoint'i de aynı `ALLOWED_TRADE_STATES` kümesine bağlıdır; işlem sonuçlandıktan sonra taker adı gösterilmeye devam etmez.
- PII gösteriminde öncelik `pii_snapshot` alanlarındadır. Snapshot yoksa yalnızca legacy/fallback olarak `User.pii_data` çözümlenir. Böylece trade sırasında görülen ödeme kimliği sabit kalır; kullanıcı profilini sonradan değiştirse bile bait-and-switch alanı daralır.
- Hassas yanıtlar ara katmanlar tarafından cache'lenmesin diye `Cache-Control: no-store` ve `Pragma: no-cache` başlıkları eklenir.
- PII erişim logları gözlemlenebilirlik sağlar ama tam wallet / trade / plaintext alanları kaydetmez; log yüzeyi en aza indirilir.

**Frontend profile / PII orkestrasyon notları (`App.jsx`)**
- Profile modal açıkken ve ilgili sekme `ayarlar` durumundayken frontend `/api/pii/my` çağrısı yaparak mevcut PII verisini form state'ine hydrate eder. Bu, PII'nın kalıcı cache'e alınması değil; signed-session ile korunan, modal/tab bağlamlı kısa ömürlü bir doldurma akışıdır.
- `handleUpdatePII`, kontrat çağrısı yapmaz; `authenticatedFetch` ile `/api/auth/profile` rotasına gider. Bu nedenle frontend profile update yüzeyi on-chain wallet registration'dan ayrı, backend session'a bağlı off-chain bir yönetim yüzeyidir.
- Telegram handle sanitize edilerek güvenli URL'ye çevrilir; ancak bu yalnız URL hijyenidir, karşı taraf Telegram hesabının gerçekliği veya kimliği hakkında otorite üretmez.

### 9.4 Hız Sınırlama

| Endpoint Grubu | Limit | Pencere | Anahtar |
|---|---|---|---|
| PII / IBAN | 3 istek | 10 dakika | IP + Cüzdan |
| Auth (SIWE) | 10 istek | 1 dakika | IP |
| İlanlar (okuma) | 100 istek | 1 dakika | IP |
| İlanlar (yazma) | 5 istek | 1 saat | Cüzdan |
| İşlemler | 30 istek | 1 dakika | Cüzdan |
| Geri Bildirim | 3 istek | 1 saat | Cüzdan |

**Genel yüzeyler için operasyonel karar:** Listings, trades, feedback ve benzeri public/düşük riskli yüzeylerde Redis readiness kontrolü başarısızsa limiter **fail-open** davranır; enforcement geçici olarak atlanır ama çekirdek API erişilebilir kalır.

**Auth yüzeyi için özel karar:** `/nonce`, `/verify`, `/refresh` gibi kimlik doğrulama endpoint'leri Redis yokken tamamen sınırsız bırakılmaz. Bu yüzey için IP bazlı **in-memory fallback limiter** devreye girer; eşik aşılırsa doğrudan `429` döner. Böylece genel platform availability korunurken auth yüzeyi tam fail-open olmaz.

**Dağıtım notu:** Uygulama `app.set("trust proxy", 1)` ile ters proxy arkasındaki gerçek istemci IPsini esas alacak şekilde yapılandırılmıştır. Yine de deploy topolojisinin buna uygun olması gerekir; yanlış proxy zinciri tüm kullanıcıların aynı IP kovasına düşmesine veya hukukî/audit IP hashlerinin bozulmasına yol açabilir.

**İstemci crash log yüzeyi için ayrı karar:** `POST /api/logs/client-error` endpoint'i kasıtlı olarak `requireAuth` istemez; çünkü frontend ErrorBoundary kullanıcı oturum açmadan önce de tetiklenebilir. Buna rağmen yüzey fail-open bırakılmaz:
- IP bazlı sıkı rate limit uygulanır (dakikada 10 istek)
- payload boyutu sert biçimde kırpılır (`message`, `stack`, `componentStack`, `url`)
- `message` alanı zorunludur; eksik/bot test istekleri reddedilir
- endpoint `204 No Content` döner; gözlemlenebilirlik sağlarken gereksiz response yükü üretilmez

> Not: Route içindeki açıklama Redis yoksa in-memory fallback öngörse de mevcut uygulama `express-rate-limit` limiter'ını doğrudan kullanır. Mimari dokümanda bu yüzey **kimliksiz ama sıkı sınırlandırılmış crash log endpoint'i** olarak tanımlanmıştır; gerçek fallback davranışı route uygulanışına göre ayrıca izlenmelidir.

### 9.5 Çalışma Zamanı Dayanıklılık ve Bağlantı Yönetimi

#### MongoDB

- Uygulama tek process içinde API + worker/event replay yükünü aynı havuzdan taşıyabilir; bu nedenle havuz kapasitesi düşük tutulmaz.
- `serverSelectionTimeoutMS = 5000`: Ulaşılamayan Mongo örneğinde istekler uzun süre asılı kalmaz, hatalar hızlı yüzeye çıkar.
- `socketTimeoutMS = 20000`: Reverse proxy / CDN timeout sınırının altında tutulur; kopmuş istemciye rağmen arkada çalışan uzun ömürlü sorgular azaltılır.
- `disconnected` event'i bir recoverable warning gibi ele alınmaz; süreç **fail-fast** ile kapanır. Aynı process içinde paralel reconnect, bozulmuş topology veya duplicate pool riskleri yerine temiz restart tercih edilir.

#### Redis

- Redis bağlantısı runtime'da singleton client olarak yönetilir.
- `rediss://` veya `REDIS_TLS=true` ile TLS etkinleşir; managed Redis servisleriyle uyumludur.
- `REDIS_TLS_SKIP_VERIFY=true` yalnızca self-signed geliştirme ortamları içindir; production'da kullanılmamalıdır.
- `isReady()` semantiği, Redis bağlantısının yalnızca oluşturulmuş değil gerçekten servis verebilir durumda olup olmadığını ayırt etmek için kullanılır.

### 9.5.1 Hata Yönetimi ve Güvenli Loglama

- Global error handler her istekte tek bir terminal response üretir; tanınmayan hata tiplerinde bile fallback `500` cevabı döner. Bu sayede isteklerin sonsuza kadar asılı kalması engellenir.
- `req.body` içindeki bilinen hassas alanlar (`iban`, `bankOwner`, `telegram`, `password`, `token`, `refreshToken`, `signature` ve şifreli karşılıkları) loglanmadan önce `[REDACTED]` olarak scrub edilir.
- PII scrub işlemi yalnızca production'da değil tüm ortamlarda uygulanır; geliştirme logları plaintext IBAN / isim sızıntı kanalı olarak kullanılmaz.
- Mongoose validation, duplicate key, JWT ve bilinçli `statusCode` hataları ayrı response sınıflarına ayrılır; geri kalan tüm beklenmeyen hatalar standart internal error cevabına düşer.
- Log dosyaları varsayılan olarak proje kökündeki web tarafından servis edilebilir alanlara değil, backend tarafında izole `logs/` dizinine yazılır; production'da bu dizin `LOG_DIR` ile `/var/log/...` gibi sistem seviyesinde bir konuma taşınabilir.
- Winston dosya transport'u yapılandırılmıştır; loglar tek dosyada sınırsız büyütülmez, yaklaşık 25 MB x 5 dosya rotasyonu ile tutulur. Bu, hem disk taşmasını hem de tek dosyada denetim izi kaybını sınırlandırır.
- Log dizini oluşturulamazsa uygulama tümüyle çökmez; en azından console transport ile gözlemlenebilirlik sürer. Ancak bu durum production'da kalıcı log saklama garantisi vermez ve operasyon alarmı olarak ele alınmalıdır.

### 9.5.2 Health, Readiness ve Bootstrap Kontrolleri

- `getLiveness()` en hafif health probe'dur; yalnızca prosesin yaşadığını ve zaman damgasını döndürür. Orkestratörlerin “uygulama ayakta mı?” sorusu için kullanılır; bağımlılık doğrulaması yapmaz.
- `getReadiness()` ise gerçek servislenebilirliği ölçer ve **mongo / redis / worker / provider / config / replayBootstrap** alt kontrollerini ayrı ayrı raporlar.
- Mongo readiness, `mongoose.connection.readyState === 1` ile; Redis readiness ise `isReady()` ile belirlenir. Böylece sadece client nesnesinin varlığı değil, gerçekten komut kabul eden durum esas alınır.
- Worker readiness, event worker'ın çalışır olmasıyla; provider readiness ise doğrudan `provider.getBlockNumber()` çağrısının başarıyla dönmesiyle ölçülür. Salt provider objesinin bellekte bulunması yeterli sayılmaz.
- Production'da config readiness için en az şu değişkenler zorunludur: `MONGODB_URI`, `REDIS_URL`, `JWT_SECRET`, `SIWE_DOMAIN`, `SIWE_URI`, `ARAF_ESCROW_ADDRESS`, `BASE_RPC_URL`.
- Production'da `SIWE_URI` ayrıca semantik olarak da doğrulanır: `https` olmak zorundadır ve host değeri `SIWE_DOMAIN` ile birebir eşleşmelidir. Yanlış ama “tanımlı” config hazır sayılmaz.
- Replay bootstrap readiness, worker'ın ilk nereden başlayacağını gerçekten bilip bilmediğini doğrular. Production ortamında ya Redis checkpoint (`worker:last_safe_block` / `worker:last_block`) bulunmalı ya da `ARAF_DEPLOYMENT_BLOCK` / `WORKER_START_BLOCK` tanımlı olmalıdır.
- Bu koşul sağlanmazsa servis “yarı canlı” kabul edilmez; çünkü event aynalama katmanı güvenli başlangıç bloğunu bilmeden on-chain geçmişi eksik okuyabilir.
- `BASE_WS_RPC_URL` readiness için zorunlu değildir ama `wsRecommended` sinyali olarak raporlanır; websocket provider gözlem/latency avantajı sunar ancak HTTP provider yokluğunu telafi etmez.
- Readiness ve liveness HTTP uçları uygulamada ayrı route'lar olarak sunulur: `/health` her zaman hafif probe, `/ready` ise ayrıntılı readiness JSON cevabı verir ve başarısızlıkta `503` döner.

### 9.5.3 Uygulama Bootstrap, Middleware Zinciri ve Shutdown Orkestrasyonu

- **Bootstrap sırası bilinçli olarak katıdır:** uygulama önce `.env` yükler, ardından MongoDB ve Redis bağlantılarını kurar, sonra on-chain protocol config'i yükler, event worker'ı başlatır, zamanlanmış görevleri takvime koyar ve en son HTTP route'larını mount eder. Böylece yarım-başlamış API yüzeyleri azaltılır.
- **Fail-fast startup doğrulamaları:** Production'da `SIWE_DOMAIN=localhost`, boş/`*` CORS origin'leri veya şema (`http://` / `https://`) içermeyen origin kayıtları kabul edilmez; uygulama bilinçli olarak başlamaz. Amaç, “çalışıyor görünen ama güvenlik sınırı yanlış” dağıtımları erkenden durdurmaktır.
- **Temel middleware zinciri:** `helmet`, `cors(credentials=true)`, sınırlı `express.json(50kb)`, `cookieParser` ve `express-mongo-sanitize` birlikte çalışır. Böylece CSP/HSTS, origin kontrolü, küçük JSON yüzeyi, cookie-only auth ve Mongo operatörü enjeksiyon temizliği aynı çekirdek Express hattında uygulanır.
- **Log route'unun üstte konumlanması:** `/api/logs` rotası diğer iş rotalarından önce yüklenir; frontend crash gözlemlenebilirliği auth başlamadan da çalışır. Buna rağmen auth gerektirmeyen tek rota olduğu için kendi rate-limit ve payload sınırlarıyla korunur.
- **Staggered scheduler başlatma:** Periyodik görevler cold-start anında aynı anda ateşlenmez. DLQ monitörü düzenli aralıkta çalışırken reputation decay, stats snapshot, pending cleanup ve sensitive-data cleanup görevleri farklı gecikmelerle başlatılır. Amaç ilk dakika içinde DB/RPC/Redis üstüne yığılmayı azaltmaktır.
- **Runtime scheduler sahipliği:** Uygulama süreç içinde oluşturduğu `setTimeout` / `setInterval` tanımlarını tutar ve shutdown sırasında temizler. Böylece kapanışta “eski timer'ların yeni süreçle yarışması” veya uzun kapanış beklemeleri azaltılır.
- **Graceful vs fatal shutdown ayrımı:** `SIGTERM` ve `SIGINT` için orderly kapanış, `uncaughtException` ve `unhandledRejection` için ise restart beklenen fatal kapanış akışı uygulanır. Her iki yol da ortak orchestrator fonksiyonundan geçer; davranış dalları log seviyesinde ayrılır.
- **Shutdown sırası:** Yeni HTTP istekleri durdurulur (`server.close()`), worker kapatılır, Mongo bağlantısı kapanır, Redis `quit()` ile bırakılır, master key cache sıfırlanır ve zamanlayıcılar temizlenir. Bu sıra, yeni iş kabulünü önce durdurup arka plan görevlerini sonra boşaltacak şekilde seçilmiştir.
- **Force-exit emniyet supabı:** Shutdown makul süre içinde tamamlanmazsa process belirli bir timeout sonunda zorla sonlandırılır. Amaç, orkestratörün asılı kalan süreç yüzünden yeni instance başlatamaması riskini azaltmaktır.
- **Master key hijyeni:** Şifreleme katmanının bellek içi master key cache'i shutdown başında temizlenir; böylece restart/fatal crash çevrimlerinde hassas materyalin RAM'de gereksiz uzaması azaltılır.

### 9.5.4 App.jsx Okuma, Polling ve Senkronizasyon Sınırları

- Frontend'in tüm canlı veriyi tek kaynaktan çektiği varsayımı doğru değildir. `App.jsx` içinde fee, decimals, bleeding, reputation, anti-sybil ve pause gibi kural/economic yüzeyler doğrudan kontrattan okunurken; protocol stats ve aktif trade listesi gibi operasyonel yüzeyler backend mirror'dan gelir.
- Bu hibrit okuma modeli bilinçlidir: kontrat-read katmanı ekonomik doğruluk ve runtime kural görünürlüğü sağlar; backend-read katmanı hızlı listeleme, trade room bootstrap ve aggregation kolaylığı sağlar.
- Polling, yalnız UX cilası değil çalışma modelidir. Challenge/bleeding akışlarında, active trade görünümünde ve pause/sybil tarafında App periyodik re-sync yapar; dolayısıyla frontend anlık snapshot değil, tekrar tekrar tazelenen bir senkronizasyon katmanı olarak çalışır.
- `onVisibilityChange` ile sekme tekrar görünür olduğunda kritik yüzeylerin yeniden okunması, stale UI riskini azaltır; ancak bu davranış kontrat enforcement yerine geçmez. App kullanıcıya daha güncel görünüm sunar, nihai durum yine kontrat ve backend guard'larında belirlenir.
- `App` kök bileşeni, bu okuma/polling davranışlarını yalnız dağınık effect'ler olarak değil; pending-tx recovery, active trade auto-resume ve runtime wallet listener'larıyla birlikte çalışan bir **frontend orchestration runtime** olarak taşır. Bu nedenle okuma katmanı ve navigasyon/işlem katmanı aynı root state makinesinde birleşir.
- `getTakerFeeBps`, `getTokenDecimals` ve benzeri read helper'larda kullanılan fallback değerler (`10`, `6`, `0`) operasyonel güvenli varsayımlar olsa da gerçek read hatalarını maskeleyebilir; bu nedenle UI'da görülen değer her zaman taze kontrat okuması sanılmamalıdır.

### 9.6 Olay Dinleyici Güvenilirliği

- **Durum Makinesi:** Worker iç durumunu `booting -> connected -> replaying -> live -> reconnecting -> stopped` çizgisinde izler; bu sayede sağlık sinyalleri ve loglar yalnız “çalışıyor/çalışmıyor” seviyesinde kalmaz.
- **Replay Başlangıcı:** Worker, başlangıç bloğunu önce Redis checkpoint'inden (`worker:last_safe_block`, yoksa `worker:last_block`) çözer. Checkpoint yoksa yalnız tanımlı `ARAF_DEPLOYMENT_BLOCK` / `WORKER_START_BLOCK` üzerinden başlar; production'da bunlardan hiçbiri yoksa başlatılmaz.
- **Safe Checkpoint Semantiği:** Checkpoint körlemesine “son görülen blok”a ilerletilmez. Canlı akışta her blok için `seen / acked / unsafe` durumu tutulur; yalnız tüm event'leri başarıyla ack'lenmiş ve unsafe işaretlenmemiş bloklar güvenli checkpoint'e alınır.
- **Replay Batch Disiplini:** Replay sırasında batch içindeki tek bir event bile başarısız olursa ilgili blok aralığı için safe checkpoint ilerletilmez. Böylece “işlenmemiş ama checkpoint geçmiş” sessiz veri kaybı önlenir.
- **Yeniden Deneme:** Başarısız olaylar önce worker tarafında sınırlı deneme ile yeniden işlenir; kalıcı başarısızlıklar Redis DLQ'ya alınır.
- **Ölü Mektup Kuyruğu (DLQ):** DLQ girdileri Redis listesinde (`worker:dlq`) tutulur; event adı, `txHash`, `logIndex`, idempotency anahtarı, block numarası, serialized argümanlar, deneme sayısı ve `next_retry_at` alanlarını taşır.
- **Re-drive Worker:** Ayrı bir processor DLQ'yu batch halinde tarar, zamanı gelmiş girdileri `eventListener.reDriveEvent()` ile yeniden sürer; başarılı girdileri kuyruktan siler. Re-drive başarısızsa ilgili blok unsafe işaretlenir.
- **Exponential Backoff:** Başarısız re-drive denemeleri `attempt` sayısına göre artan bekleme süresiyle kuyruğun sonuna yazılır; üst sınır 30 dakikadır.
- **Poison Event Politikası:** Yüksek deneme sayısına rağmen düzelmeyen girdiler poison event olarak metriklenir; otomatik silinmez, manuel inceleme için görünür kalır.
- **DLQ Arşivleme / Kırpma:** Kuyruk boyu güvenli eşiği aşarsa eski girdiler 7 günlük arşive taşınır ve ana DLQ kontrollü şekilde kırpılır.
- **Alarm / Soğuma Süresi:** DLQ derinliği kritik eşiği aştığında sürekli spam üretmemek için cooldown'lu alarm logu atılır.
- **Reconnect Hijyeni:** Provider hatasında reconnect öncesi eski listener'lar ve varsa WebSocket provider `destroy()` ile temizlenir; zombi socket / duplicate listener birikimine izin verilmez.
- **Authoritative Linkage Doktrini:** `EscrowCreated` yalnız kanonik `listing_ref` üzerinden eşleştirilir. Zero veya eksik `listingRef` recoverable gecikme değil, kritik kontrat/API bütünlük ihlalidir; event DLQ'ya kritik hata olarak gönderilir. Heuristik backfill yapılmaz.
- **Authoritative Eşleşme Kontrolleri:** `listing_ref` bulunduğunda dahi maker, tier ve token adresi on-chain event ile birebir doğrulanır. Uyuşmazlık varsa event kabul edilmez ve DLQ'ya alınır.
- **Atomik Bağlama:** `Listing.onchain_escrow_id` alanı yalnız atomik update ile bağlanır; aynı ilanı iki farklı escrow'a sessizce bağlayan yarışlara izin verilmez.
- **Atomik Sonlandırma:** `EscrowReleased` ve `EscrowBurned` akışları Mongo transaction ile yürür; trade statüsü, retention tarihleri ve reputation side-effect'leri tek atomik işlem içinde tutulur.
- **İdempotent Decay Aynalama:** `BleedingDecayed` event'leri `txHash:logIndex` anahtarıyla aynalanır; aynı decay event'i tekrar gelse bile `total_decayed` ikinci kez büyütülmez.
- **Sıra Tahmini Yapmama İlkesi:** `MakerPinged` işlendiğinde `taker_address` henüz DB'de yoksa worker zincirden tahmin üretmez; event DLQ'ya alınır ve doğru sıralama beklenir.
- **Büyük Sayı Aynası:** On-chain finansal miktarlar (`crypto_amount`, `total_decayed`) Mongo'da string olarak tutulur; Number alanları yalnız approx analytics/UI amaçlı cache'tir.
- **Mongo ölçekleme notu:** Event replay ile eşzamanlı canlı API trafiği Mongo üzerinde ani paralellik yaratabileceğinden, olay aynalama katmanı düşük pool varsayımıyla tasarlanmamıştır.
- **Temiz yeniden başlatma ilkesi:** DB bağlantısı koptuğunda worker ve API aynı process'te kirli reconnect yapmak yerine container/process supervisor tarafından temiz biçimde yeniden başlatılır.
### 9.7 Zamanlanmış Görevler ve Veri Yaşam Döngüsü

Backend, uygulama mantığının bir bölümünü periyodik job'lar ile yürütür. Bu görevler **yetkili durum kaynağını değiştirmez**; on-chain gerçekliği tamamlayan retention, bakım ve analytics işlevleri sağlar.

#### Pending Listing Cleanup

- `PENDING` durumda kalmış ve hiçbir zaman on-chain `tradeId` / `onchain_escrow_id` almamış ilanlar geçici kabul edilir.
- `created_at` üzerinden **12 saat** geçen ve hala on-chain'e düşmemiş kayıtlar `DELETED` durumuna çekilir.
- Amaç, başarısız oluşturma akışlarından kalan yarım ilanları orderbook'tan temizlemektir.

#### Sensitive Data Cleanup

- Dekont payload'ı (`evidence.receipt_encrypted`, `evidence.receipt_timestamp`) kendi `receipt_delete_at` zamanına ulaştığında null'lanır.
- Snapshot PII alanları (`pii_snapshot.*`) kendi `snapshot_delete_at` zamanına ulaştığında null'lanır.
- Bu temizlik işi hard delete yerine **alan bazlı scrub** uygular; işlem kaydı, denetim izi ve finansal tarihçe korunur.
- Uygulama bu retention cleanup işlerini runtime scheduler ile yaklaşık her 30 dakikada bir çalıştırır; ilk tetikleme cold-start yükünü azaltmak için gecikmeli başlatılır.

#### On-Chain Reputation Decay Job

- `decayReputation(address)` fonksiyonu kullanıcılar adına backend job'ı tarafından periyodik olarak tetiklenebilir.
- Aday seçiminde Mongo yalnızca **geniş aday havuzu** sağlar; nihai uygunluk `reputation(address)` on-chain okumasına göre belirlenir.
- Bu yaklaşım, `banned_until` veya `consecutive_bans` gibi DB aynalarının stale kalması halinde yanlış decay uygulanmasını engeller.
- Job, relayer signer ile yalnızca kontratın izin verdiği `decayReputation()` çağrısını yapar; itibarı off-chain değiştiremez.

#### Daily Stats Snapshot

- Güncel protokol istatistikleri Mongo aggregation ile DB seviyesinde hesaplanır.
- Sonuçlar `historical_stats` koleksiyonunda **gün bazlı idempotent upsert** ile saklanır.
- Aynı gün içinde job tekrar çalışsa bile mevcut gün kaydı güncellenir; duplicate günlük snapshot oluşmaz.
- `GET /api/stats`, bu günlük snapshot koleksiyonunu okur; en güncel kaydı ve mümkünse tam **30 gün önceki** kaydı karşılaştırır.
- Sonuçlar Redis içinde `cache:protocol_stats` anahtarında **1 saat** önbelleklenir; cache hit olduğunda hesaplama tekrarlanmaz.
- Yüzde değişim hesabı yalnızca anlamlı bir önceki değer varsa yapılır. `previous = 0/null/undefined` ise değişim alanı `null` döner; böylece `0→1` ile `0→1.000.000` aynı hatalı `%100` çıktısına indirgenmez ve UI `Yeni` / `—` gibi güvenli gösterimler yapabilir.


### 9.8 Şifreli Dekont Depolama ve Unutulma Hakkı (TTL)

Taker dekont yüklediğinde public IPFS'e atmak yerine, backend üzerinde AES-256-GCM ile şifrelenir ve veritabanına/geçici storage'a kaydedilir. Dosyanın SHA-256 hash'i frontend'e dönülür ve akıllı kontrata kaydedilir. İşlem `RESOLVED` veya `CANCELED` statüsüne geçtiğinde dekont verisi maksimum 24 saat içinde silinir. `CHALLENGED` veya `BURNED` işlemlerde ise süreci takip eden 30 gün sonra kalıcı olarak silinir.

**Dekont yükleme hattının güvenlik özellikleri**
- `POST /api/receipts/upload`, `requireAuth` + `requireSessionWalletMatch` + `tradesLimiter` ile korunur; yalnızca aktif taker kendi trade'i için yükleme yapabilir.
- Upload hattı `multer.memoryStorage()` kullanmaz; dosya önce geçici diske yazılır, sonra stream tabanlı olarak base64 okunup şifrelenir. Böylece büyük eşzamanlı yüklemelerde proses belleği sabit kalır ve OOM/heap baskısı azaltılır.
- Kabul edilen MIME tipleri `jpeg/png/webp/gif/pdf` ile sınırlıdır; ancak karar yalnızca istemcinin `mimetype` beyanına bırakılmaz. İlk baytlar (`magic bytes`) ayrıca doğrulanır; içerik-imza uyuşmazlığında istek `415` ile reddedilir.
- Trade güncellemesi **tek atomik `findOneAndUpdate`** ile yapılır. Filtrede eşzamanlı olarak `taker_address`, `status: "LOCKED"` ve `evidence.receipt_encrypted: null` koşulları aranır. Böylece hem TOCTOU penceresi kapanır hem de daha önce yüklenmiş kanıtın üzerine yazılamaz.
- Yükleme başarılı olduğunda saklanan hash, plaintext dosyanın değil **şifreli payload'ın SHA-256** özetidir; kontrata giden kanıt backend'de tutulan encrypted blob ile bağlanır.
- Route, hangi nedenle reddedildiğini ayrıştırır: trade yoksa `404`, yanlış tarafsa `403`, zaten dekont varsa `409`, trade aktif değilse `400`. Bu sayede kullanıcı davranışı ile güvenlik ihlali ayrılır, denetim logları daha anlamlı olur.
- Geçici dosya silme işlemi `finally` bloğunda zorunlu çalışır; cleanup başarısız olsa bile iş akışı düşmez, yalnızca warning log bırakılır.

### 9.9 Triangulation Fraud (Üçgen Dolandırıcılık) Koruması

Üçgen dolandırıcılığı önlemek için; işlem `LOCKED` durumuna geçtiğinde, Maker'ın (Satıcı) Trade Room ekranında, Backend'den şifresi çözülerek gelen Taker'ın (Alıcı) "İsim Soyisim" bilgisi gösterilir. Maker'a, gelen paranın gönderici ismi ile bu ismin kesinlikle eşleştiğini teyit etmesi için uyarı yapılır. Eşleşmeme durumunda işlem iptaline (Cancel) yönlendirilir.

### 9.10 On-Chain Güvenlik Fonksiyonları

| Fonksiyon | Açıklama |
|---|---|
| `pause()` / `unpause()` | Sadece kontrat sahibinin (`Owner`) çağırabildiği, acil bir durumda yeni `createEscrow()` ve `lockEscrow()` girişlerini durduran fonksiyonlardır. Mevcut trade kapanış yolları açık kalır. |
| `domainSeparator()` | EIP-712 imzaları için gereken ve kontrata özgü olan domain ayıracını döndürür. Frontend tarafından imza oluşturulurken kullanılır; imza akışının doğru kontrata bağlandığını doğrulamak için görünür bir helper'dır. |
| `nonReentrant` (Modifier) | Bir fonksiyonun yürütülmesi sırasında aynı fonksiyonun tekrar çağrılmasını engelleyerek "re-entrancy" saldırılarını önler. |

### 9.11 Owner Governance ve Yönetim Yetkileri

Aşağıdaki yüzey kontrat sahibine aittir ve protokolün operasyonel merkeziyet noktalarını oluşturur. Bunlar backend route'ları değil, doğrudan on-chain yönetim yetkileridir. Güven modeli yalnız "kod değişmez" varsayımına değil, aynı zamanda owner anahtarının güvenliğine de bağlıdır.

| Yetki | Kontrat Fonksiyonu | Etki |
|---|---|---|
| Hazine yönlendirmesi | `setTreasury(address)` | Protokol ücretlerinin ve decay/burn gelirlerinin hangi adrese aktığını değiştirir. |
| Desteklenen token seti | `setSupportedToken(address, bool)` | Yeni create/lock yüzeyinin hangi ERC20'ler için açık olduğunu belirler. |
| Acil durum freni | `pause()` / `unpause()` | Yeni create/lock akışlarını durdurur veya yeniden açar. |

---


### 9.11.1 Güvenli Deploy ve Ownership Devri

`contracts/scripts/deploy.js`, owner yetkisinin yalnız deploy anındaki teknik sahiplik olmadığını; güvenli kurulum tamamlanmadan son yetki devrinin yapılmaması gerektiğini tanımlar.

**Deploy güvenlik ilkeleri**
- Production ortamında gerçek token adresleri (`MAINNET_USDT_ADDRESS`, `MAINNET_USDC_ADDRESS`) `.env` üzerinden zorunlu alınır; eksik veya zero-address ise script hard fail olur.
- `ArafEscrow` deploy edildikten sonra desteklenen tokenlar owner yetkisiyle etkinleştirilir, ancak süreç burada bitmez.
- Her token için `setSupportedToken(token, true)` çağrısından sonra `supportedTokens(token)` değeri zincir üstünde yeniden okunur ve doğrulanır.
- Bu doğrulama tamamlanmadan `transferOwnership(treasury)` çalıştırılmaz.
- Dolayısıyla deploy completion koşulu yalnız kontratın zincire yazılması değil, **desteklenen token setinin zincir üstünde doğrulanmış olması ve ancak bundan sonra ownership devrinin tamamlanmasıdır.**

**Mimari not**
- ABI kopyalama, frontend `.env` auto-write ve benzeri kolaylaştırıcı adımlar geliştirici ergonomisi içindir; protokol güven modelinin parçası değildir.
- Buna karşılık token support doğrulaması ve ownership devri sırası güven modelinin parçasıdır.

## 10. Veri Modelleri (MongoDB)

Bu bölüm, backend model katmanının gerçek veri sözleşmesini özetler. Kritik ilke korunur: **on-chain alanlar otoritatif gerçekliği temsil eder; off-chain alanlar indeksleme, UX, retention ve analitik için tutulur.** Özellikle `reputation_cache`, `banned_until`, `consecutive_bans`, `max_allowed_tier`, `crypto_amount_num` ve `total_decayed_num` gibi alanlar hız ve görüntüleme amaçlı aynalardır; yetkilendirme veya ekonomik enforcement için tek başına kullanılmaz. Bu alanlardan türetilen backend yorumları, kontrat storage'ı veya fonksiyon davranışıyla çatıştığında hata backend'dedir; mimari hüküm kontrat tarafındadır.

### 10.1 Kullanıcılar Koleksiyonu

| Alan | Tür | Açıklama |
|---|---|---|
| `wallet_address` | Dize (benzersiz) | Küçük harfli Ethereum adresi — birincil kimlik |
| `pii_data.bankOwner_enc` | Dize | AES-256-GCM şifreli banka sahibi adı |
| `pii_data.iban_enc` | Dize | AES-256-GCM şifreli IBAN (TR formatı) |
| `pii_data.telegram_enc` | Dize | AES-256-GCM şifreli Telegram kullanıcı adı |
| `reputation_cache.total_trades` | Sayı | Başarılı tamamlanan toplam işlem sayısı |
| `reputation_cache.failed_disputes` | Sayı | Başarısızlıkla sonuçlanan toplam uyuşmazlık sayısı |
| `reputation_cache.success_rate` | Sayı | UI için hesaplanan başarı oranı |
| `reputation_cache.failure_score` | Sayı | Ağırlıklı başarısızlık puanı |
| `reputation_history` | Dizi | Zamanla etkisi düşen başarısızlık geçmişi |
| `is_banned` / `banned_until` | Boolean / Tarih | On-chain yasak durumu aynası |
| `consecutive_bans` | Sayı | On-chain ardışık yasak sayısı aynası |
| `max_allowed_tier` | Sayı | Ceza kaynaklı tier tavanı aynası |
| `last_login` | Tarih | TTL: 2 yıl hareketsizlik sonrası otomatik silme (GDPR) |

**Model davranışları**
- `toPublicProfile()` **allowlist/fail-safe** yaklaşımıyla çalışır; yalnızca açıkça seçilmiş public alanlar döner. Böylece modele ileride yeni alan eklense bile istemeden PII veya iç durum sızdırılmaz.
- `checkBanExpiry()` artık yalnızca bellekte flag düşürmez; ban süresi geçmişse veritabanına `save()` ile kalıcı yazar. Böylece kullanıcı bir istekte banlı görünmeyip sonraki sayfa yenilemede tekrar banlı görünme hatası oluşmaz.
- `reputation_cache` ve ban alanları hızlı UI render ve indeksleme içindir; nihai otorite gerektiğinde on-chain veridir.

**İndeks / retention**
- `wallet_address` benzersiz ve indekslidir.
- `is_banned` alanı ban taramaları için indekslidir.
- `last_login` üzerinde 2 yıllık TTL vardır; uzun süre inaktif kullanıcı verisi otomatik temizlenir.

**Frontend profile merkezi notları (`App.jsx`)**
- Profile modal içindeki `ayarlar` sekmesi açıldığında frontend, signed-session varlığını koruyarak `/api/pii/my` sonucu ile `piiBankOwner`, `piiIban` ve `piiTelegram` form state'lerini doldurur.
- Aynı merkez içinde `handleRegisterWallet()` ise ayrı bir on-chain write akışıdır; bu nedenle App düzeyinde “profil” yüzeyi hem off-chain PII yönetimini hem de on-chain wallet registration eylemini aynı kullanıcı merkezinde birleştirir.

### 10.2 İlanlar Koleksiyonu (`Listing`)

| Alan | Tür | Açıklama |
|---|---|---|
| `maker_address` | Dize | İlan oluşturucunun adresi |
| `crypto_asset` | `USDT` \| `USDC` | Satılan varlık |
| `fiat_currency` | `TRY` \| `USD` \| `EUR` | İstenen fiat para birimi |
| `exchange_rate` | Sayı | 1 kripto birimi başına oran |
| `limits.min` / `limits.max` | Sayı | İşlem başına fiat tutar aralığı |
| `tier_rules.required_tier` | 0 – 4 | Bu ilanı almak için gereken minimum tier |
| `tier_rules.maker_bond_pct` | Sayı | Maker teminat yüzdesi |
| `tier_rules.taker_bond_pct` | Sayı | Taker teminat yüzdesi |
| `status` | `PENDING` \| `OPEN` \| `PAUSED` \| `COMPLETED` \| `DELETED` | `PENDING` = henüz on-chain'e yazılmamış geçici ilan |
| `onchain_escrow_id` | Sayı \| null | Escrow oluştuğunda on-chain `tradeId` |
| `listing_ref` | Dize \| null | 64-byte hex referans; sparse+unique |
| `token_address` | Dize | Base'deki ERC-20 sözleşme adresi |

**Model davranışları**
- `pre("save")` kuralı ile `limits.max > limits.min` zorunlu tutulur; bozuk ilan verisi model seviyesinde reddedilir.
- `PENDING` durumu kalıcı iş durumu değil, **frontend/backend–on-chain senkronizasyon penceresi** olarak kabul edilir.
- `onchain_escrow_id = null` ve uzun süredir `PENDING` kalan kayıtlar, cleanup job tarafından yetim ilan olarak `DELETED` durumuna süpürülür.

**İndeks stratejisi**
- `status + fiat_currency + limits.min + limits.max` birleşik indeksi filtreli pazar yeri sorgularını hızlandırır.
- `maker_address + status` ve `tier_rules.required_tier + status` indeksleri hem kullanıcı panosu hem de eşleşme taramaları için kullanılır.
- `listing_ref` sparse/unique indekslidir; referans çakışmasını önler.

**Route davranışları**
- `GET /api/listings/config`, frontend'in teminat oranlarını hardcode etmeden okuması için `bondMap` döner; config erişilemezse `503` verir.
- `GET /api/listings`, yalnızca `OPEN` ilanları listeler; filtreler `fiat`, `amount`, `tier`, `page`, `limit` üstünden uygulanır.
- Sayfalama **deterministik** olacak şekilde `sort({ exchange_rate: 1, _id: 1 })` kullanılır; eşit kurda kayıtların sayfalar arasında kaybolması veya tekrar görünmesi engellenir.
- `POST /api/listings`, `requireAuth` + `requireSessionWalletMatch` + `listingsWriteLimiter` arkasındadır.
- Listing oluşturma akışında backend, kullanıcının on-chain `effectiveTier` değerini RPC üzerinden doğrular. Bu doğrulama başarısız olursa güvenli varsayılan olarak Tier 0 dayatılmaz; istek `503` ile reddedilir. Mimari karar: **doğrulanamıyorsa işlem yapma**.
- Yeni ilanlar `OPEN` değil önce `PENDING` oluşturulur. `listing_ref = keccak256("listing:<mongoId>")` türetilir; nihai açılma (`OPEN`) event listener'ın on-chain `EscrowCreated` gözlemiyle yapılır. Bu, chain-first listeleme felsefesidir.
- `DELETE /api/listings/:id`, yalnızca maker tarafından çağrılabilir. `DELETED` tekrar silinemez; ilişkili aktif trade varsa silme reddedilir. Böylece on-chain/off-chain durum ayrışması ve aktif oda varken vitrin silinmesi engellenir.

**Frontend orchestration notları (`App.jsx`)**
- `fetchListings()` market verisini public endpoint'ten hydrate ederken `successRate: 100` ve `txCount: 0` gibi placeholder alanlar üretir; bu alanlar otoritatif reputation/analytics verisi değildir, yalnız kart UI'ını besleyen geçici gösterim değerleridir.
- `handleCreateEscrow()` başarısız olduğunda frontend hazırlanmış listing kaydını silmeyi ve gerekiyorsa artırılmış allowance'ı `approve(0)` ile geri almayı dener; bu **best-effort cleanup**'tır, atomik garanti değildir.
- `handleStartTrade()` on-chain `lockEscrow()` sonrası backend `tradeId` kaydını birkaç denemeyle arar; kayıt henüz yoksa `_pendingBackendSync` ile geçici trade room durumuna geçer. Bu, on-chain başarı ile backend mirror oluşumu arasında kısa süreli tutarsızlık penceresi olabileceği anlamına gelir.

### 10.3 İşlemler Koleksiyonu (`Trade`)

| Alan Grubu | Temel Alanlar | Notlar |
|---|---|---|
| Kimlik | `onchain_escrow_id`, `listing_id`, `maker_address`, `taker_address` | `onchain_escrow_id` = gerçeğin kaynağı |
| Finansal | `crypto_amount` (String, authoritative), `crypto_amount_num` (Number, cache), `fiat_amount`, `exchange_rate`, `crypto_asset`, `fiat_currency`, `total_decayed` (String), `total_decayed_num` (Number, cache), `decay_tx_hashes`, `decayed_amounts` | `*_num` alanları analytics/UI içindir; enforcement için kullanılmaz |
| Durum | `status` | `OPEN`, `LOCKED`, `PAID`, `CHALLENGED`, `RESOLVED`, `CANCELED`, `BURNED` |
| Zamanlayıcılar | `locked_at`, `paid_at`, `challenged_at`, `resolved_at`, `last_decay_at`, `pinged_at`, `challenge_pinged_at` | Uyuşmazlık ve decay zaman çizelgesini yansıtır |
| Kanıt | `evidence.ipfs_receipt_hash`, `evidence.receipt_encrypted`, `evidence.receipt_timestamp`, `evidence.receipt_delete_at` | Hash on-chain referansıdır; payload public IPFS'te değil backend'de şifreli tutulur |
| PII Snapshot | `pii_snapshot.*`, `pii_snapshot.captured_at`, `pii_snapshot.snapshot_delete_at` | LOCKED anında karşı taraf verisinin sabitlenmiş görünümü |
| İptal Önerisi | `cancel_proposal.*` | Karşılıklı iptal için toplanan imzalar ve deadline |
| Chargeback Onayı | `chargeback_ack.*` | `releaseFunds` öncesi Maker'ın yasal beyan izi |
| Tier | `tier` (0–4) | İşlem açıldığı andaki tier |

**Model davranışları**
- Finansal doğruluk için `crypto_amount` ve `total_decayed` **String** tutulur; bu alanlar BigInt-safe otoritatif değerlerdir.
- `crypto_amount_num` ve `total_decayed_num` yalnızca dashboard/aggregation kolaylığı için bulunan yaklaşık cache alanlarıdır.
- Dekont verisi gerçek IPFS yüklemesi değildir; tarihsel isim korunmuş olsa da backend tarafında AES-256-GCM ile şifreli tutulur.
- `pii_snapshot`, LOCKED anındaki karşı taraf bilgilerini dondurarak bait-and-switch riskini azaltır.
- Virtual alanlar:
  - `isInGracePeriod`
  - `isInBleedingPhase`
  Bu alanlar sorgu değil, runtime hesaplaması için tasarlanmıştır.

**Route ve erişim davranışları**
- `GET /api/trades/my`, yalnızca çağıranın taraf olduğu ve henüz kapanmamış (`RESOLVED/CANCELED/BURNED` dışı) trade kayıtlarını döndürür. Bu endpoint trade room listesini besler.
- `GET /api/trades/history`, aynı güvenlik sınırı içinde yalnızca kapanmış trade kayıtlarını sayfalı sunar. Böylece aktif oda görünümü ile arşiv görünümü ayrışır.
- `GET /api/trades/:id` ve `GET /api/trades/by-escrow/:onchainId`, yalnızca maker veya taker olan taraflara cevap verir.
- Tüm trade okuma endpoint'leri tam belgeyi değil, `SAFE_TRADE_PROJECTION` ile daraltılmış alan kümesini döndürür; şifreli PII, ham imzalar ve gereksiz iç alanlar dışarı verilmez.
- `POST /api/trades/propose-cancel`, `requireAuth + requireSessionWalletMatch + tradesLimiter` arkasındadır. İlk teklif `cancel_proposal.deadline` alanını sabitler; ikinci tarafın getirdiği deadline bununla uyuşmuyorsa istek reddedilir. Böylece EIP-712 cancel akışında deadline ezme/deadlock saldırısı kapanır.
- `proposed_by` yalnızca ilk teklif veren için set edilir; karşı taraf onayı `approved_by` alanında ayrı tutulur. Bu, audit trail'in yönünü korur.
- `POST /api/trades/:id/chargeback-ack`, on-chain veto kapısı değil yalnızca audit/log kaydıdır. Kayıt atomik `findOneAndUpdate` ile bir kez yazılır; aynı anda gelen ikinci istek `acknowledged: true` filtresi nedeniyle yeni kayıt oluşturamaz.
- `chargeback_ack.ip_hash`, doğrudan saklanan çıplak IP değildir; `X-Forwarded-For` / `req.ip` üzerinden türetilen istemci IP'sinin SHA-256 özetidir. Böylece hukuki denetim izi korunurken ham IP yayılımı azaltılır.


**Frontend trade-room orchestration notları (`App.jsx`)**
- Dekont upload akışı ile on-chain ödeme bildirimi birbirinden ayrıdır. Frontend önce `/api/receipts/upload` ile şifreli payload hash'ini alır, sonra aynı hash ile `reportPayment()` çağrısını açar. Bu nedenle `paymentIpfsHash` UI'da bir “hazır ödeme kanıtı” state'i olarak yaşar; tek başına on-chain doğrulama anlamına gelmez.
- Karşılıklı iptal UI'sı önce backend coordination rotasına yaslanır; relay tarafı iki imzanın tamamlandığını bildirirse frontend son on-chain `proposeOrApproveCancel()` çağrısını gönderir. Bu, cancel akışının App içinde hem off-chain koordinasyon hem de on-chain state geçişi içerdiği anlamına gelir.
- `handleRelease()` öncesi chargeback checkbox'ı yalnız istemci state'idir; asıl audit kaydı backend route'una best-effort olarak yazılır. Bu kayıt başarısız olsa bile release akışı kullanıcı tarafında tamamen bloke edilmez.
- `handleChallenge()` ve `handleAutoRelease()` sonrası frontend yalnız local state değiştirmekle yetinmez; `fetchMyTrades()` veya görünüm reset'i ile trade room bağlamını hızlıca yeniden kurar. Böylece 15 saniyelik polling penceresi tek senkronizasyon mekanizması olmaz.
- Profile merkezindeki history sekmesi, `tradeHistoryPage`, `tradeHistoryTotal` ve `tradeHistoryLimit` ile sayfalı kullanıcı görünümü sunar; bu yüzey tam denetim izi değil, kapanmış trade'lerin özetlenmiş kullanıcı perspektifidir.

**App.jsx okuma / senkronizasyon notları**
- `fetchMyTrades()` active trade görünümünü backend mirror üzerinden kurar; trade room açılışında ve kritik aksiyon sonrası hızlı re-sync için bu yüzey kullanılır. Bu nedenle App içindeki aktif trade görünümü kontrat storage'ının doğrudan render'ı değil, backend'in taraf/oda projection'ıdır.
- `fetchAmounts()` yalnız `CHALLENGED` trade bağlamında on-chain `getCurrentAmounts()` okuyarak bleeding miktarlarını yeniler; trade room içindeki çürüme görünümü backend snapshot'tan değil, canlı kontrat read'inden beslenir.
- `onVisibilityChange` ve interval tabanlı yenileme davranışı, active trade UI'ını uzun süre açık kalan sekmelerde yeniden hizalamayı amaçlar. Bu mekanizma stale room state riskini azaltır ama anlık kesinlik garantisi vermez.

**İndeks / retention**
- `maker_address + status`, `taker_address + status`, `onchain_escrow_id` indeksleri temel trade okuma yollarını hızlandırır.
- `timers.resolved_at` üzerinde **partial TTL index** vardır; yalnızca `RESOLVED`, `CANCELED`, `BURNED` trade'ler 1 yıl sonra otomatik silinir.
- `evidence.receipt_delete_at` üzerinde sparse index vardır; bu index TTL için değil, cleanup job'ın scrub edilecek alanları verimli bulması içindir. Mongo TTL field'ı değil dokümanı sildiğinden, dekont ve snapshot scrub'ı job ile yapılır.
- PII route'ları `pii_snapshot` alanlarını birincil kaynak olarak kullanır; snapshot eksikse yalnızca legacy uyumluluk için `User.pii_data` fallback devreye girer.
- Dekont upload route'u `evidence.receipt_encrypted` alanını **write-once kanıt slotu** gibi ele alır; bir kez set edildikten sonra aynı trade için tekrar yazılamaz.

### 10.4 Geri Bildirimler Koleksiyonu (`Feedback`)

| Alan | Tür | Açıklama |
|---|---|---|
| `wallet_address` | Dize | Geri bildirimi gönderen cüzdan |
| `rating` | 1–5 | Zorunlu yıldız puanı |
| `comment` | Dize | Maksimum 1000 karakter yorum |
| `category` | `bug` \| `suggestion` \| `ui/ux` \| `other` | Route doğrulamasıyla senkron kategori |
| `created_at` | Tarih | Kayıt tarihi |

**Model davranışları**
- Feedback modeli hafif ve operasyoneldir; ürün geri bildirimi toplar, protokol otoritesi üretmez.
- `category` alanı Mongoose enum ile kısıtlanır; route katmanındaki Joi doğrulaması ile uyumlu tutulur.

**Route akışı**
- `POST /api/feedback`, `requireAuth` + `feedbackLimiter` arkasındadır; anonim geri bildirim kabul edilmez.
- Route katmanında `rating`, `comment`, `category` alanları Joi ile doğrulanır; başarılı istek `201` döner.
- Log satırları wallet, rating ve category içerir; feedback verisi ürün/UX telemetrisi üretir fakat protokol state'ini etkilemez.

**İndeks / retention**
- `created_at` üzerinde 1 yıllık TTL bulunur; ürün geri bildirimleri süresiz saklanmaz.
- `wallet_address + created_at` indeksi, wallet başına saatlik feedback sınırı ve abuse analizleri için hızlı tarama sağlar.

**Frontend feedback orkestrasyon notları (`App.jsx`)**
- Feedback modalı yıldız puanı, kategori ve minimum açıklama uzunluğu gibi istemci tarafı guard'lar uygular; bu yüzey serbest metin olmasına rağmen maliyet azaltıcı ve sınıflandırılmış geri bildirim toplamayı amaçlar.
- Gönderim signed-session korumalı `authenticatedFetch('/api/feedback')` ile yapılır; başarıda form state sıfırlanır ve modal kapanır.
- Modal içinde private key, seed phrase ve bankacılık parolası gibi sırların paylaşılmaması açıkça uyarılır; buna rağmen serbest metin alanı tamamen risksiz bir sır saklama yüzeyi değildir.

### 10.5 Günlük İstatistikler Koleksiyonu (`HistoricalStat`)

| Alan | Tür | Açıklama |
|---|---|---|
| `date` | `YYYY-MM-DD` dizesi | Günlük benzersiz anahtar |
| `total_volume_usdt` | Sayı | Çözülen trade'lerin toplam hacmi |
| `completed_trades` | Sayı | Günlük snapshot anındaki toplam tamamlanan trade sayısı |
| `active_listings` | Sayı | Snapshot anındaki açık ilan sayısı |
| `burned_bonds_usdt` | Sayı | Toplam eriyen/yakılan miktar |
| `avg_trade_hours` | Sayı \| null | Ortalama çözülme süresi (saat) |
| `created_at` | Tarih | Snapshot'ın oluşturulma zamanı |

**Frontend okuma yüzeyi notları (`App.jsx`)**
- `fetchStats()` günlük/historical istatistikleri kontrattan tek tek türetmez; backend aggregation yüzeyinden çeker. Bu nedenle ana sayfa ve özet kartlardaki protocol stats hızlı görünüm ve karşılaştırma amaçlıdır, kontrat storage'ının birebir canlı aynası değildir.

**Model davranışları**
- `date` benzersiz anahtardır; snapshot job aynı gün içinde tekrar çalışsa bile ikinci kayıt açılmaz, mevcut satır güncellenir.
- Bu koleksiyon, `/api/stats` için 30 günlük karşılaştırma ve trend hesaplarını trade koleksiyonunu her istekte taramadan destekler.
- `/api/stats`, önce Redis cache'i yoklar; cache boşsa en yeni `HistoricalStat` kaydı ile 30 gün önceki kaydı okuyup null-safe değişim alanları (`changes_30d.*`) üretir.

**İndeks stratejisi**
- `date: -1` indeksi en yeni snapshot'ların hızlı sıralanmasını sağlar.
- `created_at` yalnızca oluşturulma izidir; `updated_at` tutulmaz çünkü aynı günkü kayıt işlevsel olarak tek günlük snapshot'ı temsil eder.

---

## 11. Hazine Modeli

| Gelir Kaynağı | Oran | Koşul |
|---|---|---|
| Başarı ücreti | %0,2 (her iki taraftan %0,1) | Her `RESOLVED` (Çözüldü) işlem |
| Taker teminat çürümesi | 42 BPS / saat | `CHALLENGED` + Kanama aşaması |
| Maker teminat çürümesi | 26 BPS / saat | `CHALLENGED` + Kanama aşaması |
| Escrowed kripto çürümesi | 34 BPS / saat | Kanama'nın 96. saatinden sonra |
| YAKILDI sonucu | Kalan fonların %100'ü | 240 saat içinde uzlaşma olmaması |

### İlgili Kontrat Fonksiyonları

| Fonksiyon | Açıklama |
|---|---|
| `setTreasury(address)` | Sadece kontrat sahibinin (`Owner`) çağırabildiği, protokol ücretlerinin ve yakılan fonların gönderileceği Hazine (Treasury) adresini güncelleyen fonksiyondur. |
| `setSupportedToken(address, bool)` | Desteklenen ERC20 varlık listesini yönetir; create/lock yüzeyinin hangi token'lar için açık olduğunu belirler. Bu liste deploy sonrası statik değil, owner tarafından değiştirilebilir. |
| `pause()` / `unpause()` | Yalnız yeni create/lock akışlarını durdurur veya yeniden açar; mevcut işlemlerin kapanış fonksiyonlarını kilitlemez. |

---

## 12. Saldırı Vektörleri ve Bilinen Sınırlamalar

| Saldırı | Risk | Azaltma | Durum |
|---|---|---|---|
| Sahte makbuz yükleme | Yüksek | İtiraz teminat cezası — çürüme maliyeti potansiyel kazançtan fazla | ⚠️ Kısmi |
| Satıcı tacizi | Orta | Asimetrik çürüme: itiraz açan (Taker) daha hızlı kaybeder | ✅ Giderildi |
| Chargeback (TRY geri alımı) | Orta | Chargeback onay logu + IP hash kanıt zinciri | ⚠️ Kısmi |
| Sybil itibar çiftçiliği | Düşük | Cüzdan yaşı + dust limiti + benzersiz karşı taraf ağırlıklandırması | ✅ Giderildi |
| Challenge spam / düşük tier spam (Tier 0/1) | Yüksek | 4 saatlik cooldown + dust limiti + cüzdan yaşı | ✅ Giderildi |
| Kendi kendine işlem | Yüksek | On-chain `msg.sender ≠ maker` | ✅ Giderildi |
| Tek taraflı iptal tacizi | Yüksek | 2/2 EIP-712 — tek taraflı iptal imkansız | ✅ Giderildi |
| Backend anahtar hırsızlığı | Kritik | Sıfır özel anahtar mimarisi — yalnızca relayer | ✅ Giderildi |
| JWT ele geçirme / eski wallet session'ının yanlışlıkla geçerli görünmesi | Yüksek | 15 dakika geçerlilik + cookie-only auth + `/api/auth/me` strict wallet authority check + session-wallet mismatch durumunda aktif session invalidation + işlem kapsamlı PII tokenları | ✅ Giderildi |
| PII veri sızıntısı | Kritik | AES-256-GCM + HKDF + hız sınırı (3 / 10 dk) + retention cleanup job'ları + error log scrub | ✅ Giderildi |
| Frontend render hatalarının scrub edilmeden merkezi loglara plaintext PII sızdırması | Yüksek | `ErrorBoundary` istemci tarafında IBAN/kart/telefon pattern scrub uygular; backend log yüzeyi de payload kırpma ve PII scrub ile ikinci savunma hattı sağlar. | ✅ Giderildi |
| Production'da frontend crash stack'lerinin yanlışlıkla `localhost` gibi yerel fallback hedeflere gönderilmesi | Orta | Production modunda `VITE_API_URL` tanımsızsa crash log isteği hiç atılmaz; localhost fallback yalnız geliştirme bağlamında açıktır. | ✅ Giderildi |
| Kullanıcının IBAN'ı kopyaladığını sanıp güvenli olmayan bağlamda sessiz clipboard hatası yaşaması | Düşük | `PIIDisplay` güvenli bağlam kontrolü, try/catch ve manuel seçim fallback'i ile sessiz kopyalama başarısızlığını görünür yapar. | ✅ Giderildi |
| Production'da `.env` master key ile tüm PII'nın toplu açığa çıkması | Kritik | `KMS_PROVIDER=env` üretimde bloklanır; AWS KMS / Vault zorunludur | ✅ Giderildi |
| Yanlış / standart dışı HKDF ile anahtar türetme uyumsuzluğu | Orta | Node.js native `crypto.hkdf()` (RFC 5869) + planlı migrasyon gereksinimi | ✅ Giderildi |
| Bellekte uzun yaşayan master key / DEK kalıntısı | Orta | `_withDataKey()` sonrası zero-fill, `clearMasterKeyCache()` ve proses restart modeli | ✅ Giderildi |
| İşlem bittikten sonra hayalet PII erişimi | Kritik | `request-token` ve `GET /api/pii/:tradeId` aşamalarında anlık trade statü kontrolü; yalnızca `LOCKED/PAID/CHALLENGED` durumlarında erişim | ✅ Giderildi |
| Taker isminin trade sonrasında görünmeye devam etmesi | Orta | `taker-name` endpoint'inde de aynı aktif durum kümesi zorunlu | ✅ Giderildi |
| Public profile üzerinden alan sızması | Orta | `toPublicProfile()` allowlist/fail-safe tasarım; yalnızca açık seçilmiş alanlar döner | ✅ Giderildi |
| Ban bitişinin yalnızca bellekte kalması | Orta | `checkBanExpiry()` DB'ye kalıcı save yapar; ban durumu sayfa yenilemede geri dönmez | ✅ Giderildi |
| Redis tek nokta hatası | Yüksek | Readiness kontrolü + genel yüzeylerde fail-open + auth yüzeyinde in-memory fallback limiter | ✅ Giderildi |
| Yetim `PENDING` ilan birikimi | Orta | 12 saatlik cleanup job ile `DELETED`'a süpürme | ✅ Giderildi |
| Stale reputation mirror ile yanlış decay | Yüksek | Nihai uygunluğu on-chain `reputation()` ile doğrulayan decay job | ✅ Giderildi |
| Duplicate günlük istatistik kaydı | Düşük | Gün bazlı idempotent upsert (`historical_stats`) | ✅ Giderildi |
| Mongo reconnect kaosu / topology bozulması | Yüksek | Fail-fast process restart + supervisor yeniden başlatması | ✅ Giderildi |
| Kararsız listings sayfalama | Orta | `exchange_rate + _id` ile deterministik sort | ✅ Giderildi |
| RPC hatasında yanlış tier düşürme | Yüksek | Tier doğrulanamazsa `null` → `503`; Tier 0 fallback yok | ✅ Giderildi |
| Kimliksiz crash log endpoint'inin denetim izi doldurması | Yüksek | Sıkı IP rate limit + zorunlu alan doğrulaması + payload kırpma + 204 response | ✅ Giderildi |
| Dekont kanıtı üzerine yazma (evidence overwrite) | Kritik | Atomik update filtresinde `evidence.receipt_encrypted: null`; ikinci yükleme `409` ile reddedilir | ✅ Giderildi |
| Dekont yüklemede TOCTOU yarışı | Yüksek | `status: "LOCKED"` dahil tek atomik `findOneAndUpdate`; challenge ile yarışta son durum korunur | ✅ Giderildi |
| Dosya yükleme ile RAM tüketme / OOM | Yüksek | Disk tabanlı geçici storage + stream ile şifreleme; buffer tabanlı tüm-dosya yükleme yok | ✅ Giderildi |
| MIME spoofing ile zararlı payload kabul ettirme | Orta | İzinli MIME listesi + magic-bytes doğrulaması | ✅ Giderildi |
| İstatistiklerde anlamsız / hatalı yüzde değişimi | Orta | `previous=0/null` ise değişim `null`; yalnızca geçerli tarih çiftlerinde hesaplama | ✅ Giderildi |
| Trade detay endpointlerinden fazla alan sızması | Orta | `SAFE_TRADE_PROJECTION` ile alan daraltma ve taraf kontrolü | ✅ Giderildi |
| Cancel teklifinde deadline ezilmesi ile deadlock | Yüksek | İlk teklif deadline'ı sabitler; sonraki imza aynı deadline ile gelmek zorunda | ✅ Giderildi |
| Chargeback onayında yarış koşulu / çift kayıt | Orta | Atomik `findOneAndUpdate` + `acknowledged != true` filtresi | ✅ Giderildi |
| Proxy arkasında yanlış IP hash üretimi | Orta | `trust proxy` uyumlu gerçek IP belirleme + SHA-256 hash saklama | ✅ Giderildi |
| DLQ'da biriken / zehirli event'lerin sessizce kaybolması | Yüksek | Redis DLQ, re-drive worker, poison event metrikleri, arşivleme ve alarm cooldown | ✅ Giderildi |
| Zero / eksik `listingRef` ile kanonik bağın kaybedilmesi | Kritik | `EscrowCreated` için zero ref kritik bütünlük ihlali kabul edilir; heuristik fallback yok, DLQ + manuel inceleme | ✅ Giderildi |
| Canlı event'lerde checkpoint'in körlemesine ilerleyip sessiz veri kaybı yaratması | Kritik | `seen/acked/unsafe` blok takibi + yalnız safe checkpoint'in ilerletilmesi | ✅ Giderildi |
| Reconnect sonrası zombi listener / duplicate socket birikimi | Yüksek | Reconnect öncesi provider listener temizliği ve varsa `destroy()` çağrısı | ✅ Giderildi |
| SIWE nonce yarışında frontend'e Redis'te olmayan nonce dönülmesi | Yüksek | Nonce için Redis authoritative; `SET NX` yarışı sonrası re-read ve güvenli retry | ✅ Giderildi |
| Zayıf / placeholder JWT secret ile token sahteciliği riski | Kritik | Minimum 64 karakter, placeholder yasağı, entropy kontrolü, startup fail-fast | ✅ Giderildi |
| Replay worker'ın başlangıç bloğunu bilmeden ayağa kalkması | Yüksek | Readiness içinde checkpoint veya deployment/start block zorunluluğu | ✅ Giderildi |
| Liveness başarılı görünürken bağımlılıkların aslında hazır olmaması | Orta | Ayrı readiness kontrolleri: mongo, redis, worker, provider, config, replay bootstrap | ✅ Giderildi |

| Hayalet config / backend'de sahte ekonomik parametre fallback'i | Yüksek | On-chain config loader + Redis cache + `CONFIG_UNAVAILABLE` ile bilinçli 503 | ✅ Giderildi |
| Log dosyalarının web root yakınında tutulup yanlış sunulması | Yüksek | Varsayılan log dizinini backend içi izole `logs/` altına taşıma + `LOG_DIR` ile sistem log dizini desteği | ✅ Giderildi |
| Production'da gevşek CORS / wildcard origin ile cookie auth sızması | Kritik | Startup fail-fast: `*` yasak, boş origin yasak, şema doğrulaması ve allowlist zorunluluğu | ✅ Giderildi |
| Fatal durumda süreçlerin yarım kapanıp zombi timer/bağlantı bırakması | Orta | Ortak shutdown orkestrasyonu + scheduler temizliği + `server.close()` + force-exit timeout | ✅ Giderildi |
| Kur Manipülasyonu (Rate Manipulation) | Kritik | Sistem fiat limitlerini kullanmaz. Tier kısıtlamaları doğrudan mutlak kripto miktarı (USDT/USDC) üzerinden on-chain limitlere dayanır. | ✅ Giderildi |
| `reportPayment()` tarafında on-chain CID doğrulaması olmaması | Orta | Kontrat yalnız boş string'i reddeder; hash biçimi/CID hijyeni backend route ve mirror katmanında ayrıca doğrulanmalıdır. Tek başına kontrat bu garantiyi vermez. | ⚠️ Açık Not |
| Kontrat ile backend mirror arasında `CHALLENGED -> releaseFunds()` itibar atfı sapması | Yüksek | Kontratta maker dispute açıp sonra `releaseFunds()` ile kapatırsa başarısız uyuşmazlık maker'a yazılır. Backend yorum katmanları farklı işaretlerse UI/analitik/operasyon kararları drift eder. Otorite kontrattır; mirror düzenli mutabakat kontrolünden geçmelidir. | ⚠️ Açık Not |
| Backend yorum katmanının kontrat otoritesinin önüne geçmesi | Kritik | Event adları, Mongo cache alanları, route response'ları veya dashboard türevleri kontrat storage/fonksiyon gerçekliğinin yerine geçirildiğinde mimari drift oluşur. Tüm ekonomik ve state yorumları düzenli contract-authoritative review ile doğrulanmalıdır. | ⚠️ Açık Not |
| Mutual cancel anlatısının kontrat batch-modeli sanılması | Yüksek | Mevcut kontrat iki imzayı tek tx içinde üçüncü tarafın submit ettiği bir yol sağlamaz; her taraf kendi hesabıyla `proposeOrApproveCancel()` çağırmalıdır. Off-chain imza biriktirme yalnız koordinasyon amaçlıdır. | ⚠️ Açık Not |
| `EscrowReleased` / `EscrowCanceled` event adlarının ekonomik bağlamı tekil sanılması | Orta | Aynı event adı farklı kapanış yollarında yeniden kullanılır; backend analitiği state ve çağrı bağlamını da dikkate almalıdır. | ⚠️ Açık Not |
| Yasaklı cüzdanın tamamen protokolden men edildiğinin varsayılması | Orta | Kontrattaki ban kapısı yalnız taker-side `lockEscrow()` girişinde uygulanır; maker rolü ve mevcut trade kapanışları ayrı değerlendirilmelidir. | ⚠️ Açık Not |
| `ReputationUpdated` event'inden tüm ban/tier ceza state'inin çıkarılabileceğinin varsayılması | Orta | Event payload'ı sınırlıdır; `consecutiveBans`, `hasTierPenalty` ve `maxAllowedTier` için storage/read-model mutabakatı gerekir. | ⚠️ Açık Not |
| `decayReputation()` fonksiyonunun tam itibar affı sağladığının varsayılması | Yüksek | Fonksiyon yalnız `consecutiveBans` ve tier ceiling cezasını sıfırlar; `failedDisputes` ve tarihsel `bannedUntil` izi kalır. Bond fiyatlaması üzerindeki bazı etkiler devam eder. | ⚠️ Açık Not |
| Off-chain saklanan mutual-cancel imzalarının her zaman geçerli kalacağının varsayılması | Orta | `sigNonces` cüzdan başına globaldir; başka bir cancel çağrısı imzayı bayatlatabilir. On-chain submit öncesi nonce mutabakatı gerekir. | ⚠️ Açık Not |
| `burnExpired()` fonksiyonunun yalnız taraflarca çağrılabildiğinin varsayılması | Orta | Kontrat bu fonksiyonu `onlyOwner` veya trade taraflarıyla sınırlamaz; `MAX_BLEEDING` dolduğunda herhangi bir üçüncü taraf burn finalizasyonunu tetikleyebilir. Operasyonel runbook ve UI beklentisi buna göre kurulmalıdır. | ⚠️ Açık Not |
| Treasury adresinin deploy sonrası immutable olduğunun varsayılması | Orta | Kontrat sahibi `setTreasury()` ile hazine adresini döndürebilir; güven modeli deploy-time sabit adres varsayımı üzerine kurulmamalıdır. | ⚠️ Açık Not |
| Desteklenen token setinin statik olduğunun varsayılması | Orta | `supportedTokens` owner tarafından runtime'da açılıp kapatılabilir; frontend/backend allowlist'leri kontrat otoritesiyle mutabık tutulmalıdır. | ⚠️ Açık Not |
| `failedDisputes >= 2` sonrası cezaların yalnız bir kez tetiklendiğinin varsayılması | Yüksek | Eşik aşıldıktan sonra her yeni başarısızlık `consecutiveBans`'i tekrar artırır, ban süresini büyütür ve tier ceiling cezalarını derinleştirebilir. | ⚠️ Açık Not |
| `getReputation()` çıktısının tüm reputation state'i kapsadığının varsayılması | Orta | Bu view yalnız özet döndürür; `hasTierPenalty`, `maxAllowedTier` ve `firstSuccessfulTradeAt` gibi ilişkili alanlar için ek kontrat state'i okunmalıdır. Backend/UI bunu tam özet sanarsa tier ve ceza yorumları eksik kalır. | ⚠️ Açık Not |
| Helper/view fonksiyonlarının bağlayıcı enforcement yaptığı varsayımı | Orta | `antiSybilCheck()`, `getCooldownRemaining()`, `getCurrentAmounts()` ve `domainSeparator()` açıklayıcı/yardımcı yüzeylerdir; nihai kural zorlaması state-changing fonksiyonlardadır. UX katmanı bu helper'ları "izin verdi" gibi yorumlamamalıdır. | ⚠️ Açık Not |
| Owner governance yüzeyinin küçümsenmesi | Yüksek | `setTreasury`, `setSupportedToken`, `pause` ve `unpause` doğrudan ekonomik akış, erişilebilir token seti ve yeni trade girişi üzerinde etkilidir. Owner anahtarı operasyonel merkeziyet ve yönetişim riski taşır. | ⚠️ Açık Not |
| Supported token aktivasyonu zincir üstünde doğrulanmadan ownership devri yapılması | Yüksek | Güvenli deploy akışında `setSupportedToken()` sonrası `supportedTokens()` zincir üstünde yeniden okunmalı; doğrulama başarısızsa ownership devri yapılmamalıdır. Aksi halde eksik kurulum kalıcı owner devriyle birleşir. | ⚠️ Açık Not |
| Production deploy'unda gerçek token adresleri yerine eksik / zero-address / yanlış ENV kullanılması | Kritik | Deploy script production'da `MAINNET_USDT_ADDRESS` ve `MAINNET_USDC_ADDRESS` alanlarını zorunlu ve checksum'lı adres olarak beklemelidir; eksikse hard fail doğru davranıştır. | ⚠️ Açık Not |
| Test / non-production deploy yardımcılarının production güven modeli sanılması | Orta | ABI kopyalama, frontend `.env` auto-write veya mock token deploy adımları mimari çekirdek değildir; yanlışlıkla production süreçlerinin parçası sanılırsa yanlış operasyon runbook'ları oluşur. | ⚠️ Açık Not |
| Hardhat toolchain / ağ konfigürasyonunun üretim gerçekliğiyle uyumsuz olması | Orta | Yanlış `chainId`, farklı derleme profili (`viaIR`, optimizer, `evmVersion`) veya explorer doğrulama ayarları; beklenen bytecode ile yayımlanan bytecode arasında drift yaratabilir. Resmi derleme profili ve ağ hedefleri runbook'ta sabit tutulmalıdır. | ⚠️ Açık Not |
| Frontend active trade görünümünün kontrat storage'ının birebir canlı render'ı sanılması | Orta | `fetchMyTrades()` aktif oda ve trade listesini backend projection üzerinden kurar; kritik anlarda hızlıdır ama kontrat read ile farklı yenilenme temposuna sahiptir. | ⚠️ Açık Not |
| Protocol stats kartlarının kontrattan anlık hesaplandığının sanılması | Düşük/Orta | `fetchStats()` backend aggregation yüzeyini kullanır; ana sayfa istatistikleri canlı kontrat introspection değil, backend snapshot/karşılaştırma modelidir. | ⚠️ Açık Not |
| Polling boşluklarının “anlık kesin durum” sanılması | Orta | App interval tabanlı re-sync yapar; challenge, pause, sybil ve active trade yüzeyleri periyodik yenilenir. Kısa süreli stale pencere mimarinin parçasıdır. | ⚠️ Açık Not |
| Visibility resync'in kontrat enforcement sanılması | Düşük | Sekme görünür olduğunda yapılan yeniden okuma yalnız UI tazeleme davranışıdır; süre ve izinlerin nihai enforcement'ı kontrat/route guard'larındadır. | ⚠️ Açık Not |
| Fee / decimals / allowance fallback değerlerinin gerçek kontrat okuması sanılması | Orta | `10`, `6`, `0` gibi fallback'ler read hatasını maskeleyebilir; kullanıcıya gösterilen değer her zaman taze on-chain okuma olmayabilir. | ⚠️ Açık Not |
| UI dönüşüm katmanındaki gösterim miktarlarının otoritatif ekonomik miktar sanılması | Orta | `formatTokenAmountFromRaw` ve `rawTokenToDisplayNumber` yalnız görüntüleme/UI hesapları içindir; raw on-chain/base-unit değerlerin yerine geçirilmemelidir. | ⚠️ Açık Not |
| Pending transaction localStorage izinin nihai sonuç sanılması | Orta | `araf_pending_tx` yalnız geçici istemci izi ve recovery yardımcısıdır; kesin durum receipt ve backend/kontrat yeniden okumasıyla teyit edilmelidir. | ⚠️ Açık Not |
| Auto-resume ile trade room'a dönüşün otoritatif trade state sanılması | Düşük/Orta | Tek aktif trade varsa oda bağlamına geri dönmek UX kolaylığıdır; nihai durum yeniden okuma ve senkronizasyonla doğrulanır. | ⚠️ Açık Not |
| Provider listener lifecycle'ının görünmez kalması nedeniyle stale session veya duplicate listener oluşması | Orta | `bind` ile listener bağlama ve cleanup semantiği korunmalıdır; refactor'larda duplicate listener / eksik invalidation riski ayrıca gözetilmelidir. | ⚠️ Açık Not |
| Render içine gömülü IIFE / inline hesaplama bloklarının görünmez iş kuralı drift'i üretmesi | Düşük/Orta | Kritik render-side hesaplamalar belgelenmeli veya helper'lara taşınmalıdır; aksi halde JSX içi iş kuralı ile mimari açıklama zamanla kopabilir. | ⚠️ Açık Not |

| Pause'un mevcut işlemleri yanlışlıkla dondurduğunun varsayılması | Orta | `pause()` yalnız yeni create/lock çağrılarını durdurur; kapanış yolları açık kalır | ✅ Giderildi |

| Bleeding decay'in tek yönlü / tek kalemli sanılması | Orta | Treasury tahmini, dispute simülasyonu, UI açıklamaları ve analytics yanlış hesaplanır. Kontratta decay yalnız escrowed crypto üzerinde değil; maker bond, taker bond ve escrowed crypto üzerinde farklı oranlarla çalışır. | ⚠️ Açık Not |

| PII'nin component mount olduğu anda otomatik fetch edildiğinin sanılması | Orta | `usePII` otomatik fetch yapmaz; kullanıcı aksiyonu ile başlar. Aksi varsayım PII maruziyeti ve UX beklentisini yanlış kurar. | ⚠️ Açık Not |
| Frontend `tradeId` ile on-chain escrow id'nin karıştırılması | Orta | `PIIDisplay/usePII` akışı backend `Trade._id` kullanır; yanlış id türü, yanlış endpoint ve erişim reddi sorunlarına yol açar. | ⚠️ Açık Not |
| Crash log stack'inin sınırsız ve ham gönderildiğinin sanılması | Düşük | `ErrorBoundary` component stack'i sınırlar ve scrub uygular; sınırsız stack varsayımı log yüzeyi kapasitesi ve PII riski analizini bozar. | ⚠️ Açık Not |
| Countdown başlangıç state'inin yanlış bitmiş görünmesi nedeniyle kritik butonların kısa süre hatalı aktif görünmesi | Orta | `useCountdown` ilk state'i hedef tarihe göre hesaplar; release/challenge gibi pencereler flicker ile yanlış açılıp kapanmamalıdır. | ✅ Giderildi |
| Arka plan sekme throttling'i nedeniyle UI geri sayımının on-chain zamandan sapması | Orta | `useCountdown` Page Visibility API ile foreground'a dönüşte yeniden hesap yapar; uzun dispute pencerelerinde istemci saat drift'i azaltılır. | ✅ Giderildi |
| Reveal butonuna hızlı tekrar tıklamada eski PII yanıtının yeni state'i ezmesi | Orta | `usePII` aktif isteği `AbortController` ile iptal eder; yalnız en son istek state'e yazılır. | ✅ Giderildi |
| JWT süresi dolduğunda yetkili kullanıcının istemci tarafında yanlış PII erişim reddi yaşaması | Orta | `usePII`, `authenticatedFetch` üzerinden refresh-uyumlu oturum akışı kullanır; düz fetch yüzünden ortaya çıkan desenkronizasyon önlenir. | ✅ Giderildi |
| Trade odası kapanınca PII'nin istemci belleğinde gereksiz kalması | Orta | `usePII` unmount/trade değişiminde state temizler ve aktif isteği iptal eder. | ✅ Giderildi |
| Frontend countdown'un işlem yetkisi verdiğinin sanılması | Yüksek | `useCountdown` yalnız UI senkronizasyonu sağlar; kontrat timestamp/state zorlamasının yerine geçmez. Butonun görünür olması çağrının on-chain başarılı olacağını garanti etmez. | ⚠️ Açık Not |
| PII'nin istemci belleğine hiç girmediğinin sanılması | Orta | `usePII` kalıcı cache tutmaz ancak reveal süresince kısa ömürlü component state kullanır. Bu sınır doğru anlaşılmazsa tehdit modeli olduğundan daha güvenli sanılabilir. | ⚠️ Açık Not |
| Session auth ile trade-scoped PII bearer akışının karıştırılması | Orta | İlk adım cookie-tabanlı oturumla token ister, ikinci adım kısa ömürlü bearer ile PII çeker. Bu ayrım yanlış anlaşılırsa endpoint güvenlik modeli yanlış uygulanır veya yanlış test edilir. | ⚠️ Açık Not |
| Frontend kontrat katmanında hardcoded EIP-712 domain bilgisinin kontrat domain'iyle drift üretmesi | Yüksek | `signCancelProposal()` typed-data domain'ini frontend'de sabit kurar; kontrat adı/sürümü/domain ayrıntısı değişirse imzalar geçersizleşebilir. Frontend imzalama katmanı kontrat-otoriteli domain verisiyle düzenli mutabakat kontrolünden geçmelidir. | ⚠️ Açık Not |
| `VITE_API_URL` eksikken kontrat revert loglarının yanlışlıkla `localhost` fallback hedefine gitmesi | Orta | `useArafContract` hata loglarında doğrudan `http://localhost:4000/api` fallback'i kullanır; production build yapılandırması eksikse istemci hata telemetry'si yanlış hedefe sızabilir veya kaybolabilir. | ⚠️ Açık Not |
| Pending transaction izinin stale/localStorage kalıntısı üretmesi | Düşük | `araf_pending_tx` receipt sonrası temizlenir, ancak tarayıcı kapanması veya sert hata halinde stale iz kalabilir. UI ve runbook bu veriyi otoritatif tx sonucu değil, istemci yardım izi olarak yorumlamalıdır. | ⚠️ Açık Not |
| `getTokenDecimals()` ve `getTakerFeeBps()` gibi read helper'ların güvenli varsayılan döndürmesinin gerçek okuma hatasını maskelemesi | Orta | Hata halinde `6` veya `10n` gibi varsayılanlar UX'i ayakta tutar, ancak kontrat okuma başarısızlığını sessizce ekonomik gerçeklik gibi gösterebilir. Analitik, fee gösterimi ve token miktar dönüşümü bu fallback'leri kontrat otoritesi sanmamalıdır. | ⚠️ Açık Not |
| Test/faucet `mintToken()` yüzeyinin production kontrat erişim modeliyle karıştırılması | Orta | Aynı hook içinde hem protokol write çağrıları hem faucet helper'ları bulunur; dağıtım bağlamı net değilse test yüzeyi production yetki modeli sanılabilir. | ⚠️ Açık Not |

| Bağlı cüzdanın otomatik olarak geçerli backend oturumu sayılması | Yüksek | `App.jsx` exact wallet-session mutabakatı arar; `isConnected` tek başına yeterli değildir. `authenticatedWallet === connectedWallet` sağlanmadan hassas UI akışları açılmaz. | ✅ Giderildi |
| Session mismatch durumunun yalnız istemci taraflı bir UI temizliği olduğu sanılması | Orta | `authenticatedFetch` `409` aldığında backend logout denemesi yapar, sonra local state'i temizler. Session invalidation hem backend hem frontend katmanında ele alınır. | ✅ Giderildi |
| Refresh başarısız olsa bile istemcinin eski session'ı kullanmaya devam ettiği varsayımı | Yüksek | `authenticatedFetch` tek seferlik refresh dener; başarısızsa local session temizlenir ve kullanıcı yeniden imzaya yönlendirilir. | ✅ Giderildi |
| `hasSignedSessionForActiveWallet` benzeri frontend guard'ların kontrat otoritesi olduğu sanılması | Orta | Bu guard yalnız UX kapısıdır; nihai doğrulama backend session sınırı ve kontrat state'indedir. | ⚠️ Açık Not |
| Provider/connector render hatasının tüm uygulamayı ve wallet altyapısını birlikte çökertmesi | Orta | `ErrorBoundary`, provider katmanlarının içine yerleştirilir; böylece render hataları App ağacıyla sınırlanır, provider altyapısı körlemesine düşmez. | ✅ Giderildi |
| Development chain sıralamasının production network politikası sanılması | Düşük | Development'ta Hardhat önceliklidir; bu sıralama üretim network güven modeli değil, geliştirici UX kararıdır. | ⚠️ Açık Not |
| Public Codespaces RPC tünelinin güvenli üretim altyapısı sanılması | Orta | `getCodespacesRPC()` yalnız geliştirme kolaylığı içindir; public tünel exposure gerçek üretim RPC güven modeli yerine geçmez. | ⚠️ Açık Not |
| WalletConnect'in destekleniyor sanılması | Düşük | Bootstrap katmanında `WalletConnect` geçici olarak kapalıdır; destek matrisi connector konfigürasyonuyla fiilen sınırlıdır. | ⚠️ Açık Not |
| SIWE domain/URI'nin frontend'de hardcoded olduğu varsayımı | Orta | `loginWithSIWE` imzalama bağlamını backend nonce yanıtından alır; frontend sabitleriyle varsayım kurulursa yanlış threat-model veya yanlış deploy teşhisi yapılır. | ⚠️ Açık Not |
| Verify başarılı olsa bile dönen wallet'ın bağlı cüzdanla yeniden eşleştirilmediğinin sanılması | Orta | App, `POST /api/auth/verify` sonrası backend'in döndürdüğü wallet'ı `connectedWallet` ile tekrar karşılaştırır; bu ikinci kontrol atlanır sanılırsa sign-flow race koşulları gözden kaçabilir. | ⚠️ Açık Not |
| Provider runtime event'lerinin session invalidation üretmediğinin varsayılması | Yüksek | `accountsChanged`, `disconnect` ve `chainChanged` olaylarında runtime wallet authenticated wallet'tan saparsa App bunu güvenlik olayı kabul eder ve session'ı sonlandırır. Bu davranış yokmuş gibi düşünülürse stale session riski hafife alınır. | ⚠️ Açık Not |
| `authChecked` tamamlanmadan signed-session sonucunun kesinleştiğinin varsayılması | Orta | App bootstrap'ında session probe tamamlanana kadar wallet/signed-session durumu geçici kabul edilir. İlk render davranışları bu senkronizasyon işaretine bağlıdır. | ⚠️ Açık Not |

| Market buy/create buton gate'lerinin kontrat otoritesi sanılması | Orta | `renderMarket()` ve `handleOpenMakerModal()` içindeki signed-session, ağ, token ve anti-sybil kontrolleri UX gate'idir; nihai kabul/red backend ve kontrat katmanındadır. | ⚠️ Açık Not |
| Prepared listing ile on-chain `createEscrow()` akışının atomik rollback sağladığının sanılması | Yüksek | `handleCreateEscrow()` prepared listing'i silmeye ve allowance'ı sıfırlamaya çalışır, ancak bu yalnız best-effort cleanup'tır. Ağ/timeout hatalarında geçici orphan listing veya allowance kalıntısı oluşabilir. | ⚠️ Açık Not |
| On-chain `lockEscrow()` sonrası backend `tradeId` mirror'ının anında oluştuğunun varsayılması | Orta | App retry loop ve `_pendingBackendSync` geçiş durumu kullanır; zincir üstü başarı ile Mongo mirror kaydı arasında kısa süreli senkronizasyon boşluğu olabilir. | ⚠️ Açık Not |
| Market kartlarındaki `successRate` ve `txCount` alanlarının gerçek reputation/analytics verisi sanılması | Orta | `fetchListings()` bu alanlar için placeholder/default değerler üretir; gerçek on-chain reputation veya backend analitik sonucu sayılmamalıdır. | ⚠️ Açık Not |
| Test faucet (`handleMint`) yüzeyinin production protokol akışıyla karıştırılması | Orta | Market ekranındaki faucet butonları test/dev kolaylığıdır; production ekonomik modelinin parçası değildir. Dağıtım bağlamı açık ayrılmalıdır. | ⚠️ Açık Not |

---


| Dekont yüklendi = ödeme on-chain bildirildi sanısı | Orta | Upload ve `reportPayment()` App içinde iki ayrı adımdır; buton gating ve kontrat çağrısı ayrı yürür | ⚠️ Kısmi |
| Chargeback checkbox'ının tek başına hukuki/audit kayıt sanılması | Orta | Checkbox yalnız UI state'idir; asıl audit izi backend `chargeback-ack` rotasına best-effort yazılır | ⚠️ Kısmi |
| Mutual cancel koordinasyonunun tamamen on-chain olduğu varsayımı | Orta | Nonce okuma + imza üretimi + backend relay + nihai on-chain çağrı şeklinde hibrit akış | ⚠️ Kısmi |
| Trade room timer'larının kontrat enforcement yerine geçirilmesi | Orta | `useMemo` + `useCountdown` yalnız UI görünürlüğünü yönetir; gerçek zaman kapıları kontratta zorlanır | ✅ Giderildi |
| On-chain challenge / ping sonrası UI'ın yalnız polling ile güncellendiğinin sanılması | Düşük/Orta | `fetchMyTrades()` ile kritik aksiyonlar sonrası hızlı resync yapılır | ✅ Giderildi |

| Terms modal kabulünün protokol riskini ortadan kaldırdığı sanısı | Orta | `renderTermsModal` hukuki/operasyonel kabul yüzeyidir; kontrat enforcement veya fon güvenliği garantisi değildir. | ⚠️ Açık Not |
| `EnvWarningBanner` görünüyor diye env/config güvenliğinin garanti sanılması | Düşük/Orta | Banner yalnız görünürlük sağlar; hatalı kontrat adresi, yanlış RPC veya eksik env değerleri yine operasyonel risk üretir. | ⚠️ Açık Not |
| Toast mesajlarının otoritatif state veya kesin işlem sonucu yerine geçirilmesi | Orta | `showToast` ephemeral UX feedback kanalıdır; kontrat receipt'i, backend mirror veya wallet state'in yerini almaz. | ⚠️ Açık Not |
| Maintenance / wrong-network / anti-sybil banner'larının kontrat enforcement sanılması | Orta | Banner'lar kullanıcı yönlendirme katmanıdır; gerçek red/kabul mantığı kontrat ve backend guard'larındadır. | ⚠️ Açık Not |
| Mobil/masaüstü navigasyon yüzeylerinin farklı güvenlik modeli sunduğunun varsayılması | Düşük | `renderSlimRail`, `renderContextSidebar` ve `renderMobileNav` aynı uygulama durumunu farklı ergonomilerle sunar; güvenlik semantiği değişmez. | ⚠️ Açık Not |

## 13. Kesinleşmiş Protokol Parametreleri

Aşağıdaki tüm değerler Solidity `public constant` olarak deploy edilmiştir — **backend tarafından değiştirilemez.** Backend bu değerler için hard-code fallback kullanmaz; `protocolConfig` servisi bunları on-chain'den okuyup Redis'te kısa ömürlü cache'ler. Kontrat adresi / RPC eksikse sistem sahte varsayılan üretmek yerine `CONFIG_UNAVAILABLE` durumuna geçer ve ilgili route'lar `503 Service Unavailable` döndürür.

| Parametre | Değer | Sözleşme Sabiti |
|---|---|---|
| Ağ | Base (Chain ID 8453) | — |
| Protokol ücreti | %0,2 (her iki taraftan %0,1) | `TAKER_FEE_BPS = 10`, `MAKER_FEE_BPS = 10` |
| Grace period | 48 saat | `GRACE_PERIOD` |
| Escrowed crypto decay başlangıcı | Kanama'dan 96 saat sonra (itirazdaki 144. saat) | `USDT_DECAY_START` |
| Maksimum kanama süresi | 240 saat (10 gün) → YAKILIR | `MAX_BLEEDING` |
| Taker teminat çürüme hızı | 42 BPS / saat | `TAKER_BOND_DECAY_BPS_H` |
| Maker teminat çürüme hızı | 26 BPS / saat | `MAKER_BOND_DECAY_BPS_H` |
| Escrowed kripto çürüme hızı | 34 BPS / saat | `CRYPTO_DECAY_BPS_H` |
| Minimum cüzdan yaşı | 7 gün | `WALLET_AGE_MIN` |
| Native bakiye eşiği (dust limiti) | `0.001 ether` | `DUST_LIMIT` |
| Minimum aktif süre | 15 gün | `MIN_ACTIVE_PERIOD` |
| Tier 0 / 1 cooldown | 4 saat / işlem | `TIER0_TRADE_COOLDOWN`, `TIER1_TRADE_COOLDOWN` |
| Challenge ping bekleme süresi | `PAID`'den sonra 24 saat | `pingTakerForChallenge()` ön koşulu |
| Auto-release ping bekleme süresi | `GRACE_PERIOD` sonrası 24 saat cevap penceresi | `pingMaker()` + `autoRelease()` |
| Karşılıklı iptal son tarih tavanı | 7 gün | `MAX_CANCEL_DEADLINE` |
| EIP-712 domain | `ArafEscrow` / version `1` | `EIP712("ArafEscrow", "1")` |
| Auto-release ihmal cezası | Her iki teminattan %2 | `AUTO_RELEASE_PENALTY_BPS = 200` |
| Tier 0 max miktar | 150 USDT/USDC | `TIER_MAX_AMOUNT_TIER0` |
| Tier 1 max miktar | 1.500 USDT/USDC | `TIER_MAX_AMOUNT_TIER1` |
| Tier 2 max miktar | 7.500 USDT/USDC | `TIER_MAX_AMOUNT_TIER2` |
| Tier 3 max miktar | 30.000 USDT/USDC | `TIER_MAX_AMOUNT_TIER3` |
| Tier 4 max miktar | Limitsiz | `_getTierMaxAmount(4) -> 0` |
| Dust limiti | 0,001 ETH (Base'de ~2$) | `DUST_LIMIT` |
| Temiz itibar indirimi | −%1 | `GOOD_REP_DISCOUNT_BPS = 100` |
| Kötü itibar cezası | +%3 | `BAD_REP_PENALTY_BPS = 300` |
| Yasak tetikleyici | 2+ başarısız uyuşmazlık | `_updateReputation()` |
| 1. yasak süresi | 30 gün | Eskalasyon: `30 × 2^(N−1)` gün |
| Maksimum yasak süresi | 365 gün | Sözleşmede üst sınır zorunlu |
| Treasury ilk adresi | Deploy sırasında verilir ama owner tarafından güncellenebilir | `treasury` + `setTreasury()` |
| Desteklenen token listesi | Statik değil, owner yönetimli | `supportedTokens` + `setSupportedToken()` |

### Derleme ve Ağ Toolchain Varsayımları

- Resmi sözleşme derleme hattı `Solidity 0.8.24 + optimizer(runs=200) + viaIR + evmVersion=cancun` kombinasyonuna dayanır. ABI/bytecode, doğrulama ve yeniden derleme işlemleri bu profile sadık kalmalıdır.
- Hedef ağlar `Base Sepolia (84532)` ve `Base Mainnet (8453)` olarak tanımlıdır; yerel geliştirme için `hardhat` / `localhost` ağları `31337` kullanır.
- Basescan doğrulama altyapısı toolchain'in parçasıdır; explorer doğrulaması bağımsız bir güvenlik garantisi değildir fakat deploy edilen bytecode'un gözden geçirilebilir olmasını sağlar.
- `viaIR` veya `evmVersion` ayarlarının sessizce değiştirilmesi, derleme çıktısının farklılaşmasına ve yanlış bytecode/doğrulama beklentilerine yol açabilir.

### Deploy ve Kurulum Güvenliği

- Production deploy akışında `TREASURY_ADDRESS`, `MAINNET_USDT_ADDRESS` ve `MAINNET_USDC_ADDRESS` geçerli adres olarak sağlanmadan kurulum tamamlanmış sayılmaz.
- Supported token kurulumu yalnız owner çağrısı ile yapılır; ancak güvenli deploy semantiğinde bu çağrıların zincir üstünde yeniden doğrulanması gerekir.
- Ownership devri, desteklenen token seti doğrulanmadan tamamlanmamalıdır.

### Diğer Yönetici Fonksiyonları

Aşağıdaki fonksiyonlar sadece kontrat sahibi (`Owner`) tarafından çağrılabilir ve protokolün temel işleyişini yönetir.

| Fonksiyon | Açıklama |
|---|---|
| `setSupportedToken(address, bool)` | Protokolde alım-satım için desteklenen ERC20 token'larını (örn: USDT, USDC) ekler veya kaldırır. |
| `setTreasury(address)` | Protokol ücretlerinin ve yakılan fonların gönderileceği Hazine (Treasury) adresini günceller. |
| `pause()` | Yeni `createEscrow()` ve `lockEscrow()` girişlerini durdurur; mevcut trade kapanışları açık kalır. |
| `unpause()` | Pause sonrası yeni create/lock akışlarını yeniden açar. |

### Bilgi Amaçlı View / Helper Fonksiyonları

Aşağıdaki fonksiyonlar on-chain gerçekliği **değiştirmez**; görünür kılar. Frontend, analytics ve üçüncü taraf doğrulama katmanları için önemlidir.

| Fonksiyon | Amaç |
|---|---|
| `antiSybilCheck(address)` | Cüzdanın yaş/bakiye/cooldown uygunluğunu hızlı özetler; bağlayıcı enforcement değildir. |
| `getCooldownRemaining(address)` | Cooldown kalan süresini UX için görünür kılar. |
| `getCurrentAmounts(uint256)` | Bleeding sonrası anlık ekonomik durumu doğrudan kontrattan verir. |
| `getFirstSuccessfulTradeAt(address)` | Tier yükselişinin zaman bileşenini açıklamak için ilk başarılı işlemi gösterir. |
| `getReputation(address)` | Özet reputation görünümü sağlar; tüm ilişkili storage alanlarını kapsamaz. |
| `domainSeparator()` | EIP-712 imza akışlarının doğru domain'e bağlandığını doğrulamaya yarar. |


---

## 14. Gelecek Evrim Yolu

Araf Protokolü'nün gelişimi, teknik olgunluk ve ekosistem büyümesine paralel olarak aşağıdaki dört ana aşamada gerçekleşecektir:

| Faz | Odak Noktası | Temel Özellikler & Kilometre Taşları |
| :--- | :--- | :--- |
| **Faz 1** | **Güvenlik & Lansman** | • Akıllı Sözleşme Audit (Bağımsız Denetim)<br>• Base Sepolia Public Beta<br>• Gnosis Safe (3/5) Hazine Geçişi<br>• AWS KMS / Vault Entegrasyonu |
| **Faz 2** | **Mainnet & UX** | • Base Mainnet Resmi Lansman<br>• Base Smart Wallet (Passkey) Desteği<br>• Paymaster (Gasless) Uygulaması<br>• PWA Mobil Arayüz |
| **Faz 3** | **Genişleme & Likidite** | • Order Book & Subgraph İndeksleme<br>• Multi-Asset Swap (ETH, cbBTC vb.)<br>• Retroactive Staking & Ödül Mekanizması<br>• Kurumsal Maker API Desteği |
| **Faz 4** | **Gizlilik & Vizyon** | • ZK-Proof ile Anonim IBAN Doğrulama<br>• OP Superchain Cross-Chain Escrow<br>• Küresel Fiat-Kripto Likidite Katmanı |

---


## 15. Frontend UX Koruma Katmanı (Mart 2026)

Bu sürümde UI katmanı; **hakemlik yapmadan**, kullanıcıyı yüksek maliyetli hata akışlarından uzaklaştıracak biçimde güncellenmiştir. Kritik ilke korunur: **karar mercii daima kontrattır**, frontend yalnızca yönlendirir.

### 15.1 Geri Bildirim Akışı (TR/EN)

- Geri bildirim modalı iki dilde daha açıklayıcı hale getirildi.
- Kategori + yıldız zorunluluğu korunurken minimum açıklama uzunluğu (12 karakter) eklendi.
- Amaç: yüzeysel raporları azaltıp gerçek TX/revert kök nedenlerini daha hızlı yakalamak.
- Başarısız API çağrılarında artık yanlışlıkla “başarılı” toast gösterilmez; hata kullanıcıya net biçimde yansıtılır.

### 15.2 Ana Sayfa Bilgilendirme Katmanı

- Responsive bir **"P2P Nasıl Çalışır?"** bölümü eklendi.
- Uyuşmazlık çözümünün backend veya insan hakem değil, on-chain oyun teorisi ile yürüdüğü açık biçimde anlatıldı.
- Buna ek olarak FAQ bloğu ile sık sorulan sorulara kısa, iki dilli açıklamalar eklendi.

### 15.3 Footer ve Kamusal Yönlendirme

- Tüm görünümlerde modern bir footer standardı tanımlandı: `Araf © 2026`.
- GitHub / Twitter / Farcaster yönlendirmeleri tek satırda sunularak protokolün kamusal varlığı görünür kılındı.
- Linkler env değişkenleri ile (`VITE_SOCIAL_*`) override edilebilir; bu yaklaşım farklı dağıtımlarda kod değişimi gerektirmez.

### 15.4 Frontend Hata Sınırı ve Güvenli Crash Loglama

- `ErrorBoundary`, React render hatalarını kullanıcıya dostu bir fallback ekranla sarar; uygulama kırıldığında sessiz beyaz ekran yerine kontrollü bir kurtarma yüzeyi sunar.
- Hata backend'e gönderilmeden önce bilinen PII pattern'ları (özellikle IBAN, kart numarası, telefon) scrub edilir; böylece render stack'i veya error message üzerinden plaintext sızıntı kanalı daraltılır.
- Production ortamında `VITE_API_URL` tanımsızsa crash log isteği hiç atılmaz; istemci yanlışlıkla `localhost:4000` benzeri fallback hedeflere stack trace sızdırmaz.
- Crash log gönderimi **best-effort** tasarlanmıştır; log isteğinin başarısız olması uygulamayı ikinci kez çökertmez.
- `componentStack` ham ve sınırsız biçimde gönderilmez; üst satırlar sınırlanarak yalnız tanısal bağlam korunur.
- `url: window.location.href` alanı o anki route bağlamını taşır; merkezi log yüzeyi, istemci tarafı route bilgisini backend loguna bağlar.
- Crash log yüzeyi güvenlik modeli açısından auth gerektirmeyen `/api/logs/client-error` endpoint'ine dayanır; bu nedenle frontend tarafındaki bu bileşen, backend'deki rate-limit ve payload kırpma politikalarıyla birlikte düşünülmelidir.

### 15.5 Şifreli PII Görüntüleme ve Clipboard Güvenliği

- `PIIDisplay`, IBAN ve iletişim verisini **varsayılan gizli** gösterir; kullanıcı açık onay vermeden PII fetch edilmez.
- Reveal akışı `usePII(tradeId, authenticatedFetch)` üzerinden çalışır; burada kullanılan `tradeId`, on-chain escrow id değil backend `Trade` belgesinin Mongo `_id` alanıdır.
- PII erişimi iki aşamalıdır: önce cookie-tabanlı oturum ile trade-scoped kısa ömürlü PII token alınır, sonra bu token ile ikinci istek yapılır.
- `usePII` mount anında otomatik fetch yapmaz; kullanıcı aksiyonuyla başlar, böylece gereksiz PII maruziyeti azaltılır.
- `usePII`, `authenticatedFetch` ile JWT refresh akışına uyumludur; oturum canlıyken süresi dolmuş JWT yüzünden yanlış PII erişim reddi üretilmez.
- `usePII`, `AbortController` ile önceki isteği iptal eder; art arda reveal denemelerinde eski yanıtın yeni state'i ezmesi engellenir.
- PII frontend'de **kalıcı cache'e alınmaz**, ancak reveal açık olduğu sürece kısa ömürlü component state içinde tutulur; mimari sınır budur.
- Trade odası unmount olduğunda veya trade değiştiğinde hook aktif isteği iptal eder ve PII state'ini temizler; istemci belleğinde kalıcılık azaltılır.
- Kullanıcı PII'yı gizlediğinde bileşen local görünürlüğü sıfırlar ve `clearPII()` çağırarak istemci belleğinde gereksiz kalıcılığı azaltır.
- İkinci adım `/api/pii/:tradeId` çağrısı normal session cookie ile değil, **trade-scoped kısa ömürlü bearer token** ile yapılır; bu akış normal auth yüzeyinden bilinçli olarak ayrılmıştır.
- Clipboard akışı güvenli bağlam (`window.isSecureContext`) kontrol eder; HTTPS dışı bağlamlarda kullanıcıya otomatik kopyalamanın güvenilir olmadığı açıkça bildirilir.
- `navigator.clipboard.writeText()` başarısız olursa seçim + `execCommand('copy')` fallback'i kullanılır; kullanıcı sessiz başarısızlık yaşamaz.
- Telegram yönlendirmesi `getSafeTelegramUrl` veya sanitize edilmiş fallback handle ile oluşturulur; bileşen kullanıcıya ekran görüntüsü ve hassas verinin yerel ekran paylaşımı riskini açıkça hatırlatır.
- `useCountdown`, kritik süre eşiklerini istemci tarafında flicker üretmeden başlatır; ilk `isFinished` değeri hedef tarihe göre hesaplanır, böylece release/challenge gibi butonlar sayfa yenilemesinde yanlışlıkla bir an aktif görünmez.
- `useCountdown`, Page Visibility API ile arka plan sekmesinden dönüldüğünde zamanı yeniden hesaplar; uzun süreli 48/240 saatlik akışlarda UI sayacı tarayıcı throttling nedeniyle on-chain zamandan ciddi biçimde sapmaz.

### 15.6 Frontend Kontrat Erişim Katmanı (`useArafContract`)

- `useArafContract`, frontend ile `ArafEscrow` arasındaki ana on-chain erişim sınırıdır; kullanıcı aksiyonlarını doğrudan kontrat çağrılarına ve kontrat okumalarına dönüştürür.
- Hook, her write çağrısından önce üç preflight guard uygular: aktif `walletClient` varlığı, geçerli `VITE_ESCROW_ADDRESS` ve desteklenen ağ doğrulaması (`8453`, `84532`, `31337`).
- Bu katman, yanlış ağda işlem göndermeyi UX seviyesi bir uyarı değil, **işlem öncesi bloklanan bir mimari guard** olarak ele alır.
- Write çağrıları `waitForTransactionReceipt` ile receipt bekler; bu nedenle hook yalnız imza istemez, zincir üstü kabulü de UX akışına bağlar.
- Her write çağrısında pending transaction izi `localStorage` altında `araf_pending_tx` anahtarıyla saklanır; böylece sayfa yenilemesi sırasında tx hash, fonksiyon adı, chainId ve escrow adresi kaybolmaz.
- Receipt alındığında bu pending iz temizlenir; dolayısıyla localStorage kalıcılığı, geçici on-chain izleme/yeniden bağlanma desteği olarak tasarlanmıştır.
- Hook write/read yüzeyini bilinçli olarak ayırır:
  - write tarafı: `registerWallet`, `createEscrow`, `cancelOpenEscrow`, `lockEscrow`, `reportPayment`, `releaseFunds`, `challengeTrade`, `autoRelease`, `burnExpired`, `pingMaker`, `pingTakerForChallenge`, `decayReputation`, `proposeOrApproveCancel`
  - read/helper tarafı: `getReputation`, `antiSybilCheck`, `getCooldownRemaining`, `getWalletRegisteredAt`, `getTakerFeeBps`, `getFirstSuccessfulTradeAt`, `getTrade`, `getCurrentAmounts`, `getPaused`
- ERC-20 approval yüzeyi bu hook içinde tutulur; çünkü `createEscrow()` ve `lockEscrow()` akışları kontratın `safeTransferFrom` çağrılarına bağımlıdır ve allowance olmadan revert eder.
- `approveToken`, `getAllowance` ve `getTokenDecimals` birlikte düşünüldüğünde frontend tarafında token-onay orkestrasyonu hook seviyesinde merkezileştirilmiştir.
- `mintToken()` varlığı, frontend'in test/faucet token akışını da aynı kontrat erişim katmanında tuttuğunu gösterir; bu davranış üretim ekonomik modeli değil, test/development yardımcı yüzeyidir.
- Hook bazı read çağrılarında **güvenli varsayılanlar** döndürür:
  - `getAllowance()` hata halinde `0n`
  - `getTokenDecimals()` hata halinde `6`
  - `getTakerFeeBps()` hata halinde `10n`
  - `getReputation()` hata halinde `null`
  Bu yaklaşım UX'i sert çöküşten korur, ancak kontrat okuma hatalarının sessizce "makul varsayım" gibi görünmesi riskini doğurur.
- `signCancelProposal()` EIP-712 verisini frontend'de oluşturur ve deadline'ı kullanıcıya bıraksa bile üst sınırı 7 gün ile sınırlar; bu, kontratın `MAX_CANCEL_DEADLINE` kuralını istemci tarafında da yansıtır.
- Ancak hook, typed-data domain'ini kontrattan okumak yerine frontend içinde sabit tanımlar:
  - `name: "ArafEscrow"`
  - `version: "1"`
  - `chainId`
  - `verifyingContract`
  Bu, kontrat domain'i değişirse frontend imzalama katmanının drift üretme riski taşıdığı anlamına gelir.
- Hook revert ve approval/faucet hata loglarını auth gerektirmeyen backend log yüzeyine yollar; bu, kontrat UX'i ile merkezi operasyon loglamasının birleştiği sınırdır.

### 15.7 App.jsx Oturum, Cüzdan Otoritesi ve Signed Session Guard

- `App.jsx`, wallet bağlı olmasını tek başına yetkili durum kabul etmez. Frontend'de kullanılabilir oturum, ancak `isConnected`, `connectedWallet`, `isAuthenticated` ve `authenticatedWallet === connectedWallet` birlikte sağlandığında **signed session for active wallet** sayılır.
- Bu model, cüzdan bağlantısı ile backend cookie session'ını bilinçli olarak ayırır. Kullanıcı cüzdanı bağlamış olsa bile, o cüzdan için imzalı backend session yoksa kritik UI akışları kapalı kalır.
- `authenticatedFetch`, her korumalı backend çağrısına `x-wallet-address` ekler; böylece backend `requireSessionWalletMatch` sınırı frontend tarafında da sürekli beslenir. Session mismatch (`409`) yalnız toast mesajı üreten bir UI olayı değildir; backend logout denemesi, local cleanup ve pending tx izlerinin temizlenmesi ile birlikte ele alınır.
- Sayfa yüklenirken yapılan `/api/auth/me` probe'u, frontend'in pasif session restore yerine **exact wallet-session mutabakatı** aradığını gösterir. Session wallet eksikse veya bağlı cüzdanla eşleşmiyorsa frontend bunu restore etmez.
- `requireSignedSessionForActiveWallet()` kontrat çağrısı yapmadan önce değil, hassas UX yüzeylerine girişte devreye giren ek bir guard'dır. Böylece kullanıcı yanlış cüzdanla profile update, maker listing veya benzeri aksiyonlara sürüklenmez.
- `clearLocalSessionState()` yalnız auth flag'lerini değil, `activeTrade`, `activeEscrows`, `cancelStatus`, `chargebackAccepted`, `paymentIpfsHash`, loading state'leri ve `araf_pending_tx` izini de temizler. Frontend session sonlandırması bu nedenle yalnız kimlik bilgisini değil, trade-room runtime bağlamını da sıfırlar.
- `bestEffortBackendLogout()` ve `handleLogoutAndDisconnect()` birlikte düşünüldüğünde, App düzeyi logout modeli üç parçalıdır: backend cookie session'ı kapatmayı dene, local session/trade state'ini temizle, cüzdan bağlantısını kes. Bu sıralama, wallet disconnect ile session invalidation'ın birbirine karıştırılmamasını sağlar.
- `loginWithSIWE`, SIWE domain ve URI'yi frontend sabitlerinden değil backend nonce yanıtından alır. Bu, imzalama bağlamının frontend deploy konfigürasyonundan değil backend otoritesinden beslenmesi anlamına gelir. Verify sonrası frontend, backend'in döndürdüğü cüzdanı bağlı cüzdanla yeniden eşleştirir; başarılı verify tek başına session restore için yeterli değildir.
- Provider runtime event dinleyicileri (`accountsChanged`, `disconnect`, `chainChanged`) yalnız wallet icon güncellemesi için kullanılmaz; aktif authenticated wallet değişirse App bunu güvenlik olayı sayar. Session'ın zincir üstü/bağlı cüzdan bağlamı değiştiğinde signed session geçersiz kabul edilir.
- `authChecked` bayrağı App bootstrap'ında pasif dekoratif bir flag değildir; signed-session durumunun probe edilip edilmediğini ayırır. Böylece “wallet bağlı ama session bilinmiyor” ile “wallet bağlı ve session doğrulandı” halleri UX düzeyinde ayrıştırılır.

### 15.8 Frontend Bootstrap, Wallet Provider ve Query Katmanı

- `main.jsx`, uygulamanın kök bootstrap zincirini açıkça tanımlar: `WagmiProvider` → `QueryClientProvider` → `ErrorBoundary` → `App`. Bu sıralama frontend'in wallet erişimi, veri önbelleği ve render hata izolasyonunun hangi sınırda kurulduğunu belirler.
- `ErrorBoundary` provider katmanlarının **içine** alınır; böylece connector/provider kaynaklı altyapı sorunları ile salt UI render sorunları aynı çökme yüzeyine toplanmaz. Amaç, provider altyapısı ayakta kalırken yalnız `App` ve alt render ağacının yakalanmasıdır.
- Frontend zincir önceliği ortama göre ayrılır:
  - production: `base → baseSepolia`
  - development: `hardhat → baseSepolia → base`
  Bu tercih, geliştirme sırasında cüzdanın yanlışlıkla Base ana ağına öncelik vermesini engelleyen UX/bootstrap politikasıdır.
- Connector yüzeyi bilinçli olarak dardır: `injected()` ve `coinbaseWallet()` aktiftir; `WalletConnect` geçici olarak kapalıdır. Bu nedenle desteklenen wallet matrisi frontend bootstrap katmanında fiilen sınırlanmıştır.
- `getCodespacesRPC()` helper'ı development bağlamında Hardhat RPC'yi tarayıcının bulunduğu host'a göre dinamik çözer; localhost'ta `127.0.0.1:8545`, Codespaces benzeri tünel ortamlarında ise host dönüştürmeli HTTPS endpoint kullanır.
- Bu bootstrap katmanı, query önbelleği (`QueryClient`) ile wallet/provider katmanını aynı kök ağacında birleştirir; dolayısıyla kontrat okumaları, connector state'i ve App düzeyi veri akışları aynı render yaşam döngüsü içinde orkestre edilir.
- `main.jsx` bu nedenle yalnız entrypoint değildir; frontend'in **wallet erişim yüzeyi**, **network önceliği** ve **render izolasyon sınırı** burada tanımlanır.

### 15.9 App.jsx Pazar Yeri, Listing Oluşturma ve Escrow Başlatma Orkestrasyonu

- `fetchListings()` market kartlarını backend listing yüzeyinden üretir; ancak kart üstündeki bazı metrikler (`successRate`, `txCount`) placeholder/default değerdir ve kontrat otoritesi yerine geçmez.
- `renderMarket()` içindeki buy butonu çok katmanlı UI gate uygular: signed session, kendi ilanı olmaması, tier uygunluğu, pause durumu, token config, doğru ağ, anti-sybil bakiye ve cooldown görünürlüğü. Bu gate'ler kullanıcıyı yönlendirir; kontrat enforcement'ının yerine geçmez.
- `handleOpenMakerModal()` yeni listing akışını hem maintenance (`isPaused`) hem de signed-session guard ile korur; maker yüzeyi yalnız wallet bağlı diye açılmaz.
- `handleCreateEscrow()` listing oluşturmayı tek adım sanmaz. Önce backend canonical listing hazırlığı yapılır, sonra allowance/oran hesaplarıyla on-chain create çağrılır. Listing hazırlığı ile on-chain create arasındaki bağ `listing_ref` ile kurulur.
- `handleCreateEscrow()` hata alırsa prepared listing'i silmeye ve allowance'ı sıfırlamaya çalışır; bu davranış frontend'in tutarlılık çabasıdır, ancak ağ veya backend hatalarında tam atomik rollback garantisi vermez.
- `handleStartTrade()` taker akışında önce on-chain `getTrade()` ile gerçek miktar ve token adresini okumaya çalışır; UI cache'i yerine kontrat state'ine öncelik verir. Ardından gerekiyorsa `approve()` ve sonra `lockEscrow()` çağrılır.
- `handleStartTrade()` sonrası backend mirror gecikirse App bunu fatal hata diye yorumlamaz; `_pendingBackendSync` durumuyla trade room'u açıp event listener'ın Mongo kaydını yetiştirmesine tolerans tanır.
- Market ekranındaki `handleMint()` butonları production protokol akışının parçası değil, test/faucet yüzeyidir; buna rağmen aynı App katmanında yer aldığı için deploy bağlamı ile test bağlamı kolay karışabilir.

### 15.10 App.jsx Trade Room Kritik Aksiyon Orkestrasyonu

- `handleFileUpload()`, trade room'da dekont taşıma katmanıdır; dosya doğrudan kontrata gitmez. Backend'e multipart upload yapılır, backend şifreli payload'ın SHA-256 hash'ini döner ve UI bunu `paymentIpfsHash` state'inde saklar. Tarihsel “ipfsHash” adı korunmuş olsa da App düzeyinde bu değer gerçekte şifreli backend payload'ın özeti olarak kullanılır.
- `handleReportPayment()`, bu hash hazır değilse kontrat çağrısını açmaz. Böylece “dekontu yükledim” ile “zincire ödeme beyanı düştü” iki ayrı eşiğe bölünür; App, kullanıcıyı kanıt yüklemeden on-chain `reportPayment()` çağrısına sürüklemez.
- `handleProposeCancel()`, App içinde hibrit bir cancel protokolü kurar: nonce kontrattan okunur, imza frontend'de üretilir, önce backend coordination rotasına gönderilir, yalnız `bothSigned` dönünce on-chain cancel çağrısı yapılır. Bu, mutual cancel'ın saf kontrat helper'ı değil, App seviyesinde koordine edilen çok adımlı akış olduğunu gösterir.
- `handleChargebackAck()` tek başına backend veya kontrat etkisi üretmez; yalnız `chargebackAccepted` UI state'ini günceller. Asıl audit/log yazımı `handleRelease()` içinde backend route'una best-effort olarak yapılır.
- `handleRelease()`, `PAID` durumunda chargeback onayını zorunlu tutar; `CHALLENGED` durumunda bu istemci guard'ını atlar ve doğrudan `releaseFunds()` yolunu açar. Böylece App, aynı kontrat fonksiyonunun iki ayrı operasyonel bağlamını bilinçli biçimde ayırır.
- `handleChallenge()`, maker itiraz yolunu App içinde iki faza böler: önce `pingTakerForChallenge()`, daha sonra timeout dolunca `challengeTrade()`. Her iki fazdan sonra `fetchMyTrades()` çağrılarak polling beklenmeden UI gerçek trade state'e yaklaştırılır.
- `handlePingMaker()` ve `handleAutoRelease()` taker tarafında alternatif timeout yolunu temsil eder. App, bu yolun görünürlüğünü derived timer'larla (`makerPingEndDate`, `makerChallengePingEndDate`, `makerChallengeEndDate`) yönetir; ancak bu zaman kapıları UX rehberidir, enforcement yine kontrattadır.
- `renderTradeRoom()` yalnız state gösterimi yapmaz; hangi kritik aksiyonun hangi anda görünür/etkin olacağını App düzeyinde koşullu olarak yönetir. Bu nedenle trade room ekranı, kontrat mantığını tüketen pasif bir view değil, yüksek etkili bir uygulama orkestrasyon yüzeyidir.

### 15.11 App.jsx Profil Merkezi, PII Yönetimi, Geçmiş ve Feedback Orkestrasyonu

- `showProfileModal` açıldığında App, profile merkezini yalnız görsel ayar paneli gibi ele almaz; signed session koruması altındaki kullanıcı kontrol yüzeyi olarak kullanır. `profileTab === 'ayarlar'` olduğunda mevcut PII, `/api/pii/my` çağrısı ile form state'ine hydrate edilir.
- Bu profile merkezi hibrittir: `handleUpdatePII()` off-chain/backend session korumalı PII update akışını yönetirken, `handleRegisterWallet()` aynı merkez içinden ayrı bir on-chain registration tx'i başlatır. Böylece kullanıcı ayar alanı, backend session tabanlı yönetim ile kontrat onboarding eylemini tek yüzeyde toplar.
- PII frontend'de kalıcı cache'e alınmaz; ancak profile modal açıkken `piiBankOwner`, `piiIban` ve `piiTelegram` form state'lerinde kısa ömürlü olarak bulunabilir. Bu nedenle profile UX'i, reveal bileşeninden farklı ama yine sınırlı ömürlü bir istemci maruziyeti modeli taşır.
- `getSafeTelegramUrl()` ile Telegram yönlendirmesi sanitize edilir; bu, URL enjeksiyonu riskini azaltır fakat karşı taraf hesabının gerçekliğini kanıtlamaz. Profile merkezi bu nedenle iletişim güvenilirliğini değil, yalnız güvenli bağlantı biçimini yönetir.
- Trade history görünümü global sürekli cache değildir; profile modalın `gecmis` sekmesi aktifken `/api/trades/history?page=...&limit=5` ile çekilir ve `tradeHistoryPage`, `tradeHistoryTotal`, `tradeHistoryLimit` state'leri üzerinden sayfalı kullanıcı perspektifi sunar. Bu görünüm tam denetim izi değil, kapatılmış işlemlerin özetlenmiş kullanıcı arşividir.
- Feedback modalı serbest metin alanı olmasına rağmen düzensiz metin toplama yüzeyi değildir; yıldız puanı, kategori ve minimum açıklama uzunluğu gibi guard'larla yapılandırılır. Amaç, UX/ürün geri bildirimini sınıflı ve maliyet azaltıcı biçimde toplamaktır.
- `submitFeedback()` signed session korumalı `authenticatedFetch('/api/feedback')` ile çalışır; başarıda form state sıfırlanır ve modal kapanır. Bu nedenle feedback yüzeyi anonim kamu kutusu değil, wallet-bağlı ürün geri bildirimi kanalıdır.
- Modal içindeki açık güvenlik uyarısı (private key, seed phrase, bankacılık parolası paylaşmama) kullanıcı kaynaklı hassas veri sızıntısı riskini azaltmayı amaçlar; ancak serbest metin alanı tamamen risksiz bir sır saklama yüzeyi değildir.

### 15.12 App.jsx Okuma, Polling ve Senkronizasyon Orkestrasyonu

- `App.jsx`, tüm veriyi tek kaynaktan okumaz. Fee, decimals, bleeding amounts, reputation, anti-sybil ve pause gibi ekonomik/kural yüzeyleri kontrat read helper'larıyla toplarken; protocol stats ve aktif trade odası görünümü için backend aggregation/mirror katmanını kullanır.
- `fetchFeeBps()` ve `loadTokenDecimals()` kullanıcıya gösterilen ekonomik metinleri sabit sayılarla değil, on-chain konfigürasyonla hizalamaya çalışır. Ancak read helper fallback'leri (`10`, `6`, `0`) gerçek kontrat okuması başarısız olduğunda güvenli varsayımlar da üretebilir.
- `fetchAmounts()` challenged trade bağlamında `getCurrentAmounts()` yüzeyini periyodik okuyarak trade room'daki bleeding görünümünü canlı kontrat state'ine yaklaştırır; bu nedenle challenged oda UI'ı backend cache'ten ziyade kontrat read'ine yaslanır.
- `fetchUserReputation()`, `fetchSybil()` ve `fetchPausedStatus()` App düzeyinde itibar, anti-sybil ve maintenance görünürlüğünü kontrattan taşır. Böylece kullanıcıya gösterilen tier/cooldown/pause bağlamı backend yorumundan değil, mümkün olduğunca sözleşme yüzeyinden beslenir.
- `fetchMyTrades()` ve `fetchStats()` ise farklı amaçla backend'e yaslanır: ilki trade room/oda projection'ı ve aktif trade bootstrap'ı için, ikincisi ana sayfa/özet kartlarda hızlı aggregation ve tarihsel karşılaştırma için kullanılır. Bu yüzden App içindeki trade/stats yüzeyleri kontrat storage'ının birebir render'ı gibi yorumlanmamalıdır.
- Polling, bu App mimarisinin açık parçasıdır. Challenge/bleeding, anti-sybil, pause ve active trade yüzeyleri interval tabanlı re-sync ile güncellenir; frontend burada pasif bir ekran değil, canlı runtime synchronizer gibi davranır.
- `onVisibilityChange` davranışı sekme yeniden görünür olduğunda aktif trade görünümünü tazeler. Bu mekanizma uzun süre arka planda kalan sekmelerde stale UI riskini azaltır; ancak enforcement değil, yalnız UI doğruluğunu artıran savunmacı bir tekrar okuma katmanıdır.

### 15.13 App.jsx Uygulama İskeleti, Uyarı Katmanı, Navigasyon ve Hukuki Kabul Yüzeyi

- `renderTermsModal`, App seviyesinde yalnız bilgi veren bir modal değil; ilk kullanımda yerel kabul kaydı (`araf_terms_accepted`) oluşturan **hukuki/operasyonel kabul kapısı** olarak çalışır. Kullanıcıya hakemsiz model, bleeding riski ve chargeback sorumluluğu açıkça gösterilir; buna rağmen bu kabul, kontrat enforcement veya fon güvenliği garantisi üretmez.
- `EnvWarningBanner`, eksik veya hatalı ortam değişkenlerini görünür kılan istemci tarafı bir **config görünürlük yüzeyi**dir. Bu katman deployment/config bozukluğunu gizlememeye yarar; fakat doğru kontrat adresi, güvenli RPC veya eksiksiz env kurulumu garanti etmez.
- `showToast`, App içinde geçici işlem geri bildirimi ve güvenlik uyarısı kanalıdır. Revert, başarı ve bilgilendirme akışları bu kanal üzerinden görünür hale gelir; fakat toast içeriği hiçbir zaman kontrat state'i, backend mirror veya kesin işlem sonucu yerine geçirilmemelidir.
- `openSidebar`, `renderSlimRail`, `renderContextSidebar` ve `renderMobileNav` birlikte cihaz ve bağlama göre değişen **çok yüzeyli navigasyon iskeleti** kurar. Masaüstü rayı, bağlamsal yan panel ve mobil alt navigasyon farklı erişim ergonomileri sağlar; ancak bunlar farklı güvenlik modeli değil, aynı uygulama state'inin farklı sunum katmanlarıdır.
- `renderHome`, ana sayfayı yalnız landing/pazarlama ekranı olarak kullanmaz; onboarding, beklenti yönetimi, protokol anlatımı, FAQ ve özet istatistik yüzeyi olarak da çalışır. Kullanıcının oracle-free ve hakemsiz modele zihinsel olarak hazırlanması bu katmanda başlar.
- `renderFooter`, kamusal protokol kimliğini ve dağıtım uyarlanabilirliğini taşır. Sosyal linklerin env tabanlı override edilebilmesi, frontend dağıtımlarında kaynak kod değiştirmeden kamusal yönlendirme yapılabildiğini gösterir.
- `isPaused`, yanlış chain, wallet registration eksikliği veya anti-sybil bekleme süresi gibi durumlar App iskeletinde yüksek görünürlüklü banner'larla öne çıkarılır. Bu banner'lar **yüksek görünürlüklü guard rail** işlevi görür; fakat kontrat enforcement yerine geçmez.

### 15.14 App.jsx Root Orchestration, Pending-Tx Recovery ve Auto-Resume

- `App` artık yalnız büyük bir ekran bileşeni olarak değil, frontend çalışma zamanının **root orchestrator** katmanı olarak değerlendirilmelidir. Banner'lar, ray navigasyonu, bağlamsal sidebar, ana içerik, footer, modal'lar ve toast yüzeyi aynı kök state ve effect ağı üzerinde birlikte koordine edilir.
- `araf_pending_tx` izi sayfa yenilemesinde kaybolmaması için istemci tarafında korunur. App açılışında bu iz tekrar okunur; receipt doğrulanabilirse iz temizlenir, kullanıcıya toast verilir ve trade verileri yeniden çekilerek UI mümkün olduğunca zincir üstü sonuca yaklaştırılır. Bu davranış convenience/recovery katmanıdır; tek başına kesin durum sayılmaz.
- Auth/refresh sonrası veya tekrar görünür bağlama dönüldüğünde, tek aktif trade varsa App kullanıcıyı uygun trade room bağlamına geri taşıyabilir. Bu **auto-resume** davranışı kullanıcı akışını sürdürür; fakat trade odasına dönmek işlemin hukuki veya ekonomik olarak kesinleştiği anlamına gelmez.
- `bind` ve ilişkili provider listener lifecycle'ı App'in kök güvenlik mekaniklerinden biridir. Wallet runtime event'leri (hesap değişimi, disconnect, chain değişimi) listener seviyesinde bağlanır ve cleanup ile sökülür; bu sayede session invalidation yalnız bootstrap anında değil, runtime boyunca yaşayan bir mekanizma haline gelir.
- Bu nedenle `App.jsx`, frontend tarafında yalnız render kararları değil; **pending-tx dayanıklılığı, runtime güvenlik listener'ları ve bağlam geri kurma** işlevlerini de taşır.

### 15.15 App.jsx Türetilmiş Zaman Katmanı, Effect Scheduler ve Dönüşüm Sınırları

- `gracePeriodEndDate`, `bleedingEndDate`, `principalProtectionEndDate`, `makerPingEndDate`, `makerChallengePingEndDate` ve `makerChallengeEndDate` gibi zaman anchor'ları App içinde `useMemo` ile türetilir ve `useCountdown` ile görselleştirilir. Bu yapı, trade room'un zaman kapılı UX davranışını App düzeyinde kurar; ancak kontrat enforcement yerine geçmez.
- `App.jsx` içindeki geniş `useEffect` ağı (polling, listener, startup probe, pending-tx recovery, görünürlük senkronizasyonu) pasif state depolama değil, aktif bir **effect scheduler** davranışı oluşturur. Cleanup callback'leri bu yüzden mimari olarak önemlidir; interval ve listener'ların zombi şekilde kalmaması App güvenilirliğinin parçasıdır.
- `formatTokenAmountFromRaw` ve `rawTokenToDisplayNumber`, raw/base-unit zincir verisini kullanıcı dostu metne ve bazı UI hesaplarına dönüştüren ayrı bir **gösterim/dönüşüm sınırı** kurar. Bu katman bilerek otoritatif ekonomik kaynak değildir; kullanıcıya gösterilen normalize sayı ile kontratın gerçek ham miktarı arasında ayrım korunmalıdır.
- `StatChange`, `formatAddress` ve `getWalletIcon` gibi yardımcılar çoğunlukla sunum odaklıdır; protokol kuralı taşımazlar. Buna karşılık miktar dönüştürme yardımcıları ekonomik algıyı etkilediği için mimari olarak daha yüksektir.
- Render içine gömülü IIFE / inline hesaplama blokları, App'te bazı iş kuralı veya state-machine yorumlarının doğrudan JSX içinde yaşadığını gösterir. Bu bir hata kanıtı değildir; fakat zamanla belge ile gerçek render-side mantık arasında drift üretme riski taşıdığı için görünür şekilde notlanmalıdır.

### 15.16 Mimari Sonuç

Bu katman, protokol güvenlik modelini değiştirmez; yalnızca kullanıcı hatalarını, görünmez runtime kopukluklarını ve gereksiz işlem maliyetini azaltır:

- ✅ On-chain state machine değişmedi.
- ✅ Hakemlik ve backend takdiri eklenmedi.
- ✅ PII varsayılan gizli kalır; reveal, hide, fetch ve clipboard akışı savunmacı UX ile sınırlandırılır.
- ✅ Frontend countdown mantığı, on-chain zaman pencerelerini istemci tarafında yanlış aktif/pasif göstermemek için senkronize edilir; ancak countdown **yetki vermez**, nihai doğrulama backend ve kontrat katmanındadır.
- ✅ Frontend crash'leri kullanıcı deneyimini bozmadan merkezi log yüzeyine, scrub edilmiş biçimde ve best-effort mantığıyla iletilir.
- ✅ Frontend kontrat erişimi, yanlış ağ / eksik kontrat adresi / eksik allowance gibi kullanıcı kaynaklı zincir üstü hataları preflight kontrolleri ve helper read yüzeyleri ile daraltır.
- ✅ Pending transaction izi istemci tarafında geçici olarak korunur; zincir üstü işlem görünürlüğü sayfa yenilemesiyle tamamen kaybolmaz.
- ✅ App kök katmanı, pending-tx recovery, auto-resume ve provider listener lifecycle ile yalnız ekran değil, canlı bir frontend runtime orchestrator gibi davranır.
- ✅ Türetilmiş zaman pencereleri ve countdown yüzeyi kullanıcıyı doğru aksiyona yönlendirmeyi amaçlar; ama ekonomik doğruluk ve enforcement kaynağı olmaya devam etmez.
- ✅ UX iyileştirmesi = daha düşük operasyonel sürtünme, daha az destek yükü.

---

### Hibrit Neden Dürüsttür

**Merkeziyetsizleştirdiğimiz (kritik kısımlar):**
- ✅ Fon emaneti — emanet tutmayan akıllı sözleşme
- ✅ Uyuşmazlık çözümü — zaman bazlı, insan kararı yok
- ✅ İtibar bütünlüğü — değiştirilemez on-chain kayıtlar
- ✅ Anti-Sybil zorunluluğu — on-chain kontroller

**Merkezileştirdiğimiz (gizlilik / performans):**
- ⚠️ PII depolama — GDPR, silme yeteneği gerektiriyor
- ⚠️ Emir defteri indekslemesi — UX için saniye altı sorgular
- ⚠️ Rate limit / nonce / checkpoint koordinasyonu — kısa ömürlü operasyonel state

**Backend ASLA kontrol etmez:**
- ❌ Fon emaneti | ❌ Uyuşmazlık sonuçları | ❌ İtibar puanları | ❌ İşlem durum geçişleri

---

*Araf Protokolü — "Sistem yargılamaz. Dürüstsüzlüğü pahalıya mal eder."*