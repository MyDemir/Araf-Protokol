# Araf Protocol ⏳

**Trust the Time, Not the Oracle.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version: 2.0](https://img.shields.io/badge/Version-2.0-blue.svg)]()
[![Network: Base](https://img.shields.io/badge/Network-Base-blueviolet.svg)]()

Araf Protocol is a 99% decentralized, oracle-free, and arbitrator-free peer-to-peer (P2P) escrow system between fiat money (TRY, USD, etc.) and crypto assets (USDT, USDC).

Traditional P2P platforms rely on human moderators, centralized databases, and subjective decisions to resolve disputes. Araf Protocol eliminates all these intermediaries, replacing them with uncompromising mathematics, transparent code, and time-based economic game theory.

---

## 📖 Philosophy: "The System Doesn't Judge, It Makes Dishonesty Expensive"

The fundamental promise of blockchain technology is to eliminate intermediaries. However, many "decentralized" P2P platforms compromise this promise by resorting to centralized committees or token-voted juries (DAOs) that act as "arbitrators" in times of dispute. This does not solve the "Oracle Problem"; it merely changes its shape.

Araf's philosophy is radically different:

1. **Oracle-Independence:** Smart contracts cannot verify an off-chain bank transfer. Araf **does not try** to do this. It completely refuses to ask the question, "Who is right?".
2. **Mutually Assured Destruction (MAD):** The system makes the cost of prolonging a dispute higher than the potential gain. The "Bleeding Escrow" mechanism gradually depletes the funds (principal + collateral) of both parties as the dispute drags on.
3. **Economic Rationality:** Watching their money melt away block by block economically forces parties to put aside their egos and malicious intent, communicate, and solve the problem collaboratively. Fraud becomes unprofitable as the fraudster also loses their own funds.
4. **Code is Law:** There is no human bias, fatigue, or error. Rules are applied equally and immutably on-chain for everyone.

This approach transforms Araf into a truly **humanless, autonomous, and censorship-resistant** protocol.

---

## ⚖️ Araf Protocol vs. Other Escrow Systems

The main difference that sets Araf apart from others is its answer to the Oracle Problem.

| Feature | Araf Protocol | Centralized P2P (e.g., Binance P2P) | Decentralized Jury (e.g., Kleros) |
| :--- | :--- | :--- | :--- |
| **Dispute Resolution** | **Game Theory (Bleeding Escrow)**. Autonomous, time-based resolution. | **Centralized Moderators**. Decide based on evidence. | **Decentralized Jury**. Token holders vote based on evidence. |
| **Oracle Dependency** | **None (Oracle-Free)**. | **Human Oracle**. Moderators are the source of truth. | **Collective Human Oracle**. Jury members are the source of truth. |
| **Trust Model** | "Trust the code and mathematics." | "Trust the platform and its employees." | "Trust the economic rationality of the jury." |
| **Primary Advantage** | Completely autonomous, uncensored, zero operational cost. | Familiar and simple interface for users. | Eliminates trust in a centralized company. |
| **Primary Disadvantage** | Can be ruthless against irrational actors. | Centralized, prone to censorship and arbitrary decisions. | Can be slow, complex, and vulnerable to jury manipulation. |

---

## ⚡ Key Features

* **Hybrid (Web2.5) Architecture:** Security-critical assets and rules run **on-chain** (Base L2); the marketplace (listings) requiring performance and privacy, along with PII data, run **off-chain** (MongoDB + Redis).
* **Zero Private Key Backend:** The backend acts as a "Relayer". It holds no private keys capable of moving user funds. Funds cannot be stolen.
* **Tier and Asymmetric Collateral System:** A 5-tier reputation system protects experienced users from new and untested actors. Higher Tiers mean lower collateral rates and higher transaction limits.
* **On-Chain Anti-Sybil Shield:** Filters enforced at the smart contract level at the beginning of every transaction, such as Wallet Age, Minimum Balance (Dust), and Transaction Cooldown, prevent bot and fake account attacks.
* **Envelope Encryption:** Sensitive personal data (PII) like IBANs is stored encrypted in the database using AES-256-GCM, minimizing the risk of data leaks and ensuring GDPR compliance.
* **Gas-Free Cancellation:** Using the EIP-712 standard, transactions can be canceled without paying gas fees and without penalties if both parties agree via off-chain signatures.

---

## 🌊 Standard Transaction Flow (Happy Path)

1. **Listing Creation (Maker):** The seller creates a listing off-chain.
2. **Escrow Creation (Maker):** The seller calls the `createEscrow` function to lock USDT and the Maker Collateral on-chain in the smart contract. The listing moves to the `OPEN` state.
3. **Locking the Transaction (Taker):** The buyer selects the listing and calls the `lockEscrow` function to lock the Taker Collateral on-chain. The transaction moves to the `LOCKED` state.
4. **Payment Notification (Taker):** The buyer makes the fiat transfer off-chain (bank, etc.) and calls the `reportPayment` function to notify that the payment has been made. The transaction moves to the `PAID` state, and a 48-hour "Grace Period" begins.
5. **Releasing Funds (Maker):** The seller confirms receipt of the fiat payment and calls the `releaseFunds` function.
6. **Resolution (Resolved):** The contract transfers a 0.2% protocol fee to the Treasury, sends the USDT to the Buyer, and returns the remaining collateral to the parties. The successful transaction count for both parties increases.

If a dispute arises after step 4, the famous **Bleeding Escrow** mechanism is triggered. For details, refer to the `docs/ARCHITECTURE_EN.md` file.

---

## 🔮 Future Vision: Philosophical Staking

The Araf philosophy should not only punish dishonesty but also **reward honesty and participation.**

Accumulated revenues in the Protocol Treasury (success fees and melted funds) are planned to be distributed not by asking "who is right?" like an insurance mechanism, but by identifying those who contribute most to the protocol's spirit using on-chain data.

* **Value Criteria:** High number of successfully completed transactions, zero history of failed disputes, providing long-term liquidity to the marketplace (keeping active listings), and demonstrating protocol loyalty by reaching a high Tier level.
* **Mechanism:** Periodically (e.g., every 3 months), a portion of the Treasury revenues will be distributed as a **retroactive airdrop** to top participants based on a formula weighted by these criteria.

This model is inspired by Optimism's "RetroPGF" mechanism and aims to create a self-sustaining, circular economy that rewards the protocol's most valuable users.



# Araf Protocol ⏳

**Trust the Time, Not the Oracle. / Zamana Güven, Hakeme Değil.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version: 2.0](https://img.shields.io/badge/Version-2.0-blue.svg)]()
[![Network: Base](https://img.shields.io/badge/Network-Base-blueviolet.svg)]()

Araf Protokolü; fiat para (TRY, USD vb.) ile kripto varlıklar (USDT, USDC) arasında, **%99 merkeziyetsiz, hakemsiz ve oracle-bağımsız** bir eşten eşe (P2P) emanet (escrow) sistemidir.

Geleneksel P2P platformları, uyuşmazlıkları çözmek için insan moderatörlere, merkezi veritabanlarına ve sübjektif kararlara güvenir. Araf Protokolü ise tüm bu aracıları ortadan kaldırır ve onların yerine tavizsiz matematik, şeffaf kod ve zamana dayalı ekonomik oyun teorisini koyar.

---

## 📖 Felsefe: "Sistem Yargılamaz, Dürüstsüzlüğü Pahalıya Mal Eder"

Blokzincir teknolojisinin temel vaadi, aracıları ortadan kaldırmaktır. Ancak birçok "merkeziyetsiz" P2P platformu, uyuşmazlık anında "hakem" rolünü üstlenen merkezi komitelere veya token-oylamalı jürilere (DAO) başvurarak bu vaatten ödün verir. Bu, "Oracle Problemi"ni çözmek yerine, sadece şeklini değiştirmektir.

Araf'ın felsefesi radikal bir şekilde farklıdır:

1.  **Oracle-Bağımsızlık:** Akıllı kontratlar, off-chain gerçekleşen bir banka transferini doğrulayamaz. Araf, bunu yapmaya **çalışmaz**. "Kim haklı?" sorusunu sormayı tamamen reddeder.
2.  **Karşılıklı Garantili Yıkım (MAD):** Sistem, bir uyuşmazlığı sürdürmenin maliyetini, potansiyel kazançtan daha yüksek hale getirir. "Bleeding Escrow" (Eriyen Kasa) mekanizması, anlaşmazlık uzadıkça her iki tarafın da fonlarını (ana para + teminat) zamanla eritir.
3.  **Ekonomik Rasyonellik:** Paralarının blok blok eridiğini izlemek, tarafları egolarını ve kötü niyetlerini bir kenara bırakıp iletişim kurmaya ve sorunu ortaklaşa çözmeye ekonomik olarak zorlar. Dolandırıcılık, dolandırıcının da kendi fonlarını kaybetmesiyle kârsız hale gelir.
4.  **Kod Kanundur (Code is Law):** İnsan önyargısı, yorgunluğu veya hatası yoktur. Kurallar, herkes için eşit ve değiştirilemez bir şekilde on-chain olarak uygulanır.

Bu yaklaşım, Araf'ı gerçek anlamda **insansız, otonom ve sansüre dayanıklı** bir protokole dönüştürür.

---

## ⚖️ Araf Protokolü vs. Diğer Escrow Sistemleri

Araf'ı diğerlerinden ayıran temel fark, Oracle Problemi'ne verdiği cevaptır.

| Özellik | Araf Protokolü | Merkezi P2P (Örn: Binance P2P) | Merkeziyetsiz Jüri (Örn: Kleros) |
| :--- | :--- | :--- | :--- |
| **Uyuşmazlık Çözümü** | **Oyun Teorisi (Bleeding Escrow)**. Özerk, zaman bazlı çözüm. | **Merkezi Moderatörler**. Kanıtlara bakıp karar verirler. | **Merkeziyetsiz Jüri**. Token sahipleri kanıtlara bakıp oy kullanır. |
| **Oracle Bağımlılığı** | **Yok (Oracle-Free)**. | **İnsan Oracle**. Moderatörler gerçeğin kaynağıdır. | **Kolektif İnsan Oracle**. Jüri üyeleri gerçeğin kaynağıdır. |
| **Güven Modeli** | "Koda ve matematiğe güven." | "Platforma ve çalışanlarına güven." | "Jürinin ekonomik rasyonelliğine güven." |
| **Temel Avantaj** | Tamamen otonom, sansürsüz, sıfır operasyonel maliyet. | Kullanıcılar için alışıldık ve basit arayüz. | Merkezi bir şirkete olan güveni ortadan kaldırır. |
| **Temel Dezavantaj** | İrrasyonel aktörlere karşı acımasız olabilir. | Merkezi, sansüre açık, keyfi kararlar riski. | Yavaş, karmaşık ve jüri manipülasyonuna açık olabilir. |

---

## ⚡ Temel Özellikler

*   **Hibrit (Web2.5) Mimari:** Güvenlik açısından kritik varlıklar ve kurallar **on-chain** (Base L2); performans ve gizlilik gerektiren pazar yeri (ilanlar) ve PII verileri **off-chain** (MongoDB + Redis) üzerinde çalışır.
*   **Sıfır Özel Anahtar (Zero Private Key) Backend:** Backend, bir "Relayer" görevi görür. Kullanıcı fonlarını hareket ettirebilecek hiçbir özel anahtara sahip değildir. Fonlar çalınamaz.
*   **Tier ve Asimetrik Teminat Sistemi:** 5 kademeli itibar sistemi, tecrübeli kullanıcıları yeni ve test edilmemiş aktörlerden korur. Yükselen Tier'lar, daha düşük teminat oranları ve daha yüksek işlem limitleri anlamına gelir.
*   **On-Chain Anti-Sybil Kalkanı:** Her işlemin başında akıllı kontrat seviyesinde zorunlu kılınan Cüzdan Yaşı, Minimum Bakiye (Dust) ve İşlem Bekleme Süresi (Cooldown) gibi filtreler, bot ve sahte hesap saldırılarını engeller.
*   **Zarf Şifreleme (Envelope Encryption):** IBAN gibi hassas kişisel veriler (PII), veritabanında AES-256-GCM ile şifrelenerek saklanır, bu da veri sızıntısı riskini minimize eder ve KVKK/GDPR uyumluluğunu sağlar.
*   **Gas-Free İptal:** EIP-712 standardı kullanılarak, her iki tarafın da off-chain imza ile anlaşması durumunda işlemler gaz ücreti ödemeden ve cezasız bir şekilde iptal edilebilir.

---

## 🌊 Standart İşlem Akışı (Happy Path)

1.  **İlan Açma (Maker):** Satıcı, off-chain olarak bir ilan oluşturur.
2.  **Escrow Oluşturma (Maker):** Satıcı, `createEscrow` fonksiyonunu çağırarak USDT ve Maker Teminatını on-chain olarak akıllı kontrata kilitler. İlan `OPEN` durumuna geçer.
3.  **İşlemi Kilitleme (Taker):** Alıcı, ilanı seçer ve `lockEscrow` fonksiyonunu çağırarak Taker Teminatını on-chain kilitler. İşlem `LOCKED` durumuna geçer.
4.  **Ödeme Bildirimi (Taker):** Alıcı, fiat transferini off-chain (banka vb.) yapar ve `reportPayment` fonksiyonunu çağırarak ödemeyi yaptığını bildirir. İşlem `PAID` durumuna geçer ve 48 saatlik "Müzakere Süresi" (Grace Period) başlar.
5.  **Fonları Serbest Bırakma (Maker):** Satıcı, fiat ödemesini aldığını teyit eder ve `releaseFunds` fonksiyonunu çağırır.
6.  **Çözüm (Resolved):** Kontrat, %0.2'lik protokol ücretini Hazine'ye aktarır, USDT'yi Alıcı'ya gönderir ve kalan teminatları taraflara iade eder. Her iki tarafın da başarılı işlem sayısı artar.

Eğer 4. adımdan sonra bir uyuşmazlık çıkarsa, meşhur **Bleeding Escrow** mekanizması devreye girer. Detaylar için `docs/ARCHITECTURE_TR.md` dosyasına bakınız.

---

## 🔮 Gelecek Vizyonu: Felsefi Paydaşlık (Philosophical Staking)

Araf felsefesi sadece dürüstsüzlüğü cezalandırmakla kalmamalı, aynı zamanda **dürüstlüğü ve katılımı da ödüllendirmelidir.**

Protokol Hazinesi'nde biriken gelirlerin (başarı ücretleri ve eriyen fonlar), bir sigorta mekanizması gibi "kim haklı?" sorusunu sorarak değil, protokolün ruhuna en çok katkıda bulunanları on-chain verilerle tespit ederek dağıtılması planlanmaktadır.

*   **Değer Kriterleri:**
    *   Yüksek sayıda başarılı işlem tamamlama.
    *   Sıfır başarısız uyuşmazlık geçmişi.
    *   Pazar yerine uzun süreli likidite sağlama (aktif ilan tutma).
    *   Yüksek Tier seviyesine ulaşarak protokole bağlılık gösterme.
*   **Mekanizma:** Belirli periyotlarla (örneğin 3 ayda bir), Hazine gelirlerinin bir kısmı, bu kriterlere göre ağırlıklandırılmış bir formülle en iyi katılımcılara **geriye dönük (retroactive) airdrop** olarak dağıtılacaktır.

Bu model, Optimism'in "RetroPGF" mekanizmasından ilham alır ve protokolün kendi kendini sürdüren, en değerli kullanıcılarını ödüllendiren döngüsel bir ekonomi yaratmasını hedefler.

---
