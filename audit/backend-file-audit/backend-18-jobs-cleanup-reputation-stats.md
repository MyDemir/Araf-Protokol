# Backend Audit 18 — Jobs (Cleanup, Reputation Decay, Stats Snapshot)

Date: 2026-04-30  
Auditor: Codex (GPT-5.3-Codex)

## Scope
Primary files:
- `backend/scripts/jobs/cleanupPendingListings.js`
- `backend/scripts/jobs/cleanupSensitiveData.js`
- `backend/scripts/jobs/cleanupUserBankRiskMetadata.js`
- `backend/scripts/jobs/reputationDecay.js`
- `backend/scripts/jobs/statsSnapshot.js`

Related files checked:
- `backend/scripts/models/User.js`
- `backend/scripts/models/Order.js`
- `backend/scripts/models/Trade.js`
- `backend/scripts/models/HistoricalStat.js`
- `backend/scripts/services/protocolConfig.js`
- `backend/scripts/services/eventListener.js`
- `contracts/src/ArafEscrow.sol`

Related tests checked:
- `backend/test/cleanupSensitiveData.test.js`
- `backend/test/reputationDecay.job.test.js`
- `backend/test/scheduler.successContract.test.js`

## Executive summary
Genel tablo güvenli sınırda: cleanup/reputation/stats job’ları on-chain authority’yi overwrite etmiyor ve çoğunlukla read-model/retention odaklı çalışıyor. Özellikle:
- Pending listing cleanup V3’te bilinçli no-op; aktif order/trade silme riski yaratmıyor.
- Sensitive cleanup yalnız terminal trade durumlarında çalışıyor.
- Reputation decay’de nihai eligibility on-chain `getReputation()` ile doğrulanıyor.

Ana riskler operasyonel ve performans tarafında:
1. Scheduler success kontratında `undefined => success` semantiği job implementasyon hatalarını gizleyebilir.
2. `statsSnapshot` birden fazla aggregate + full-set find akışıyla büyüyen mainnet verisinde ağırlaşabilir.
3. Job overlap/lock mekanizması bu dosyalarda yerel olarak görünmüyor; scheduler katmanı disiplinine bağımlı.

## Findings by review target

### 1) Cleanup job yanlış aktif order/trade verisi silebilir mi?
**Sonuç: Düşük risk.**
- `cleanupPendingListings` V3’te explicit no-op; veri mutasyonu yapmıyor.
- `cleanupSensitiveData` yalnız `RESOLVED/CANCELED/BURNED` terminal trade’lere dokunuyor.
- Aktif lifecycle state’lerde receipt/payout snapshot temizliği yapılmıyor.

### 2) PII/receipt/snapshot cleanup retention doğru mu?
**Sonuç: Büyük ölçüde doğru.**
- `receipt_delete_at <= now` ve terminal-state guard ile receipt payload null’lanıyor.
- `snapshot_delete_at <= now` ve terminal-state guard ile payout snapshot + lock-time risk metadata null’lanıyor.
- On-chain referans kimlikleri korunuyor, decryptable içerik kaldırılıyor.

**Caveat:** `payout_snapshot.is_complete` cleanup sonrası `true` setleniyor; bu alan semantik olarak “snapshot bir zamanlar complete miydi” yerine “şu an data var mı” gibi yanlış okunursa analitikte karışıklık yaratabilir.

### 3) User bank risk metadata cleanup PII policy ile uyumlu mu?
**Sonuç: Evet, uyumlu.**
- Job yalnız rolling risk metadata ve history prune yapıyor.
- `profileVersion` gibi identity/lifetime counter geri sarılmıyor.
- Per-user hata durumunda tüm job’ı düşürmeyip warn ile devam ediyor (operasyonel dayanıklılık).

### 4) Pending listings cleanup on-chain drift yaratır mı?
**Sonuç: Hayır (mevcut tasarımda).**
- Job no-op olduğundan authoritative on-chain order/trade state ile drift üretmez.

### 5) Reputation decay contract authority ile çelişiyor mu?
**Sonuç: Çelişmiyor.**
- Aday havuzu Mongo’dan çıkarılsa da nihai karar kontrat `getReputation()` dönüşüyle veriliyor.
- İşlem `decayReputation()` on-chain çağrısıyla tamamlanıyor; backend local override yapmıyor.

### 6) Job overlap veya concurrency riski var mı?
**Sonuç: Orta risk (scheduler bağımlı).**
- İncelenen job dosyalarında distributed lock/lease mekanizması yok.
- Aynı job’ın eşzamanlı birden fazla instance tarafından çalıştırılması scheduler konfigurasyonuna bırakılmış.
- `cleanup` job’larında idempotent/null-set yaklaşımı etkileri azaltır; `reputationDecay` tarafında duplicate tx denemesi oluşabilir (kontrat yetki/doğrulama katmanı son savunma).

### 7) Job failure success gibi raporlanabilir mi?
**Sonuç: Evet, potansiyel var.**
- `scheduler.successContract` testi `undefined` sonucu başarı sayıyor.
- Job implementasyonu yanlışlıkla return unutursa scheduler bunu “başarı” görebilir.
- Buna karşın birçok job explicit `{ success: false }` dönüyor; tasarım niyeti doğru ama kontrat toleransı gevşek.

### 8) statsSnapshot heavy query/mainnet performance riski taşıyor mu?
**Sonuç: Evet, orta risk.**
- Aynı çalışmada çoklu aggregate + count + resolved/executed/burned trade listeleri okunuyor.
- Veri seti büyüdükçe özellikle full list reads (`Trade.find(...).select(...).lean()`) maliyeti artar.
- Günlük cron için kabul edilebilir olabilir; ancak ana ağ ölçeğinde indeks/partition ve incremental snapshot stratejisi değerlendirilmeli.

### 9) Scheduler lock veya idempotency yeterli mi?
**Sonuç: Kısmi.**
- Cleanup tarafı çoğunlukla idempotent.
- Stats snapshot aynı gün için upsert yaptığı için tekrar çalıştırma güvenli.
- Reputation decay tekrar çalıştırmada on-chain guard’a dayanır; yerel “in-flight” lock görünmüyor.

### 10) Testler destructive cleanup edge-case’lerini kapsıyor mu?
**Sonuç: Kısmi kapsama.**
- Mevcut testler terminal-state guard ve bazı alan nulling doğrulamasını yapıyor.
- Eksik kalanlar:
  1. Non-terminal trade’in cleanup dışında kaldığını veri düzeyinde doğrulayan test.
  2. `receipt_delete_at` / `snapshot_delete_at` future-date olduğunda no-op testi.
  3. User-bank cleanup’ta per-user exception sırasında diğer kullanıcıların devam ettiğini doğrulama.
  4. Reputation decay’de getReputation fail/timeout oranı yüksekken sonuç semantiği.

## Risk matrix
- MEDIUM: scheduler success kontratında `undefined => success` kabulü.
- MEDIUM: statsSnapshot’ın büyüyen veri hacminde query maliyeti.
- MEDIUM: job-level distributed lock yokluğu (scheduler dış bağımlılığı).
- LOW: cleanup sonrası bazı semantik alanların analitikte yanlış yorumlanma riski.

## Recommendations
1. Scheduler katmanında job-level mutex/lease (Redis lock vb.) zorunlu hale getirilmeli.
2. `didScheduledJobSucceed` için `undefined` sonucu warning/failure olarak ele alma opsiyonu düşünülmeli.
3. `statsSnapshot` için incremental/materialized yaklaşım veya daha dar projection/index stratejisi uygulanmalı.
4. Cleanup ve decay için ek edge-case testleri eklenmeli (özellikle non-terminal, future retention, per-user failure continuity).
5. Job telemetry: duration, scanned/modified, error-rate, overlap-detected metrikleri standartlaştırılmalı.

## Authority boundary check
- Oracle-free dispute modeli korunuyor.
- Settlement/release/cancel/burn/payout authority kontratta kalıyor.
- Job’lar on-chain sonucu backend verisiyle override etmiyor; read-model ve operasyonel bakım sınırında kalıyor.
