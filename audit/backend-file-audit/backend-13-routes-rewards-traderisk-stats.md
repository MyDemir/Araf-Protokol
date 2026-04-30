# Backend File Audit — routes: rewards / tradeRisk / stats (13)

## 1. Scope
İncelenen dosyalar:
- backend/scripts/routes/rewards.js
- backend/scripts/routes/tradeRisk.js
- backend/scripts/routes/stats.js

İlişkili dosyalar:
- backend/scripts/models/RewardClaim.js
- backend/scripts/models/RewardEpoch.js
- backend/scripts/models/RewardEpochAllocationEvent.js
- backend/scripts/models/RewardFunding.js
- backend/scripts/models/HistoricalStat.js
- backend/scripts/models/Trade.js
- backend/scripts/services/eventListener.js
- contracts/src/ArafRewards.sol
- contracts/src/ArafRevenueVault.sol
- frontend/src/components/RewardsDashboard.jsx

İlişkili testler:
- backend/test/rewards.authority.readonly.regression.test.js
- backend/test/rewards.currentEpoch.route.test.js
- backend/test/rewards.mirrorAuthority.route.test.js
- backend/test/tradeRisk.readModel.test.js
- backend/test/stats.logs.rateLimiter.route.test.js

## 2. Method
- Üç route dosyası endpoint bazında auth/authority/data shaping/pagination-limit açısından okundu.
- Reward model alan tipleri ve index politikaları contract event payload semantiğiyle karşılaştırıldı.
- tradeRisk payload’ının non-blocking/read-only contractı ve naming drift dayanıklılığı incelendi.
- stats route query patterni (cache hit/miss, DB query sayısı, boundedness, leak surface) değerlendirildi.
- İlişkili testlerin gerçekten “readonly authority sınırı”nı doğrulayıp doğrulamadığı kontrol edildi.

## 3. Function / Section Notes
- **Rewards authority sınırı**: `/claimable` endpoint’i hesaplama yapmıyor; explicit olarak on-chain getter’a yönlendiriyor.
- **Current epoch semantiği**: `/epochs/current` wall-clock estimate dönüyor ve non-authority etiketi taşıyor.
- **Mirror-only health**: `/admin/rewards/health` sadece doküman sayıları döndürüyor (`mirror_only: true`).
- **BigInt-safe amount taşıma**: RewardClaim/RewardFunding/RewardEpoch/Allocation model alanlarında amount/weight string formatında.
- **tradeRisk boundary**: `buildTradeHealthSignals` readOnly+nonBlocking+canBlockProtocolActions=false contractını açık taşıyor.
- **stats bounded query**: endpoint cache miss’te iki adet `findOne` ve hafif hesaplama yapıyor; unbounded aggregation yok.

## 4. Findings

| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| B13-F01 | MEDIUM (uncertain) | stale-read-model | backend/scripts/routes/rewards.js (`/:wallet/claimable`, `/epochs/current`) | Claimable endpoint bilerek boş dönüyor ve current epoch wall-clock estimate kullanıyor. Bu doğru authority sınırı sağlasa da frontend yalnız mirror’a bakarsa kullanıcı stale/eksik claimability algısı yaşayabilir. | Kullanıcı “claim yok” veya “epoch yanlış” sanabilir; yanlış UX kararları oluşabilir. | `ESTIMATE_UNAVAILABLE_USE_ONCHAIN_GETTER` ve `WALL_CLOCK_ESTIMATE_NOT_AUTHORITY` bayrakları mevcut. | Frontend’de claim butonu öncesi on-chain `claimable()`/`currentEpoch()` doğrulaması zorunlu akış olarak korunmalı. |
| B13-F02 | MEDIUM | access-control | backend/scripts/routes/rewards.js | Route genelinde auth middleware yok; reward history/funding/revenue verileri public erişilebilir. Bu authority ihlali değil, fakat mainnet’te telemetry/scrape yüzeyi geniş olabilir. | Yüksek istek hacminde scraping/ops yükü; bazı operasyonel akışlar gereğinden fazla görünür olabilir. | Endpointlerde `requireAuth`/rate limiter kullanılmıyor. | Public kalacaksa dedicated rate-limit + cache + ops visibility policy eklenmeli; admin yüzeyleri için auth değerlendirmesi yapılmalı. |
| B13-F03 | LOW | formatting-safety | frontend/src/components/RewardsDashboard.jsx | `BigInt(claimableAmount)` çağrısı non-numeric string payload alırsa throw edebilir (UI crash). Backend şu an claimable boş dizi döndürdüğü için latent risk. | Mirror/adapter değişikliğinde frontend runtime kırılabilir. | Claim button disable check’i doğrudan `BigInt()` çağırıyor. | UI’da safe parse helper kullanılması önerilir (try/catch veya regex guard). |
| B13-F04 | LOW | naming-drift | backend/scripts/routes/tradeRisk.js + tests | tradeRisk helper canonical `disputed_resolved_count` ile legacy `disputed_but_resolved_count` aliasını birlikte taşıyor. Geriye uyumluluk iyi; ancak uzun vadede semantik çiftlenme riski var. | Tüketici katmanda yanlış alan okuma/çift yorum riski. | Kodda alias map mevcut ve testler her iki adla doğrulama yapıyor. | Canonical alanı netleyip aliası deprecation planıyla sürdürmek önerilir. |
| B13-F05 | INFO | readonly-authority | rewards/tradeRisk routes + tests | Backend reward/trade risk yüzeyleri ekonomik authority üretmiyor; route/test dili bunu açık taşıyor. | Pozitif not: oracle-free dispute ve on-chain authority sınırı korunuyor. | Rewards readonly regression + mirror authority + tradeRisk read-only bayrakları. | Regression testleri yeni endpointler için de genişletin. |
| B13-F06 | INFO | stats-surface | backend/scripts/routes/stats.js + tests | Stats endpoint public ama veri seti aggregate ve non-sensitive; cache + dedicated `statsReadLimiter` ile korunuyor. | Pozitif not: ağır query ve veri sızıntısı riski düşük tutulmuş. | Cache key/TTL + `statsReadLimiter` wiring testi mevcut. | Cache miss observability ve error budget metriği izlenmeye devam edilmeli. |

## 5. No-Finding Notes
- Reward amount/weight alanlarında string/base-unit yaklaşımı BigInt güvenliği için doğru.
- tradeRisk katmanı protokol aksiyonlarını bloklamadığını açıkça belirtiyor.
- stats response PII veya imza/secret benzeri hassas alanları içermiyor.
- ArafRewards/ArafRevenueVault contract fonksiyonları ekonomik authority’nin on-chain’de kaldığını net biçimde koruyor.

## 6. Cross-File Risks
- **Mirror freshness riski**: reward mirror gecikmesi frontend claimability deneyimini yanıltabilir (authority değil, UX riski).
- **Public scraping riski**: auth’suz rewards read endpoints hacimli indexer/scraper trafiğinde operasyonel maliyet doğurabilir.
- **Naming drift riski**: tradeRisk alias katmanı uzun süre korunursa tüketiciler canonical olmayan alana bağımlı kalabilir.

## 7. Follow-up
Sonraki inceleme için önerilen dosyalar:
- frontend rewards data flow (on-chain claimable doğrulama zorunluluğu)
- backend/scripts/routes/rewards.js (public/admin ayrımı + limiter strategy)
- backend/scripts/services/eventListener.js (reward mirror freshness metrics)
- backend/test/rewards*.test.js ve stats route testleri (stale mirror + malformed claimable payload regressions)
