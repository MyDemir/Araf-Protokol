# Araf Admin Panel Planı — Minimal Dosya, Modern Görünüm, Tam İzleme

## 1. Amaç

Bu doküman, Araf reposuna **minimum dosya yükü** ile eklenecek, ancak repoyu operasyonel olarak **yüksek görünürlükle izleyecek** bir admin panel planını tanımlar.

Bu planın temel hedefi şudur:

- modern ama hafif bir admin yüzeyi kurmak
- repo içinde yeni klasör ağacı ve büyük frontend modül yığını oluşturmamak
- paneli **read-only observability console** olarak tasarlamak
- kontrat authority çizgisini bozmamak
- mevcut backend ve frontend zeminini mümkün olduğunca yeniden kullanmak

Bu panelin amacı hakemlik yapmak değildir.  
Bu panelin amacı:

- sistem sağlığını görmek
- event mirror / worker senkronizasyonunu görmek
- riskli trade yüzeylerini görmek
- incomplete snapshot durumlarını görmek
- feedback akışını okumak
- DLQ / job / operasyon kalitesini izlemektir

---

## 2. Ürün İlkesi ile Uyum

Bu panel aşağıdaki sınırları korur:

### 2.1 Yapacakları
- sağlık görünürlüğü üretir
- sync / worker görünürlüğü üretir
- riskli trade'leri listeler
- feedback kayıtlarını okur
- snapshot eksiklerini görünür kılar
- operasyonel körlüğü azaltır

### 2.2 Yapmayacakları
- release yapmaz
- cancel yapmaz
- burn yapmaz
- payout override etmez
- reputation yazmaz
- dispute sonucu vermez
- fon hareket ettirmez

Bu nedenle panel, **merchant-grade ops without custody** mantığına uyar.

---

## 3. Repo Gerçeğine Göre Mimari Karar

Mevcut repo durumuna göre:

- `frontend/src/App.jsx` zaten yoğun bir orkestrasyon dosyasıdır
- `frontend/src/app/AppViews.jsx` da büyük bir render yüzeyidir
- admin paneli bu iki dosyanın içine gömülürse dosya boyutu ve bakım maliyeti hızla artar

Bu nedenle doğru karar:

- admin paneli `App.jsx` içine inline yazmamak
- ayrı bir hafif JSX dosyası kullanmak
- fakat büyük modül ağacı da kurmamak

---

## 4. Dosya Politikası

## 4.1 Yeni oluşturulacak dosyalar

Yalnızca şu iki yeni dosya açılmalıdır:

```text
frontend/src/AdminPanel.jsx
backend/scripts/routes/admin.js
```

## 4.2 Küçük edit yapılacak mevcut dosyalar

```text
frontend/src/App.jsx
backend/scripts/app.js
backend/scripts/services/dlqProcessor.js
```

## 4.3 Bilinçli olarak açılmayacak dosyalar

Aşağıdaki türde bir dosya ağacı **oluşturulmayacaktır**:

```text
frontend/src/admin/pages/
frontend/src/admin/components/
frontend/src/admin/hooks/
frontend/src/admin/services/
```

Sebep:
- repo şişmesini önlemek
- Codex görevlerini sade tutmak
- bakım maliyetini düşük tutmak
- ilk sürümde en yüksek faydayı en az hareketle almak

---

## 5. Genel Mimari

## 5.1 Frontend

Tek dosyalı admin panel:

- `AdminPanel.jsx`
- kendi içinde tab state barındırır
- kendi içinde fetch mantığını barındırır
- kendi içinde render helper fonksiyonları barındırır
- ek UI kütüphanesi kullanmaz

## 5.2 Backend

Tek route dosyalı admin surface:

- `admin.js`
- auth guard içerir
- allowlist kontrolü içerir
- summary endpoint içerir
- trades endpoint içerir
- feedback endpoint içerir

## 5.3 Güvenlik çizgisi

Admin panel yalnız şu zincirle açılır:

1. `requireAuth`
2. `requireSessionWalletMatch`
3. env tabanlı admin wallet allowlist kontrolü

---

## 6. Admin Panelin Kapsamı

Admin panel 4 sekmeli olacaktır:

1. Overview
2. Sync
3. Trades
4. Feedback

Bu 4 sekme ilk sürüm için yeterlidir.  
Ayrı Risk sekmesi açılmayacaktır; risk verileri Trades sekmesi içine gömülür.

---

## 7. Sekme Detayları

# 7.1 Overview

Amaç: sistemi tek bakışta anlamak.

## 7.1.1 Gösterilecek KPI kartları

- Readiness
- Worker State
- Worker Lag
- Missing Config Count
- Active Child Trades
- Open Sell Orders
- Open Buy Orders
- Completed Trades
- Burned Bonds
- Incomplete Snapshot Trade Count
- Challenged Trade Count
- DLQ Depth

## 7.1.2 Gösterim biçimi

Üst blokta 8–12 adet kart bulunur.  
Her kart şunları içerir:

- kısa başlık
- tek ana değer
- gerekiyorsa durum etiketi
- gerekiyorsa ufak açıklama

## 7.1.3 Renk politikası

- healthy -> yeşil
- degraded -> sarı
- critical -> kırmızı
- informational -> mavi

## 7.1.4 Kart örnekleri

### Readiness
- değer: `READY` veya `DEGRADED`
- alt bilgi: `mongo / redis / provider / worker`

### Worker Lag
- değer: `12 blocks`
- alt bilgi: `threshold: 25`

### DLQ Depth
- değer: `3`
- alt bilgi: `0 ideal`

### Incomplete Snapshot
- değer: `5`
- alt bilgi: `aktif trade içinde eksik snapshot`

---

# 7.2 Sync

Amaç: event listener ve sistem sağlık katmanını ayrıntılı görmek.

## 7.2.1 Gösterilecek alanlar

### checks
- mongo
- redis
- provider
- config
- replayBootstrap
- worker
- workerRunning
- workerStateHealthy
- workerLagHealthy
- workerReplayHealthy

### worker
- state
- currentBlock
- lastSeenBlock
- lastSafeBlock
- lagBlocks
- maxAllowedLagBlocks
- livePollInProgress

### config / warning alanı
- missingConfig listesi

## 7.2.2 UI düzeni

Bu ekran 3 bloktan oluşur:

### Blok A — Health Checklist
Tek tek status satırları:
- Mongo: OK / FAIL
- Redis: OK / FAIL
- Provider: OK / FAIL
- Config: OK / FAIL
- Worker: OK / FAIL

### Blok B — Worker Snapshot
Bir mini bilgi tablosu:
- state
- current block
- last seen block
- last safe block
- lag
- replay durumu

### Blok C — Missing Config
Liste halinde:
- eksik env anahtarları
- config drift işaretleri

---

# 7.3 Trades

Amaç: aktif ve problemli trade'leri operasyonel olarak izlemek.

Bu sekme admin panelin en kritik sayfasıdır.

## 7.3.1 Filtreler

- status
- tier
- origin
- riskOnly
- snapshotComplete
- page
- limit

## 7.3.2 Status filtre değerleri
- ALL
- LOCKED
- PAID
- CHALLENGED
- RESOLVED
- CANCELED
- BURNED

İlk sürümde default:
- `LOCKED + PAID + CHALLENGED` ağırlıklı görünüm

## 7.3.3 Kolonlar

- Escrow ID
- Parent Order ID
- Maker
- Taker
- Status
- Tier
- Origin
- Token
- Snapshot Complete
- Incomplete Reason
- High Risk
- Changed After Lock
- Frequent Recent Changes
- Explainable Reasons
- Captured At

## 7.3.4 Hücre davranışları

### Wallet alanları
Tam adres gösterilmez.  
Format:
- `0x1234...abcd`

### Boolean alanlar
- true -> renkli badge
- false -> gri badge

### Explainable Reasons
Liste çok uzunsa:
- ilk 2 neden gösterilir
- devamı `+N` şeklinde açılır

## 7.3.5 Satır detayı

Her satır için bir mini expand alanı olabilir.  
Yeni bileşen dosyası açmadan satır altında açılan blok yeterlidir.

Bu blokta gösterilebilecek ek alanlar:
- rail at lock
- country at lock
- profileVersionAtLock
- currentProfileVersion
- bankChangeCount7dAtLock
- bankChangeCount30dAtLock
- lastBankChangeAtAtLock
- snapshot.capturedAt
- snapshot.isComplete
- snapshot.incompleteReason

## 7.3.6 Varsayılan sıralama

Öncelik sırası:
1. CHALLENGED
2. incomplete snapshot
3. high risk
4. created_at desc

---

# 7.4 Feedback

Amaç: kullanıcı geri bildirimlerini okumak ve ürün kör noktalarını görmek.

## 7.4.1 Filtreler
- category
- rating
- page
- limit

## 7.4.2 Kategori değerleri
- bug
- suggestion
- ui/ux
- other

## 7.4.3 Kolonlar
- Date
- Wallet
- Rating
- Category
- Comment

## 7.4.4 UX davranışı

- yorum sütunu 2 satır kısaltmalı gösterilir
- tıklanınca tam yorum açılır
- düşük puanlı kayıtlar görsel olarak öne çıkarılabilir

---

## 8. Backend Endpoint Tasarımı

İlk sürüm için 3 endpoint yeterlidir.

# 8.1 `GET /api/admin/summary`

Bu endpoint Overview ve Sync ekranlarının ana kaynağıdır.

## 8.1.1 Döndüreceği veri

```json
{
  "timestamp": "ISO_DATE",
  "readiness": {
    "ok": true,
    "checks": {},
    "worker": {},
    "missingConfig": []
  },
  "stats": {
    "total_volume_usdt": 0,
    "executed_volume_usdt": 0,
    "completed_trades": 0,
    "active_child_trades": 0,
    "open_sell_orders": 0,
    "open_buy_orders": 0,
    "partially_filled_orders": 0,
    "filled_orders": 0,
    "canceled_orders": 0,
    "burned_bonds_usdt": 0,
    "avg_trade_hours": null,
    "changes_30d": {}
  },
  "tradeCounts": {
    "active": 0,
    "locked": 0,
    "paid": 0,
    "challenged": 0,
    "incompleteSnapshot": 0
  },
  "dlq": {
    "depth": 0,
    "retrySuccessRate": 100,
    "redriveSuccess": 0,
    "redriveFailure": 0
  },
  "scheduler": {
    "reputationDecayLastRunAt": null,
    "statsSnapshotLastRunAt": null,
    "sensitiveCleanupLastRunAt": null,
    "userBankRiskCleanupLastRunAt": null
  }
}
```

## 8.1.2 Veri kaynakları
- readiness -> `getReadiness()`
- stats -> `HistoricalStat`
- trade counts -> `Trade`
- dlq -> Redis + `dlqProcessor.js`
- scheduler -> process memory snapshot

---

# 8.2 `GET /api/admin/trades`

Bu endpoint admin trade tablosunu besler.

## 8.2.1 Query parametreleri

- `status`
- `tier`
- `riskOnly`
- `snapshotComplete`
- `page`
- `limit`

## 8.2.2 Response alanları

Her trade için:
- ana trade alanları
- `bank_profile_risk`
- `offchain_health_score_input`

## 8.2.3 Response örneği

```json
{
  "trades": [
    {
      "_id": "...",
      "onchain_escrow_id": "12",
      "parent_order_id": "5",
      "maker_address": "0x...",
      "taker_address": "0x...",
      "status": "PAID",
      "tier": 1,
      "trade_origin": "ORDER_FILL",
      "bank_profile_risk": {
        "highRiskBankProfile": true,
        "changedAfterLock": true,
        "frequentRecentChanges": false
      },
      "offchain_health_score_input": {
        "readOnly": true,
        "nonBlocking": true,
        "canBlockProtocolActions": false,
        "explainableReasons": [
          "maker_profile_changed_after_lock"
        ],
        "snapshot": {
          "capturedAt": "ISO_DATE",
          "isComplete": true,
          "incompleteReason": null
        }
      }
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

# 8.3 `GET /api/admin/feedback`

## 8.3.1 Query parametreleri
- `category`
- `rating`
- `page`
- `limit`

## 8.3.2 Response
```json
{
  "feedback": [
    {
      "wallet_address": "0x...",
      "rating": 4,
      "comment": "Yorum",
      "category": "ui/ux",
      "created_at": "ISO_DATE"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

## 9. Güvenlik Tasarımı

## 9.1 Auth zinciri

Admin route'ları şu sırayla korunur:

1. `requireAuth`
2. `requireSessionWalletMatch`
3. `requireAdminWallet`

## 9.2 `requireAdminWallet` davranışı

Yeni middleware dosyası açılmaz.  
`admin.js` içinde küçük bir helper yeterlidir.

## 9.2.1 Env değişkeni
```env
ADMIN_WALLETS=0xabc...,0xdef...
```

## 9.2.2 Kontrol mantığı
- env parse edilir
- lowercase normalize edilir
- `req.wallet` listede değilse `403`

## 9.3 Yetki çizgisi
Bu route'lar read-only olacaktır.  
POST, PUT, DELETE admin aksiyonu açılmayacaktır.

---

## 10. Performans Politikası

## 10.1 Frontend

### Kullanılmayacaklar
- chart kütüphanesi
- grid kütüphanesi
- icon paketi
- state manager
- router eklentisi
- animation paketi

### Kullanılacaklar
- React state
- native fetch
- basit tab mantığı
- basit kartlar
- native table yapısı
- mevcut utility class yaklaşımı

## 10.2 Refresh politikası

### Summary
- panel açılınca yüklenir
- sonra 15 saniyede bir yenilenir

### Trades
- sekme açılınca yüklenir
- filtre değişince tekrar yüklenir
- 30 saniyelik auto-refresh opsiyonel
- manuel refresh butonu olmalı

### Feedback
- sekme açılınca yüklenir
- otomatik polling gerekmez
- manuel yenile yeterli
- istenirse 60 saniye polling eklenebilir

## 10.3 Pagination

### Trades
- default `limit=20`
- max `limit=50`

### Feedback
- default `limit=20`
- max `limit=50`

## 10.4 Backend optimizasyonları

- `lean()` kullanılmalı
- `select()` kullanılmalı
- yalnız gerekli alanlar çekilmeli
- `riskOnly=true` ise sadece aktif trade filtrelenmeli
- feedback response hafif tutulmalı

---

## 11. Görsel Tasarım Detayı

## 11.1 Genel görünüm
Panel mevcut Araf görsel diliyle uyumlu olmalıdır:

- koyu arka plan
- yüksek kontrast
- ince border
- az ama anlamlı renk
- yoğun olmayan tipografi
- dashboard hissi

## 11.2 Yerleşim

### Üst alan
- başlık
- açıklama
- son yenilenme zamanı
- refresh butonu

### Tab bar
- Overview
- Sync
- Trades
- Feedback

### İçerik alanı
- sekmeye göre kartlar ve tablolar

## 11.3 Badge sistemi

### Status badge
- yeşil -> `OK`
- sarı -> `WARN`
- kırmızı -> `FAIL`
- gri -> `N/A`

### Trade risk badge
- kırmızı -> `HIGH RISK`
- sarı -> `WATCH`
- gri -> `NORMAL`

### Snapshot badge
- yeşil -> `COMPLETE`
- kırmızı -> `INCOMPLETE`

---

## 12. Frontend Teknik Tasarım

## 12.1 `AdminPanel.jsx` iç yapısı

Tek dosya içinde şu bölümler olmalıdır:

1. import'lar
2. küçük yardımcı formatter'lar
3. ana `AdminPanel` bileşeni
4. state blokları
5. fetch fonksiyonları
6. `useEffect` blokları
7. render helper fonksiyonları
8. final return

## 12.2 İç state listesi

- `activeTab`
- `summary`
- `summaryLoading`
- `summaryError`
- `trades`
- `tradesLoading`
- `tradesError`
- `feedback`
- `feedbackLoading`
- `feedbackError`
- `tradeFilters`
- `feedbackFilters`
- `expandedTradeId`
- `lastRefreshedAt`

## 12.3 İç helper fonksiyonları

- `formatAddress()`
- `formatDate()`
- `formatNumber()`
- `fetchSummary()`
- `fetchTrades()`
- `fetchFeedback()`
- `renderOverview()`
- `renderSync()`
- `renderTrades()`
- `renderFeedback()`

Yeni dosya açılmadan bu helper'lar aynı dosyada kalmalıdır.

---

## 13. Backend Teknik Tasarım

## 13.1 `admin.js` içinde olması gereken bloklar

1. import'lar
2. router tanımı
3. admin wallet allowlist helper
4. summary route
5. trades route
6. feedback route
7. export

## 13.2 Summary route içeriği

Birleşik summary route şu veri kaynaklarını çağırır:

- `getReadiness({ worker, provider })`
- `HistoricalStat.findOne().sort({ date: -1 })`
- `Trade.countDocuments(...)`
- Redis `lLen("worker:dlq")`
- `getDlqMetrics()`
- scheduler last run snapshot

## 13.3 Trades route içeriği

Yapılacaklar:

- query validate et
- `Trade.find(...)`
- gerekli projection uygula
- `User.find(...)` ile participant read model hazırla
- mevcut risk builder fonksiyonlarını kullan
- admin tablo payload'ı döndür

## 13.4 Feedback route içeriği

- query validate et
- `Feedback.find(...)`
- `sort({ created_at: -1 })`
- `skip/limit`
- toplam sayıyı döndür

---

## 14. Gerekli küçük backend ekleri

## 14.1 `dlqProcessor.js`
Şu ek yapılmalıdır:

### yeni export
- `getDlqMetrics()`

### döndürmesi gereken alanlar
- `redriveSuccess`
- `redriveFailure`
- `retrySuccessRate`

Bu alanlar zaten memory'de tutuluyor; yalnız okunur hale gelmeleri gerekir.

## 14.2 `app.js`
Scheduler job'ları çalıştığında aşağıdaki timestamp'ler process memory'de tutulmalıdır:

- `reputationDecayLastRunAt`
- `statsSnapshotLastRunAt`
- `sensitiveCleanupLastRunAt`
- `userBankRiskCleanupLastRunAt`

Bu değerler admin summary içinde okunacaktır.

### Önerilen yaklaşım
Dosya içinde küçük bir obje:

```js
const schedulerState = {
  reputationDecayLastRunAt: null,
  statsSnapshotLastRunAt: null,
  sensitiveCleanupLastRunAt: null,
  userBankRiskCleanupLastRunAt: null,
};
```

Her job başarıyla çalışınca ilgili alan güncellenir.

Bu obje `module.exports.schedulerState = schedulerState;` ile dışarı açılabilir.

---

## 15. Kabul Kriterleri

Bu admin panel işi tamamlandı sayılmadan önce aşağıdaki maddeler sağlanmalıdır:

### Dosya kriterleri
- yalnız 2 yeni dosya açılmış olmalı
- modül klasör ağacı açılmamış olmalı

### Frontend kriterleri
- admin panel ayrı JSX dosyasında çalışmalı
- `App.jsx` içine büyük admin render mantığı gömülmemeli
- yeni UI kütüphanesi eklenmemeli
- panel koyu ve modern görünmeli
- panel düşük yükle açılmalı

### Backend kriterleri
- admin route'ları allowlist ile korunmalı
- route'lar read-only olmalı
- summary endpoint tek çağrıda overview verisini vermeli
- trades endpoint risk alanlarını döndürmeli
- feedback endpoint pagination desteklemeli

### Ürün kriterleri
- panel fon hareketi yapmamalı
- panel dispute authority üretmemeli
- panel incomplete snapshot ve riskli trade görünürlüğü sağlamalı
- panel worker lag ve DLQ derinliğini görünür kılmalı

---

## 16. Fazlı Uygulama Planı

# Faz 1
- `backend/scripts/routes/admin.js`
- `/summary`
- `/feedback`
- `App.jsx` mount
- `AdminPanel.jsx` Overview + Sync

# Faz 2
- `/trades`
- Trades sekmesi
- filtreler
- expand detay görünümü

# Faz 3
- DLQ metrik export
- scheduler last-run görünürlüğü
- summary ekranının olgunlaştırılması

---

## 17. Codex Uygulama Kontrol Listesi

## 17.1 Backend
- [ ] `backend/scripts/routes/admin.js` oluştur
- [ ] `requireAuth` ve `requireSessionWalletMatch` ile koru
- [ ] env tabanlı admin wallet allowlist ekle
- [ ] `GET /api/admin/summary` ekle
- [ ] `GET /api/admin/trades` ekle
- [ ] `GET /api/admin/feedback` ekle
- [ ] `backend/scripts/app.js` içine route mount et
- [ ] `dlqProcessor.js` içine `getDlqMetrics()` export ekle
- [ ] `app.js` içine scheduler last-run state ekle

## 17.2 Frontend
- [ ] `frontend/src/AdminPanel.jsx` oluştur
- [ ] tab mantığını ekle
- [ ] Overview ekranını yaz
- [ ] Sync ekranını yaz
- [ ] Trades ekranını yaz
- [ ] Feedback ekranını yaz
- [ ] `App.jsx` içine ince bir mount point ekle
- [ ] mevcut tema ile uyumlu karanlık görünüm uygula
- [ ] yeni dependency ekleme

---

## 18. Nihai Karar

Bu repo için en doğru admin panel çözümü şudur:

- ayrı ama tek bir JSX dosyası
- ayrı ama tek bir backend route dosyası
- modern ama dependency-free görünüm
- read-only ops console
- minimum dosya artışı
- maksimum repo görünürlüğü

Bu tasarım hem ürün planındaki admin observability hedefiyle uyumludur, hem de repo şişmesini önler.

