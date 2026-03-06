# 🌀 Araf Protokolü — Kanonik Mimari & Teknik Referans

> **Versiyon:** 2.0 | **Ağ:** Base (Katman 2) | **Durum:** Mainnet Hazır | **Son Güncelleme:** Mart 2026

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
| **Sıfır Özel Anahtar Backend** | Backend sunucusu hiçbir cüzdan anahtarı tutmaz ve fonları hareket ettiremez. |

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
| Hız Sınırlama / Nonce | Bellekte | Redis | 5 dakika TTL, kayan pencere, tekrar koruması |

### Teknoloji Yığını

| Katman | Teknoloji | Detaylar |
|---|---|---|
| Akıllı Sözleşme | Solidity + Hardhat | 0.8.24 — Base L2 (Chain ID 8453) |
| Backend | Node.js + Express | CommonJS, Sıfır Özel Anahtar Relayer |
| Veritabanı | MongoDB + Mongoose | v8.x — İlanlar, İşlemler, Kullanıcılar |
| Önbellek / Auth | Redis | v4.x — Hız limitleri, Nonce'lar, DLQ |
| Şifreleme | AES-256-GCM + HKDF | Zarf şifreleme, cüzdan başına DEK |
| Kimlik Doğrulama | SIWE + JWT (HS256) | EIP-4361, 15 dakika geçerlilik |
| Frontend | React 18 + Vite + Wagmi | Tailwind CSS, viem, EIP-712 |
| Sözleşme ABI | Deploy'da otomatik oluşturulur | `frontend/src/abi/ArafEscrow.json` |

### Sıfır Güven Backend Modeli

Off-chain altyapı kullanılmasına rağmen **backend fonları çalamaz veya sonuçları manipüle edemez:**

```
✅ Backend'in SIFIR özel anahtarı vardır (Relayer deseni)
✅ Backend escrow serbest bırakamaz (yalnızca kullanıcılar imzalayabilir)
✅ Backend Bleeding Escrow zamanlayıcısını atlayamaz (on-chain zorunlu)
✅ Backend itibar puanlarını sahte gösteremez (on-chain doğrulanır)
⚠️  Backend PII'yı şifre çözebilir (UX için zorunlu kötülük — hız sınırlama + denetim logları ile azaltılmış)
```

---

## 3. Sistem Katılımcıları

| Rol | Etiket | Yetenekler | Kısıtlamalar |
|---|---|---|---|
| **Maker** | Satıcı | İlan açar. USDT + Teminat kilitler. Serbest bırakabilir, itiraz edebilir, iptal önerebilir. | Kendi ilanında Taker olamaz. Teminat işlem çözülene kadar kilitli kalır. |
| **Taker** | Alıcı | Fiat'ı off-chain gönderir. Taker Teminatı kilitler. Ödeme bildirebilir, iptal onaylayabilir. | Anti-Sybil filtrelerine tabidir. Yasaklanabilir (yalnızca Taker kısıtlaması). |
| **Hazine** | Protokol | %0.2 başarı ücreti + eriyip/yanan fonları alır. | Adres deploy sırasında belirlenir — backend tarafından değiştirilemez. |
| **Backend** | Relayer | Şifreli PII'yı depolar, emir defterini indeksler, JWT yayınlar, API sunar. | Sıfır özel anahtar. Fonları hareket ettiremez. On-chain durumu değiştiremez. |

---

## 4. Tier ve Teminat Sistemi

5 kademeli sistem **"Soğuk Başlangıç" sorununu** çözer: yeni cüzdanlar yüksek hacimli işlemlere anında erişemez, böylece deneyimli kullanıcılar test edilmemiş karşı taraflardan korunur. Tüm teminat sabitleri on-chain zorunlu kılınmıştır ve backend tarafından değiştirilemez.

### Tier Tanımları

| Tier | TRY Limiti | Maker Teminatı | Taker Teminatı | Cooldown | Yükseltme Eşiği |
|---|---|---|---|---|---|
| **Tier 0** | 250 – 5.000 ₺ | %0 | %0 | 24 saat / işlem | Yeni kullanıcı teşviki — giriş kapısı, teminat yok |
| **Tier 1** | 5.001 – 50.000 ₺ | %8 | %10 | 24 saat / işlem | Varsayılan olarak açık |
| **Tier 2** | 50.001 – 250.000 ₺ | %6 | %8 | Sınırsız | 50 başarılı + 100B TRY hacim + ≤1 başarısız |
| **Tier 3** | 250.001 – 1.000.000 ₺ | %5 | %5 | Sınırsız | 100 başarılı + 500B TRY hacim + ≤1 başarısız |
| **Tier 4** | 1.000.001+ ₺ | %2 | %2 | Sınırsız | 200 başarılı + 2M TRY hacim + 0 başarısız |

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
| **Dust Limiti** | Yerel bakiye ≥ 0,001 ETH (Base'de ~2$) | Sıfır bakiyeli tek kullanımlık cüzdanları engeller |
| **Tier 0 / 1 Cooldown** | Maksimum 24 saatte 1 işlem | Düşük teminatlı tierlerde bot ölçekli spam saldırısını sınırlar |
| **Challenge Cooldown** | PAID durumundan sonra ≥ 1 saat beklemek zorunlu | Makbuz yüklemesinde anlık tacizi önler |

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
| `CANCELED` (İptal) | 2/2 EIP-712 imzası | Tam iade. Ücret yok. Teminatlar tamamen iade edildi. |
| `BURNED` (Yakıldı) | 240 saattan sonra `burnExpired()` | Tüm kalan fonlar → Hazine. |

### Ücret Modeli

- **Taker ücreti:** Taker'ın aldığı USDT'den %0,1 kesilir
- **Maker ücreti:** Maker'ın teminat iadesinden %0,1 kesilir
- **Toplam:** Başarıyla çözülen her işlemde %0,2
- **İptal edilen işlemler:** Ücret alınmaz

---

## 7. Uyuşmazlık Sistemi — Bleeding Escrow

Araf Protokolünde hakem yoktur. Bunun yerine, uzun süreli uyuşmazlıkları matematiksel olarak pahalıya mal eden **asimetrik zaman çürümesi mekanizması** kullanılır. Bir taraf ne kadar uzun süre iş birliği yapmayı reddederse, o kadar çok kaybeder.

### Tam Durum Makinesi

```
ÖDENDİ
  │
  ├──[Maker Serbest Bırak'a basar]──────────────── ÇÖZÜLDÜ ✅
  │
  └──[Maker İtiraz Et'e basar]
          │
        GRACE PERIOD (48 saat) — mali ceza yok
        ├──[Müşterek İptal (2/2 EIP-712)]────────── İPTAL 🔄
        ├──[Karşılıklı Serbest Bırakma]──────────── ÇÖZÜLDÜ ✅
        │
        └──[48 saat sonra anlaşma yok]
                    │
                KANAMA ⏳ (özerk on-chain çürüme)
                ├── Taker teminatı: 42 BPS/saat
                ├── Maker teminatı: 26 BPS/saat
                ├── USDT (her iki taraf): 34 BPS/saat (Kanama'nın 96. saatinde başlar)
                │
                ├──[İstediği zaman serbest bırakma]── ÇÖZÜLDÜ ✅ (kalan fonlar)
                ├──[İptal (2/2)]──────────────────── İPTAL 🔄 (kalan fonlar)
                └──[240 saat geçti — anlaşma yok]
                          │
                        YAKILD 💀 (tüm fonlar → Hazine)
```

### Kanama Çürüme Oranları

| Varlık | Taraf | Oran | Başlangıç |
|---|---|---|---|
| **Taker Teminatı** | Taker (itiraz açan) | 42 BPS / saat (~günde %10,1) | Kanama'nın 0. saati |
| **Maker Teminatı** | Maker | 26 BPS / saat (~günde %6,2) | Kanama'nın 0. saati |
| **USDT** | Her iki taraf eşit | 34 BPS / saat (~günde %8,2) | Kanama'nın 96. saati |

> **USDT neden Kanama'nın 96. saatinde (itirazdaki 144. saatte) başlar?**
> 48 saatlik grace period + hafta sonu banka gecikmelerine karşı 96 saatlik tampon. Dürüst tarafları anında zarar görmekten korurken aciliyeti sürdürür.

### Müşterek İptal (EIP-712)

Her iki taraf da `LOCKED`, `PAID` veya `CHALLENGED` durumunda karşılıklı çıkış önerebilir. Her ikisi de off-chain olarak bir EIP-712 tipli mesaj imzalamalıdır. İmzalar backend'de toplandıktan sonra taraflardan biri on-chain'e gönderir. Tam iade, ücret yok, itibar cezası yok.

İmza tipi: `CancelProposal(uint256 tradeId, address proposer, uint256 nonce, uint256 deadline)`

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

**Tetikleyici:** 2 veya daha fazla `failedDisputes`. Yasak **yalnızca Taker'a** uygulanır — yasaklanan cüzdanlar Maker olarak ilan açmaya devam edebilir.

| Yasak Sayısı | Süre | Tier Etkisi | Notlar |
|---|---|---|---|
| 1. yasak | 30 gün | Tier değişimi yok | `consecutiveBans = 1` |
| 2. yasak | 60 gün | `maxAllowedTier −1` | `consecutiveBans = 2` |
| 3. yasak | 120 gün | `maxAllowedTier −1` | `consecutiveBans = 3` |
| N. yasak | 30 × 2^(N−1) gün (maks. 365) | Her yasakta `maxAllowedTier −1` (alt sınır: Tier 0) | Kalıcı on-chain hafıza |

> **Tier Tavanı Zorunluluğu:** `createEscrow()`, istenen tier > `maxAllowedTier` ise revert eder.
> Örnek: Tier 3 cüzdan 2. yasağı alır → `maxAllowedTier` 2'ye düşer. Tier 3 veya Tier 4 ilan açamaz.

---

## 9. Güvenlik Mimarisi

### 9.1 Kimlik Doğrulama Akışı (SIWE + JWT)

| Adım | Aktör | İşlem | Güvenlik Özelliği |
|---|---|---|---|
| 1 | Frontend | `GET /api/auth/nonce` | Nonce Redis'te 5 dakika TTL ile saklanır |
| 2 | Kullanıcı | Cüzdanda EIP-4361 SIWE mesajı imzalar | `siwe.SiweMessage` sınıfı ile standart format |
| 3 | Frontend | `POST /api/auth/verify` — mesaj + imza | Nonce atomik olarak tüketilir (`getDel` — tekrar korumalı) |
| 4 | Backend | SIWE imzasını doğrular, JWT yayınlar (HS256, 15 dk) | JWT'de `type: "auth"` talebi var, PII içermez |
| 5 | Frontend | Tüm korumalı API çağrıları için Bearer token olarak JWT | Her rota `requireAuth` middleware'ini çağırır |

### 9.2 PII Şifreleme (Zarf Şifreleme)

IBAN ve banka sahibi adı yalnızca MongoDB'de, AES-256-GCM ile şifreli olarak saklanır. Master Key hiçbir zaman KMS ortamından çıkmaz. Her cüzdan, HKDF (RFC 5869, SHA-256) ile deterministik olarak türetilmiş benzersiz bir Veri Şifreleme Anahtarı (DEK) alır.

| Özellik | Değer |
|---|---|
| Algoritma | AES-256-GCM (doğrulanmış şifreleme) |
| Anahtar Türetme | HKDF (SHA-256, RFC 5869) — yerel Node.js crypto |
| DEK Kapsamı | Cüzdan başına benzersiz DEK — hiçbir zaman yeniden kullanılmaz |
| Master Key Depolama | Ortam değişkeni (geliştirme) / AWS KMS veya Vault (üretim) |
| Ham IP Depolama | Hiçbir zaman saklanmaz. Yalnızca SHA-256(IP) hash'i — GDPR uyumlu |
| IBAN Erişim Akışı | Auth JWT → PII token (15 dk, işlem kapsamlı) → şifre çözme |

### 9.3 Hız Sınırlama

| Endpoint Grubu | Limit | Pencere | Anahtar |
|---|---|---|---|
| PII / IBAN | 3 istek | 10 dakika | IP + Cüzdan |
| Auth (SIWE) | 10 istek | 1 dakika | IP |
| İlanlar (okuma) | 100 istek | 1 dakika | IP |
| İlanlar (yazma) | 5 istek | 1 saat | Cüzdan |
| İşlemler | 30 istek | 1 dakika | Cüzdan |
| Geri Bildirim | 3 istek | 1 saat | Cüzdan |

### 9.4 Olay Dinleyici Güvenilirliği

- **Kontrol Noktası:** Her batch sonrası son işlenen blok numarası Redis'e kaydedilir
- **Tekrar Oynatma:** Yeniden başlatmada kaçırılan bloklar kontrol noktasından taranır
- **Yeniden Deneme:** Başarısız olaylar üstel geri çekilmeyle 3 kez yeniden denenir
- **Ölü Mektup Kuyruğu (DLQ):** Tüm denemelerde başarısız olan olaylar Redis DLQ'ya yazılır
- **DLQ Monitörü:** Her 60 saniyede çalışır — DLQ ≥ 5 girdide uyarı verir
- **Yeniden Bağlanma:** RPC sağlayıcı arızasında otomatik yeniden bağlanır

---

## 10. Veri Modelleri (MongoDB)

### Kullanıcılar Koleksiyonu

| Alan | Tür | Açıklama |
|---|---|---|
| `wallet_address` | Dize (benzersiz) | Küçük harfli Ethereum adresi — birincil kimlik |
| `pii_data.bankOwner_enc` | Dize | AES-256-GCM şifreli banka sahibi adı |
| `pii_data.iban_enc` | Dize | AES-256-GCM şifreli IBAN (TR formatı) |
| `pii_data.telegram_enc` | Dize | AES-256-GCM şifreli Telegram kullanıcı adı |
| `reputation_cache.*` | Sayı | Yalnızca görüntüleme amaçlı on-chain itibar aynası — yetkili değil |
| `is_banned` / `banned_until` | Boolean / Tarih | On-chain yasak durumu aynası |
| `consecutive_bans` | Sayı (varsayılan: 0) | On-chain ardışık yasak sayısı aynası |
| `max_allowed_tier` | Sayı (varsayılan: 4) | On-chain tier tavanı aynası — yalnızca görüntüleme |
| `last_login` | Tarih | TTL: 2 yıl hareketsizlik sonrası otomatik silme (GDPR) |

### İlanlar Koleksiyonu

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
| `status` | `OPEN` \| `PAUSED` \| `COMPLETED` \| `DELETED` | İlan yaşam döngüsü durumu |
| `onchain_escrow_id` | Sayı \| null | Escrow oluşturulduğunda on-chain `tradeId` |
| `token_address` | Dize | Base'deki ERC-20 sözleşme adresi |

### İşlemler Koleksiyonu

| Alan Grubu | Temel Alanlar | Notlar |
|---|---|---|
| Kimlik | `onchain_escrow_id`, `listing_id`, `maker_address`, `taker_address` | `onchain_escrow_id` = gerçeğin kaynağı |
| Finansal | `crypto_amount`, `exchange_rate`, `total_decayed` | `total_decayed` = `BleedingDecayed` olaylarının kümülatif toplamı |
| Durum | `status` | On-chain durum makinesini yansıtır |
| Zamanlayıcılar | `locked_at`, `paid_at`, `challenged_at`, `resolved_at`, `last_decay_at` | `last_decay_at` = son `BleedingDecayed` olayı |
| Kanıt | `ipfs_receipt_hash`, `receipt_timestamp` | Ödeme makbuzunun IPFS hash'i |
| İptal Önerisi | `proposed_by`, `maker_signed`, `taker_signed`, imzalar | On-chain gönderimden önce toplanan EIP-712 imzaları |
| Chargeback Onayı | `acknowledged`, `acknowledged_by`, `acknowledged_at`, `ip_hash` | `releaseFunds` öncesi Maker'ın yasal onayı. `ip_hash = SHA-256(IP)` |
| Tier | `tier` (0–4) | İşlem oluşturma anındaki on-chain tier |

---

## 11. Hazine Modeli

| Gelir Kaynağı | Oran | Koşul |
|---|---|---|
| Başarı ücreti | %0,2 (her iki taraftan %0,1) | Her `RESOLVED` (Çözüldü) işlem |
| Taker teminat çürümesi | 42 BPS / saat | `CHALLENGED` + Kanama aşaması |
| Maker teminat çürümesi | 26 BPS / saat | `CHALLENGED` + Kanama aşaması |
| USDT çürümesi | 34 BPS / saat × 2 taraf | Kanama'nın 96. saatinden sonra |
| YAKILDI sonucu | Kalan fonların %100'ü | 240 saat içinde uzlaşma olmaması |

---

## 12. Saldırı Vektörleri ve Bilinen Sınırlamalar

| Saldırı | Risk | Azaltma | Durum |
|---|---|---|---|
| Sahte makbuz yükleme | Yüksek | İtiraz teminat cezası — çürüme maliyeti potansiyel kazançtan fazla | ⚠️ Kısmi |
| Satıcı tacizi | Orta | Asimetrik çürüme: itiraz açan (Taker) daha hızlı kaybeder | ✅ Giderildi |
| Chargeback (TRY geri alımı) | Orta | Chargeback onay logu + IP hash kanıt zinciri | ⚠️ Kısmi |
| Sybil itibar çiftçiliği | Düşük | Cüzdan yaşı + dust limiti + benzersiz karşı taraf ağırlıklandırması | ✅ Giderildi |
| Challenge spam (Tier 0/1) | Yüksek | 24 saatlik cooldown + dust limiti + cüzdan yaşı | ✅ Giderildi |
| Kendi kendine işlem | Yüksek | On-chain `msg.sender ≠ maker` | ✅ Giderildi |
| Tek taraflı iptal tacizi | Yüksek | 2/2 EIP-712 — tek taraflı iptal imkansız | ✅ Giderildi |
| Backend anahtar hırsızlığı | Kritik | Sıfır özel anahtar mimarisi — yalnızca relayer | ✅ Giderildi |
| JWT ele geçirme | Yüksek | 15 dakika geçerlilik + işlem kapsamlı PII tokenları | ✅ Giderildi |
| PII veri sızıntısı | Kritik | AES-256-GCM + HKDF + hız sınırı (3 / 10 dk) | ✅ Giderildi |

---

## 13. Kesinleşmiş Protokol Parametreleri

Aşağıdaki tüm değerler Solidity `public constant` olarak deploy edilmiştir — **backend tarafından değiştirilemez.**

| Parametre | Değer | Sözleşme Sabiti |
|---|---|---|
| Ağ | Base (Chain ID 8453) | — |
| Protokol ücreti | %0,2 (her iki taraftan %0,1) | `TAKER_FEE_BPS = 10`, `MAKER_FEE_BPS = 10` |
| Grace period | 48 saat | `GRACE_PERIOD` |
| USDT çürüme başlangıcı | Kanama'dan 96 saat sonra (itirazdaki 144. saat) | `USDT_DECAY_START` |
| Maksimum kanama süresi | 240 saat (10 gün) → YAKILIR | `MAX_BLEEDING` |
| Taker teminat çürüme hızı | 42 BPS / saat | `TAKER_BOND_DECAY_BPS_H` |
| Maker teminat çürüme hızı | 26 BPS / saat | `MAKER_BOND_DECAY_BPS_H` |
| USDT çürüme hızı | 34 BPS / saat × 2 | `CRYPTO_DECAY_BPS_H` |
| Minimum cüzdan yaşı | 7 gün | `WALLET_AGE_MIN` |
| Tier 0 / 1 cooldown | 24 saat / işlem | `TIER0_TRADE_COOLDOWN`, `TIER1_TRADE_COOLDOWN` |
| Challenge cooldown | PAID'dan sonra 1 saat | `CHALLENGE_COOLDOWN` |
| Dust limiti | 0,001 ETH (Base'de ~2$) | `DUST_LIMIT` |
| Temiz itibar indirimi | −%1 | `GOOD_REP_DISCOUNT_BPS = 100` |
| Kötü itibar cezası | +%3 | `BAD_REP_PENALTY_BPS = 300` |
| Yasak tetikleyici | 2+ başarısız uyuşmazlık | `_updateReputation()` |
| 1. yasak süresi | 30 gün | Eskalasyon: `30 × 2^(N−1)` gün |
| Maksimum yasak süresi | 365 gün | Sözleşmede üst sınır zorunlu |

---

## 14. Gelecek Evrim Yolu

| Faz | Kapsam | Zaman Çizelgesi | Açıklama |
|---|---|---|---|
| **Faz 1 (Mevcut)** | Web2.5 Hibrit | Yayında | On-chain escrow + durum makinesi. Off-chain PII + emir defteri. |
| **Faz 2** | ZK IBAN Doğrulama | 2–3 yıl | "TRY doğru IBAN'a gönderildi" kanıtı, IBAN'ı on-chain açıklamadan. Bankacılık altyapısının gelişmesini gerektirir. |
| **Faz 3** | On-Chain Emir Defteri | İsteğe Bağlı | Emir defteri indeksleme için The Graph Protocol subgraph. MongoDB'ye kıyasla maliyet etkin olduğunda geçiş. |
| **Faz 4** | Çoklu Para Birimi | Faz 2 Sonrası | TRY / USD / EUR dışında fiat desteğini genişletme. Ödeme doğrulaması için ZK katmanı gerektirir. |

### Hibrit Neden Dürüsttür

**Merkeziyetsizleştirdiğimiz (kritik kısımlar):**
- ✅ Fon emaneti — emanet tutmayan akıllı sözleşme
- ✅ Uyuşmazlık çözümü — zaman bazlı, insan kararı yok
- ✅ İtibar bütünlüğü — değiştirilemez on-chain kayıtlar
- ✅ Anti-Sybil zorunluluğu — on-chain kontroller

**Merkezileştirdiğimiz (gizlilik / performans):**
- ⚠️ PII depolama — GDPR, silme yeteneği gerektiriyor
- ⚠️ Emir defteri indekslemesi — UX için saniye altı sorgular

**Backend ASLA kontrol etmez:**
- ❌ Fon emaneti | ❌ Uyuşmazlık sonuçları | ❌ İtibar puanları | ❌ İşlem durum geçişleri

---

*Araf Protokolü — "Sistem yargılamaz. Dürüstsüzlüğü pahalıya mal eder."*
