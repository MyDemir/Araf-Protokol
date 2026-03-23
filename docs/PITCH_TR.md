# 🌀 Araf Protokolü: Yatırımcı Sunumu

> **Versiyon:** 2.0 | **Durum:** Mainnet Hazır | **Tarih:** Mart 2026

---

## 1. Yönetici Özeti (TL;DR)

Araf Protokolü, P2P (eşten eşe) kripto-fiat takas piyasasında **hakemleri, moderatörleri ve insan müdahalesini ortadan kaldıran**, tamamen otonom bir escrow (emanet) sistemidir. Uyuşmazlıkları, "Bleeding Escrow" (Eriyen Kasa) adını verdiğimiz, zamanla fonların erimesine dayalı **benzersiz bir oyun teorisi modeliyle** çözer. "Kod Kanundur" felsefesini benimseyen Araf, dürüstsüzlüğü matematiksel olarak kârsız hale getirir.

**Temel Değer Önerisi:** Güvensiz, sansüre dayanıklı ve sıfır operasyonel maliyetli bir P2P takas pazarı.

---

## 2. Sorun: P2P Piyasasının Kırılgan Güveni

Mevcut P2P platformları (örn: Binance P2P, Paxful) üç temel sorunla boğuşmaktadır:

1.  **Merkezi Hakem Bağımlılığı:** Bir uyuşmazlık çıktığında (örn: "parayı göndermedim"), çözüm insan moderatörlerin insafına kalır. Bu süreç yavaş, maliyetli ve taraflıdır.
2.  **Oracle Problemi:** Akıllı kontratlar, bir banka transferinin gerçekleşip gerçekleşmediğini doğrulayamaz. Bu, on-chain otomasyonun önündeki en büyük engeldir.
3.  **Yüksek Operasyonel Maliyet:** Müşteri hizmetleri, moderatör maaşları ve yasal uyumluluk maliyetleri, hem platform hem de kullanıcılar için yüksek komisyonlara yol açar.

---

## 3. Çözüm: Araf Protokolü — "Zamana Güven, Hakeme Değil."

Araf, bu sorunları çözmek için hakemleri denklemden çıkarır ve yerine tavizsiz matematiği koyar.

### Nasıl Çalışır? Bleeding Escrow (Eriyen Kasa)

1.  **İtiraz (Challenge):** Bir satıcı, ödemeyi almadığını iddia ederek işleme itiraz eder.
2.  **Müzakere Süresi (48 Saat):** Taraflara, sıfır ceza ile anlaşmaları için 48 saatlik bir "Grace Period" tanınır.
3.  **Araf (Purgatory):** Anlaşma sağlanamazsa, kilitli tüm fonlar (Kripto + Her İki Tarafın Teminatı) **Araf** fazına girer ve **saatlik olarak erimeye başlar.**
4.  **Baskı ile Çözüm:** Paralarının blok blok eridiğini gören taraflar, inatlaşmanın maliyetinin iş birliğinden daha yüksek olduğunu anlar ve sorunu çözmeye mecbur kalır. Dolandırıcılık, dolandırıcının kendi fonlarını da yakmasıyla ekonomik olarak imkansız hale gelir.

Bu sistem, **Karşılıklı Garantili Yıkım (Mutually Assured Destruction)** ilkesiyle çalışır ve dürüstlüğü en kârlı strateji haline getirir.

---

## 4. Teknik ve Güvenlik Mimarisi

Protokol, güvenlik ve performansı birleştiren bir **Web2.5 Hibrit Mimarisi** üzerine kuruludur.

*   **On-Chain (Gerçeğin Tek Kaynağı):**
    *   **Fonlar ve İşlem Durumu:** Tüm varlıklar ve işlem yaşam döngüsü, değiştirilemez `ArafEscrow.sol` kontratındadır.
    *   **İtibar Sistemi:** Başarı/başarısızlık kayıtları on-chain'de tutularak manipülasyon engellenir.

*   **Off-Chain (Hız ve Gizlilik):**
    *   **PII Verisi (IBAN vb.):** Kullanıcıların kişisel verileri, **Zarf Şifreleme (AES-256-GCM)** ile veritabanında şifreli saklanır. Bu, GDPR/KVKK uyumluluğu ve veri güvenliği sağlar.
    *   **Emir Defteri:** Pazar yeri ilanları, hızlı sorgular için MongoDB'de indekslenir.

*   **Sıfır Güven Backend:** Backend sunucusu **hiçbir özel anahtar tutmaz**. Fonları hareket ettiremez, uyuşmazlık sonucunu değiştiremez. Backend ele geçirilse bile kullanıcı fonları güvendedir.

---

## 5. İş Modeli: Otonom Hazine

Protokol, sürdürülebilirliğini iki ana gelir akışıyla sağlar:

1.  **Başarı Ücreti:** Her başarılı işlemden, Hazine'ye otomatik olarak **%0.2** komisyon aktarılır.
2.  **Yakılan Fonlar (Burn):** "Bleeding Escrow" sırasında eriyen veya 10 gün sonunda tamamen sahipsiz kalan fonlar doğrudan Hazine'ye gelir.

Bu model, sıfır operasyonel maliyetle çalışan, kendi kendini finanse eden bir yapı oluşturur.

---

## 6. Pazar ve Mevcut Durum

*   **Pazar Büyüklüğü:** Global P2P kripto işlem hacmi milyarlarca dolar seviyesindedir. Gelişmekte olan ülkelerdeki (Türkiye, Nijerya, Arjantin) bankacılık kısıtlamaları, bu pazara olan talebi artırmaktadır.
*   **Mevcut Durum:** Protokol **Mainnet Hazır** durumdadır. Akıllı kontratlar tamamlanmış, testleri yazılmış ve mimari dokümanları oluşturulmuştur.
*   **Rekabet Avantajı:** Rakiplerin aksine, Araf %100 merkeziyetsiz, sansüre dayanıklı ve insan müdahalesinden arındırılmış tek çözümdür.

---

## 7. Ekip

*[Buraya kendinizi ve ekibinizi tanıtan kısa bir bölüm ekleyebilirsiniz. Teknik ve vizyoner gücünüzü vurgulayın.]*

---

## 8. Talep (The Ask)

Araf Protokolü'nü hayata geçirmek, pazarlama faaliyetlerini başlatmak ve yasal danışmanlık almak üzere **[İstenen Tutar]** tutarında bir başlangıç yatırımı arıyoruz. Bu fon, aşağıdaki alanlarda kullanılacaktır:

*   **Pazarlama ve Topluluk Oluşturma:** %40
*   **Likidite ve Teşvik Programları:** %30
*   **Yasal ve Operasyonel Giderler:** %20
*   **Gelecek Ar-Ge (Faz 2: ZK):** %10

---

## 9. Gelecek Vizyonu (Roadmap)

*   **Faz 1 (Mevcut):** Web2.5 Hibrit Modelinin lansmanı.
*   **Faz 2 (2-3 Yıl):** **ZK IBAN Doğrulama.** Kullanıcıların IBAN'larını on-chain'de ifşa etmeden, doğru hesaba para gönderdiklerini Sıfır Bilgi Kanıtları (Zero-Knowledge Proofs) ile ispatlamalarını sağlayacak bir katman.
*   **Faz 3 (İsteğe Bağlı):** The Graph entegrasyonu ile tamamen on-chain bir emir defterine geçiş.

**Nihai Hedef:** Finansal egemenliği bireylere geri veren, durdurulamaz ve küresel bir takas altyapısı oluşturmak.