# 🌀 Araf Protokolü: Operasyonel Maliyet Muhasebesi

> **Versiyon:** 1.0 | **Son Güncelleme:** Mart 2026

Bu doküman, Araf Protokolü'nün Web2.5 Hibrit Mimarisi'nin operasyonel maliyetlerini on-chain ve off-chain bileşenler bazında analiz eder.

---

## 1. Felsefe: Otonom ve Maliyet-Etkin Büyüme

Araf Protokolü, "insansız" ve "hakemsiz" olmasının yanı sıra, minimum operasyonel maliyetle çalışacak şekilde tasarlanmıştır. Maliyetlerin büyük bir kısmı, protokolün başarısıyla doğru orantılı olarak artan değişken maliyetlerdir. Sabit maliyetler ise oldukça düşüktür.

---

## 2. On-Chain Maliyetler (Gas Ücretleri)

Tüm on-chain maliyetler, Base (Layer 2) ağı üzerinde ödenen gas ücretleridir. Bu maliyetler, protokolün kendisi tarafından değil, işlemi başlatan cüzdan tarafından ödenir.

| İşlem Türü | Maliyeti Kim Öder? | Protokol İçin Maliyet? | Notlar |
| :--- | :--- | :--- | :--- |
| **Kullanıcı İşlemleri** | **Kullanıcı** | **Hayır** | `createEscrow`, `lockEscrow`, `releaseFunds`, `challengeTrade` gibi tüm temel akış işlemleri kullanıcılar tarafından karşılanır. |
| **Protokol Yönetim İşlemleri** | **Protokol (Relayer Cüzdanı)** | **Evet** | Protokolün otonom işleyişi için periyodik olarak çalıştırılması gereken, gas ücreti protokol tarafından ödenen işlemlerdir. |

### Protokolün Karşıladığı On-Chain Maliyetler

Bu maliyetler, protokolün "Relayer" cüzdanı tarafından karşılanan ve doğrudan operasyonel gider olarak kabul edilen gas ücretleridir.

#### `decayReputation(address)`
*   **Tetikleyen:** `reputationDecay.js` periyodik görevi (örn: 24 saatte bir).
*   **Amaç:** "Temiz Sayfa" kuralını uygulamak ve eski yasakları olan kullanıcıların `consecutiveBans` sayacını sıfırlamak.
*   **Maliyet Sürücüsü:** İtibarı temizlenecek kullanıcı sayısı.
*   **Optimizasyon:** Görev, her çalıştığında gas maliyetlerini kontrol altında tutmak için `limit(50)` gibi bir sınırlama ile çalışır. Bu sayede maliyet öngörülebilir kalır.
*   **Tahmini Etki:** **Düşük.** İşlem başına gas maliyeti düşüktür ve nadiren (günde bir kez) çalışır.

#### Yönetici Fonksiyonları (`Owner` Yetkili)
*   **Fonksiyonlar:** `setTreasury`, `setSupportedToken`, `pause`, `unpause`.
*   **Tetikleyen:** Protokol sahibi (manuel).
*   **Maliyet Sürücüsü:** Protokol güncelleme ihtiyacı.
*   **Tahmini Etki:** **Çok Düşük.** Bu fonksiyonlar sadece acil durumlarda veya büyük güncellemelerde çağrılır. Düzenli bir maliyet kalemi değildir.

---

## 3. Off-Chain Maliyetler (Backend Altyapısı)

Bu maliyetler, geleneksel bir web uygulamasının sunucu ve veritabanı maliyetleridir. Maliyetler, kullanıcı trafiği ve veri depolama ihtiyacı ile doğru orantılıdır.

### Ana Maliyet Kalemleri

#### **Compute (Sunucu)**
*   **Bileşen:** Node.js / Express API sunucusu.
*   **Sağlayıcı Örnekleri:** Vercel, Heroku, AWS EC2/Fargate.
*   **Maliyet Sürücüsü:** Eş zamanlı kullanıcı sayısı ve API istek yoğunluğu.
*   **Tahmini Etki:** **Orta.** Protokol popülerleştikçe ölçeklendirilmesi gereken ana kalemdir.

#### **Veritabanı (MongoDB)**
*   **Bileşen:** `Users`, `Listings`, `Trades`, `HistoricalStats` koleksiyonları.
*   **Sağlayıcı Örnekleri:** MongoDB Atlas (Serverless veya Cluster).
*   **Maliyet Sürücüsü:**
    1.  **Depolama:** En büyük koleksiyon, zamanla büyüyecek olan `Trades` koleksiyonudur.
    2.  **Okuma/Yazma İşlemleri (I/O):** `GET /api/listings` ve `GET /api/stats` gibi sık çağrılan endpoint'ler.
*   **Optimizasyon:** `/api/stats` endpoint'i Redis üzerinde 1 saat boyunca önbelleğe alınarak veritabanı okuma yükü ciddi şekilde azaltılmıştır.
*   **Tahmini Etki:** **Orta.** Depolama maliyeti zamanla artacaktır.

#### **Önbellek (Redis)**
*   **Bileşen:** Hız sınırlama, SIWE nonce'ları, istatistik önbelleği, olay dinleyici DLQ'su.
*   **Sağlayıcı Örnekleri:** Upstash, Redis Labs, AWS ElastiCache.
*   **Maliyet Sürücüsü:** Bellek (RAM) boyutu.
*   **Tahmini Etki:** **Düşük.** Genellikle Redis, diğer altyapı bileşenlerine göre daha uygun maliyetlidir.

#### **PII Şifreleme (KMS - Key Management Service)**
*   **Bileşen:** Zarf Şifreleme için Master Key yönetimi.
*   **Sağlayıcı Örnekleri:** AWS KMS, Google Cloud KMS, HashiCorp Vault.
*   **Maliyet Sürücüsü:** Anahtar sayısı ve şifreleme/şifre çözme API çağrı sayısı.
*   **Tahmini Etki:** **Düşük.** Genellikle yüksek hacimli kullanımda bile maliyeti düşüktür, ancak güvenlik için vazgeçilmezdir.

#### **Loglama ve Gözlemlenebilirlik**
*   **Bileşen:** Uygulama loglarının toplanması, aranması ve analizi.
*   **Sağlayıcı Örnekleri:** Logtail, Datadog, Sentry.
*   **Maliyet Sürücüsü:** Günlük log hacmi ve veri saklama süresi.
*   **Tahmini Etki:** **Düşük'ten Orta'ya.** Trafik arttıkça log hacmi de artacaktır.

---

## 4. Maliyet Özeti ve Sonuç

| Maliyet Kalemi | Tür | Sürücü | Tahmini Etki | Notlar |
| :--- | :--- | :--- | :--- | :--- |
| **Kullanıcı Gas Ücretleri** | Değişken | Kullanıcı Aktivitesi | **Sıfır (Protokol için)** | Kullanıcılar kendi işlemlerini öder. |
| **Relayer Gas Ücretleri** | Değişken | Zaman | **Düşük** | `reputationDecay` görevi ile sınırlı. |
| **Sunucu (Compute)** | Değişken | Trafik | **Orta** | Ölçeklenmesi gereken ana kalem. |
| **Veritabanı (MongoDB)** | Değişken | Veri Boyutu / I/O | **Orta** | `Trades` koleksiyonu zamanla büyüyecek. |
| **Önbellek (Redis)** | Sabit/Değişken | RAM | **Düşük** | Veritabanı maliyetlerini düşürür. |
| **KMS (Şifreleme)** | Değişken | API Çağrıları | **Düşük** | Güvenlik için zorunlu, maliyeti düşük. |
| **Loglama** | Değişken | Log Hacmi | **Düşük** | Trafiğe bağlı olarak artar. |

**Sonuç:** Araf Protokolü'nün maliyet yapısı, "kullandıkça öde" modeline oldukça yatkındır. Yüksek sabit maliyetler yerine, protokolün kullanım oranı ve başarısıyla birlikte ölçeklenen değişken maliyetler ön plandadır. Bu, projenin erken aşamalarında finansal yükü en aza indirir ve organik büyümeyi destekler.

