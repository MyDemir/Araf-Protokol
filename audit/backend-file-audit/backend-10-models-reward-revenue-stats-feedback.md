# Backend File Audit — Reward / Revenue / Stats / Feedback models (10)

## 1. Scope
İncelenen dosyalar:
- backend/scripts/models/Feedback.js
- backend/scripts/models/HistoricalStat.js
- backend/scripts/models/RevenueEvent.js
- backend/scripts/models/RewardClaim.js
- backend/scripts/models/RewardEpoch.js
- backend/scripts/models/RewardEpochAllocationEvent.js
- backend/scripts/models/RewardFunding.js

İlişkili dosyalar:
- backend/scripts/routes/rewards.js
- backend/scripts/routes/stats.js
- backend/scripts/services/eventListener.js
- backend/scripts/jobs/statsSnapshot.js
- contracts/src/ArafRevenueVault.sol
- contracts/src/ArafRewards.sol
- frontend/src/components/RewardsDashboard.jsx

İlişkili testler:
- backend/test/rewards.authority.readonly.regression.test.js
- backend/test/rewards.currentEpoch.route.test.js
- backend/test/rewards.mirrorAuthority.route.test.js
- backend/test/eventListener.epochAllocationMirror.test.js

## 2. Method
- Model şemaları alan tipi/index/unique politikası açısından satır bazlı incelendi.
- Reward/revenue event imzaları (ArafRevenueVault + ArafRewards) ile worker mirror yazımları karşılaştırıldı.
- Route ve frontend yüzeyinde “mirror-only / non-authoritative” sözleşmesi doğrulandı.
- Stats snapshot aggregation semantiği ve HistoricalStat query kalıbı performans/yanlış-toplama açısından değerlendirildi.
- Mevcut testlerin duplicate/idempotency/authority sınırı kapsaması gözden geçirildi.

## 3. Function / Section Notes
- **Duplicate mirror koruması**: `RevenueEvent`, `RewardClaim`, `RewardFunding`, `RewardEpochAllocationEvent` için `{tx_hash,log_index}` unique index var.
- **Epoch-token uniqueness**: `RewardEpoch` için `{epoch, token}` unique index mevcut; aynı epoch-token satırı tekilleştiriliyor.
- **Amount alanları**: reward/revenue/funding/claim amount ve weight alanları string tutuluyor (base-unit güvenli).
- **Authority sınırı**: rewards route yalnız read/mirror endpoint sunuyor; claimable endpoint explicit olarak on-chain getter’a yönlendiriyor.
- **Dashboard dili**: frontend metni recipient/weight/outcome seçimini sponsor ve backend’den dışlıyor; on-chain authority sınırı doğru iletiyor.
- **Stats**: historical stat’ta hem approximate Number hem string-safe karşılıklar birlikte tutuluyor; route metadata’da approximate uyarısı var.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B10-F01 | MEDIUM | chain-partitioning | backend/scripts/models/RevenueEvent.js + Reward*.js | Reward/revenue model dokümanlarında `chain_id` veya `contract_address` alanı yok. Unique key yalnız `tx_hash+log_index`; multi-chain veya yanlış RPC yeniden indeksleme durumunda çakışma/karışma riski doğurabilir. | Aynı tx hash/log index farklı ağlarda üretilebilir; mirror kayıtları hatalı overwrite/skip olabilir. | Tüm event modellerinde unique key chain’den bağımsız. | Mirror şemalarına `chain_id` (ve opsiyonel `contract_address`) eklenip compound unique key chain-aware yapılmalı. |
| B10-F02 | MEDIUM | data-quality | backend/scripts/models/RewardEpochAllocationEvent.js | Allocation event modelinde `block_number` alanı yok; route/ops tarafında deterministik block-range re-audit ve incident triage zorlaşır. | Reorg/replay analizinde olay sırası ve kapsam doğrulaması zorlaşır. | Şema `tx_hash/log_index/epoch/token/amount` içeriyor ama `block_number` içermiyor. | `block_number` eklenip indexlenmesi önerilir. |
| B10-F03 | LOW | abuse-surface | backend/scripts/models/Feedback.js | Feedback `comment` alanında içerik sanitization yok (length limiti var). React varsayılan escaping ile XSS riski düşüktür ancak admin/export/reporting pipeline’larında ham render edilirse injection/PII sızıntısı yaşanabilir. | İçerik downstream sistemlerde unsafe render edilirse güvenlik/uyumluluk riski. | `maxlength` mevcut, fakat pattern/sanitization yok. | Persist öncesi normalize+sanitize policy (örn. control-char strip) ve admin render’da strict escaping zorunlu tutulmalı. |
| B10-F04 | LOW | perf-query | backend/scripts/routes/stats.js + models/HistoricalStat.js | Stats route 30 gün önceki veriyi exact `YYYY-MM-DD` eşleşmesiyle arıyor; snapshot atlanan günlerde change alanı null kalır. Ayrıca date string bazlı desen büyüyen koleksiyonda range analytics’i sınırlayabilir. | Zaman serisi analitiğinde boşluklar artarsa trend sinyali zayıflar. | `findOne({ date: dateString30d })` exact match kullanıyor. | “en yakın önceki gün” fallback query ve gerekirse Date-type secondary alan değerlendirilmeli. |
| B10-F05 | INFO | duplicate-protection | reward/revenue models + tests | Claim/funding/revenue/allocation mirrorlarında event-level idempotency için unique index deseni uygulanmış; allocation için replay idempotency testi mevcut. | Pozitif not: duplicate mirror üretimi önemli ölçüde azaltılmış. | `tx_hash+log_index unique` ve `eventListener.epochAllocationMirror` testi. | Aynı idempotency güvence testleri revenue/claim/funding için de genişletilebilir. |
| B10-F06 | INFO | authority-boundary | rewards route + frontend + contracts | Backend ve frontend authority üretmiyor; contract-authoritative model korunuyor (`recordTradeOutcome/allocate/claim/finalize` sadece kontratta). | Pozitif not: oracle-free dispute ve ekonomik karar authority’si on-chain’de kalıyor. | Route response source flagleri + dashboard metni + ArafRewards fonksiyonları. | Bu sınırı koruyan regression testleri (readonly/ mirror) CI’da zorunlu tutulmalı. |

## 5. No-Finding Notes
- Reward epoch/claim/funding alan adları kontrat event payload’larıyla uyumlu (epoch, token, amount, userWeight/totalWeight vb.).
- Duplicate claim/allocation mirror riski unique event key yaklaşımıyla kontrol altında.
- Amount alanlarının string/base-unit tutulması ekonomik hassasiyet açısından doğru.
- RewardsDashboard, backend verisini authoritative payout kararı gibi sunmuyor.

## 6. Cross-File Risks
- **Chain context eksikliği**: event modelleri tek-chain varsayımına bağlı; future multi-chain/chain-misconfig senaryolarında veri bütünlüğü riski artar.
- **Ops observability riski**: bazı event mirror kayıtlarında block-level iz düşümü eksikliği incident response’u zorlaştırabilir.
- **Feedback downstream riski**: model katmanı güvenli olsa da görüntüleme/export yüzeyleri sanitize zorunluluğu taşıyor.
- **Stats continuity riski**: günlük snapshot boşluklarında 30d değişim metriği sessizce null kalabilir.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- backend/scripts/services/eventListener.js (revenue/claim/funding idempotency test coverage genişletme)
- backend/scripts/routes/rewards.js (ops query’leri için chain-aware filtre stratejisi)
- backend/scripts/jobs/statsSnapshot.js (gap-tolerant historical comparison)
- frontend admin/reporting yüzeyleri (feedback render sanitization doğrulaması)
