# 🌀 Araf Protocol: Oyun Teorisi Görselleştirmesi

Bu doküman, Araf Protokolü'nün temel oyun teorisini ve çözümleme yollarını bir durum-akış diyagramı (state-flow diagram) kullanarak görsel olarak açıklar.

---

## Bleeding Escrow Akış Şeması

Bu diyagram, bir Taker'ın ödeme bildiriminde bulunmasının ardından (`PAID` durumu) bir escrow'un izleyebileceği tüm olası yolları gösterir — buna sorunsuz yol (happy path), otomatik serbest bırakma mekanizması (auto-release) ve çok aşamalı anlaşmazlık çözümü (Purgatory - Araf) dahildir.

> **Güvenlik notu:** `ConflictingPingPath` koruması, her iki "ping" yolunun aynı anda açık olmasını engeller. Eğer Maker `pingTakerForChallenge` çağırırsa, Taker `pingMaker` (autoRelease yolu) çağıramaz veya tam tersi. Bu durum, MEV ve işlem sırası manipülasyonunu (transaction ordering manipulation) önler.

```mermaid
flowchart TD
    %% Stil Sınıfları
    classDef state fill:#e1f5fe,stroke:#0288d1,stroke-width:2px,color:#01579b
    classDef success fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#1b5e20
    classDef warning fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#e65100
    classDef danger fill:#ffebee,stroke:#c62828,stroke-width:2px,color:#b71c1c
    classDef action fill:#ffffff,stroke:#9e9e9e,stroke-width:1px
    classDef phase fill:#f3e5f5,stroke:#8e24aa,stroke-width:2px,stroke-dasharray: 4

    %% Düğümleri (Nodes) Tanımla
    PAID(["🔵 DURUM: ÖDENDİ (PAID)<br>(Taker ödemeyi bildirir)"])
    ActionRelease["Maker: Fonları Serbest Bırakır (releaseFunds)"]
    ResOk(("✅ ÇÖZÜLDÜ (RESOLVED)<br>(Normal)"))

    ActionPingMaker["Taker: Maker'ı Dürt (pingMaker)"]
    ActionAuto["Taker: Otomatik Serbest Bırak (autoRelease)"]
    ResPen(("⚠️ ÇÖZÜLDÜ (RESOLVED)<br>(%2 Ceza)"))

    ActionPingTaker["Maker: İtiraz İçin Taker'ı Dürt<br>(pingTakerForChallenge)"]
    ActionChallenge["Maker: İşleme İtiraz Et (challengeTrade)"]
    CHALLENGED(["🔴 DURUM: İTİRAZ EDİLDİ (CHALLENGED)<br>(Anlaşmazlık Açıldı)"])

    %% Bağlantıları Tanımla
    PAID -->|"Sorunsuz Yol"| ActionRelease
    ActionRelease --> ResOk

    PAID -->|"Maker İnaktif<br>(48s Bekler)"| ActionPingMaker
    ActionPingMaker -->|"Yanıt Yok<br>(24s Bekler)"| ActionAuto
    ActionAuto --> ResPen

    PAID -->|"Ödeme Eksik<br>(24s Bekler)"| ActionPingTaker
    ActionPingTaker -->|"Çözüm Yok<br>(24s Bekler)"| ActionChallenge
    ActionChallenge --> CHALLENGED

    %% Purgatory (Araf) Alt Grafiği
    subgraph Purgatory [Anlaşmazlık Çözüm Aşamaları - Araf]
        direction TB
        GRACE["🛡️ 48s Mühlet Süresi<br>(Fon Kaybı Yok)"]
        CANCELED(("🔄 İPTAL EDİLDİ (CANCELED)<br>(İadeler Yapıldı)"))
        BLEEDING["🩸 10 Günlük Kanamalı Aşama<br>(Bond decay hemen, principal decay geç başlar)"]
        ActionBurn["Herhangi Biri: Süresi Dolanları Yak (burnExpired)"]
        BURNED(("💀 YAKILDI (BURNED)<br>(Fonlar Hazineye)"))

        CHALLENGED --> GRACE
        GRACE -->|"Karşılıklı Anlaşma<br>(EIP-712)"| CANCELED
        GRACE -->|"Anlaşma Yok<br>(48s Sonra)"| BLEEDING
        BLEEDING -->|"Karşılıklı Anlaşma"| CANCELED
        BLEEDING -->|"Anlaşma Yok<br>(10 Gün Sonra)"| ActionBurn
        ActionBurn --> BURNED
    end

    %% Sınıfları Güvenli Bir Şekilde Uygula
    class PAID,CHALLENGED state;
    class ResOk success;
    class ResPen warning;
    class CANCELED action;
    class ActionRelease,ActionPingMaker,ActionAuto,ActionPingTaker,ActionChallenge,ActionBurn action;
    class GRACE phase;
    class BLEEDING,BURNED danger;
```

---

## Mekanizmanın Yorumu

Bleeding Escrow, **haklı tarafı bulmaya çalışan bir arbitraj akışı değil; aşamalı ekonomik zorlama motorudur.** Sistem tarafların niyetini yorumlamaz. Bunun yerine tarafları şu sırayla uzlaşmaya iter:

1. **`PAID` aşaması — liveness baskısı:** Önce iki ayrı ping hattı açılır. Taker, `pingMaker → autoRelease`; maker ise `pingTakerForChallenge → challengeTrade` hattını izler.
2. **`CHALLENGED` iç grace:** Challenge açıldıktan sonraki ilk 48 saatte fon kaybı yoktur. Bu pencere, dispute'u anında para yakma oyununa çevirmeden son bir çözüm alanı bırakır.
3. **Bond-first bleeding:** Grace sonrası ilk ekonomik baskı principal'e değil, maker ve taker bond'larına uygulanır.
4. **Gecikmeli principal bleed:** Escrowed crypto decay, bleeding'in 96. saatinde devreye girer. Yani principal decay challenge anında değil, yaklaşık 144 saat sonra başlar.
5. **Terminal acceleration:** Principal geç başlatıldığı için son pencerenin gerçekten uzlaşma üretmesi gerekir. Bu nedenle kontrat formülünde `CRYPTO_DECAY_BPS_H * 2` uygulanır; taban katsayı 34 BPS/saat olsa da etkin principal decay oranı 68 BPS/saat'tir.
6. **Permissionless burn:** Süre dolduğunda `burnExpired()` ile kalan her şey hazineye gider. Deadlock'un kazananı taraflar değil, protokol olur.

### Neden `* 2` Kullanılır?

Principal decay bu sistemde erken baskı aracı değildir. Erken fazda sistem önce:
- cevap verme yükümlülüğünü,
- ardından bond kaybını,
- en son da principal kaybını

devreye sokar.

Bu yüzden principal decay **geç** başlatılır. Geç başlatılan decay'in yine de burn öncesi anlamlı bir uzlaşma baskısı üretebilmesi için terminal fazda hızlandırılması gerekir. `CRYPTO_DECAY_BPS_H = 34` taban katsayısı korunur; hesapta kullanılan `* 2` çarpanı ise principal'i son fazda **etkin 68 BPS/saat** hızında eriten acceleration katmanıdır.

### Kısa Özet

```text
PAID        = önce liveness zorlaması
CHALLENGED  = 48 saat kayıpsız iç grace
BLEEDING    = önce bond'lar erir
LATE BLEED  = principal de hızlandırılmış biçimde erir
DEADLOCK    = burnExpired() ile permissionless kapanır
```
