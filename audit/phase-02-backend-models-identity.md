# Phase 02 — Backend Models / Identity / Persistence Correctness

## Scope
İncelenen dosyalar:
- backend/scripts/migrations/normalizeIdentityFields.js
- backend/scripts/models/Feedback.js
- backend/scripts/models/HistoricalStat.js
- backend/scripts/models/Order.js
- backend/scripts/models/RevenueEvent.js
- backend/scripts/models/RewardClaim.js
- backend/scripts/models/RewardEpoch.js
- backend/scripts/models/RewardEpochAllocationEvent.js
- backend/scripts/models/RewardFunding.js
- backend/scripts/models/Trade.js
- backend/scripts/models/User.js
- backend/scripts/services/identityNormalizationGuard.js

İlişkili testler:
- backend/test/identityMigration.test.js
- backend/test/identityGuard.defaultMode.test.js
- backend/test/identityGuard.modeValidation.test.js
- backend/test/identityLookup.noExpr.test.js
- backend/test/ordersTrades.paginationBigId.test.js
- backend/test/user.publicProfile.reputationBreakdown.test.js
- backend/test/tradeRisk.readModel.test.js

## Method
- `docs/TR/ux.md` sırası referans alınarak model/migration/guard katmanı tek tek açılıp satır bazlı okundu.
- Büyük dosyalar (`Trade.js`, `User.js`) bölüm bölüm (kimlik, financials, PII snapshot, indexes, methods) incelendi.
- Migration helper’ları ve guard davranışı testlerle çapraz kontrol edildi.
- Bulgular yalnız okunmuş kod üzerinden yazıldı.

## File-by-File Notes
| Dosya | Durum | İnceleme derinliği | Not |
|---|---|---|---|
| normalizeIdentityFields.js | İncelendi | Fonksiyon bazlı | Chunked/idempotent migration + collision preflight mevcut. |
| Feedback.js | İncelendi | Satır bazlı | TTL + wallet index var, basit model. |
| HistoricalStat.js | İncelendi | Satır bazlı | Number + string twin alanlar birlikte tutuluyor. |
| Order.js | İncelendi | Schema+index | onchain_order_id string+unique, refs.order_ref unique. |
| RevenueEvent.js | İncelendi | Schema+index | tx_hash+log_index unique idempotency var. |
| RewardClaim.js | İncelendi | Schema+index | tx_hash+log_index unique, epoch/token/user query alanları indexed. |
| RewardEpoch.js | İncelendi | Schema+index | epoch+token unique. |
| RewardEpochAllocationEvent.js | İncelendi | Schema+index | tx_hash+log_index unique. |
| RewardFunding.js | İncelendi | Schema+index | tx_hash+log_index unique; product_id index var. |
| Trade.js | İncelendi | Bölüm bölüm | Identity string fields, snapshot PII ayrımı, TTL/index yapısı incelendi. |
| User.js | İncelendi | Bölüm bölüm | Public profile allowlist, bank drift counters, reputation mirror ayrımı incelendi. |
| identityNormalizationGuard.js | İncelendi | Fonksiyon bazlı | mode validation güçlü; numeric-type taraması dar kapsamlı. |
| İlişkili testler | İncelendi | Test-by-test | Migration yardımcıları iyi; bazı guard/mirror senaryolarında gap var. |

## Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P02-001 | HIGH | state-machine | backend/scripts/services/identityNormalizationGuard.js / verifyIdentityNormalization | Guard yalnız BSON numeric tipleri (`int/long/double/decimal`) sayıyor; string formatta ama normalize edilmemiş legacy kimlikleri (örn. `"42.0"`, `"+42"`, `"0042"`) algılamıyor. | Guard “ok” dönerken kimlik canonicalizasyonu tamamlanmamış kalabilir; route/query eşleşmelerinde drift ve duplicate mantıksal ID riski doğar. | `countDocuments` filtreleri yalnız `$type: NUMERIC_BSON_TYPES`; migration normalize fonksiyonu ise string numeric varyantlarını da canonicalize ediyor. | Guard’a string-anomali taraması eklenmeli (regex + canonical compare) veya migration sonrası canonical invariant check eklenmeli. |
| P02-002 | MEDIUM | accounting-math | backend/scripts/models/Order.js, Trade.js, HistoricalStat.js | Otoritatif string alanlarla birlikte `_num` cache alanları tutuluyor ancak schema seviyesinde bu çiftler arasında invariant/consistency doğrulaması yok. | Büyük değerlerde Number precision drift veya stale cache UI/analytics’te yanlış sıralama/özet üretip operasyonda yanlış karar riski yaratabilir. | `*_num` alanları default/optional; string<->num eşleşmesini zorlayan validator/hook görünmüyor. | `_num` alanları açıkça non-authoritative kalsa da, write-pathte deterministic cast+cap ve periodic consistency check planlanmalı. |
| P02-003 | MEDIUM | testing-gap | backend/test/identityGuard.defaultMode.test.js, identityLookup.noExpr.test.js | Kritik guard/lookup davranışlarının bir bölümü source-string içerik testleriyle doğrulanıyor, runtime davranış testi sınırlı. | Refactor’da davranış bozulurken testler yeşil kalabilir veya tersine sadece metin değişiminden kırılabilir. | `toContain(...)` / `not.toContain(...)` yaklaşımı kullanılıyor. | Davranışsal testler (mocked model/query ile actual function outcomes) artırılmalı. |
| P02-004 | LOW | PII-data-protection | backend/scripts/models/Trade.js / payout_snapshot & evidence | PII verisi şifreli alanlara ayrılmış olsa da `contact_channel`, `country`, `rail` gibi meta alanlar plaintext tutuluyor. | Tek başına yüksek hassasiyet değil; ama korelasyonla profiling yüzeyi artabilir (özellikle uzun retention senaryolarında). | `payout_snapshot.*` altında kanal/ülke/rail alanları düz string, şifreli payload ayrı alanlarda. | Retention ve erişim katmanında bu meta alanlar için de minimizasyon/need-to-know politikası dokümante edilmeli. |

## No-Finding Notes
- On-chain kimlik alanları (`onchain_order_id`, `onchain_escrow_id`, `parent_order_id`) schema’da string regex (`^\d+$`) ile tanımlı; lexicographic sort riski bu model katmanında doğrudan tetiklenmiyor (çoğunlukla exact match/index kullanımı var).
- Order ID ile trade/escrow ID alanları ayrık isimlendirilmiş ve ayrı alanlarda tutuluyor; doğrudan schema-level karışma görülmedi.
- Event mirror modellerinde (`RevenueEvent`, `RewardClaim`, `RewardEpochAllocationEvent`, `RewardFunding`) tx_hash+log_index unique kısıtları duplicate mirror riskini azaltıyor.
- `User.toPublicProfile()` allowlist yaklaşımıyla `reputation_breakdown` ve payout/bank history alanlarını dışarı sızdırmıyor.
- Migration yardımcıları idempotent/chunked/collision-aware tasarlanmış; ilgili testler bu çekirdek davranışları kapsıyor.

## Cross-File Observations
- Migration fonksiyonu canonicalizasyonu geniş ele alırken (`normalizeIdentityValue`), runtime guard daha dar kapsam tarıyor; migration-vs-guard semantik drift mevcut.
- Trade/User şemalarında “authority değil mirror” prensibi yorum ve alan yapısında tutarlı; oracle-free ve contract-authority çizgisi korunmuş.
- Persistence katmanında analitik kolaylık için Number cache yoğun kullanılıyor; bu tasarımın güvenli kalması write/read path disiplinine bağımlı.

## Follow-up Needed
- Sonraki fazlarda routes/services katmanında `*_num` alanlarının nerede karar/verdict etkilediği doğrulanmalı.
- Identity guard için string-anomali görünürlüğü (warn/enforce dashboard metriği dahil) ayrıca değerlendirilmeli.
- Trade/User retention ve cleanup job’larının gerçek çalışması (snapshot/meta minimization) jobs fazında tekrar çapraz incelenmeli.
