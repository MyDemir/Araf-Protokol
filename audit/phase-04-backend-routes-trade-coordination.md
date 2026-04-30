# Phase 04 — Backend Routes / Trade Coordination / Read-Model Authority

## Scope
İncelenen dosyalar:
- backend/scripts/routes/admin.js
- backend/scripts/routes/feedback.js
- backend/scripts/routes/listings.js
- backend/scripts/routes/logs.js
- backend/scripts/routes/orders.js
- backend/scripts/routes/referenceRates.js
- backend/scripts/routes/rewards.js
- backend/scripts/routes/stats.js
- backend/scripts/routes/tradeRisk.js
- backend/scripts/routes/trades.js

İlişkili testler:
- backend/test/admin.routes.resilience.test.js
- backend/test/orders.config.test.js
- backend/test/orders.marketTrustVisibility.route.test.js
- backend/test/orderListing.sortSemantics.test.js
- backend/test/rewards.authority.readonly.regression.test.js
- backend/test/rewards.currentEpoch.route.test.js
- backend/test/rewards.mirrorAuthority.route.test.js
- backend/test/referenceRates.route.test.js
- backend/test/referenceTicker.nonAuthorityCoupling.test.js
- backend/test/stats.logs.rateLimiter.route.test.js
- backend/test/trades.cancelSignature.test.js
- backend/test/trades.offchainHealthScoreInput.route.test.js
- backend/test/trades.settlementProposal.route.test.js
- backend/test/tradeRisk.readModel.test.js

## Method
- Route dosyaları endpoint endpoint, auth middleware zinciri, ID parsing ve hesaplama akışıyla okundu.
- `trades.js` içinde cancel-signature ve settlement preview hesapları fonksiyon/satır bazında incelendi.
- Read-model authority sınırları (`informational_only`, mirror-only) route + test çaprazı ile doğrulandı.

## File-by-File Notes
| Dosya | Durum | İnceleme derinliği | Not |
|---|---|---|---|
| admin.js | İncelendi | Endpoint bazlı | Global auth/session/admin guard uygulanıyor; geniş operasyonel görünürlük var. |
| feedback.js | İncelendi | Endpoint bazlı | Auth + session match + limiter zinciri mevcut. |
| listings.js | İncelendi | Endpoint bazlı | V3 deprecate/write redirection semantiği korunmuş. |
| logs.js | İncelendi | Endpoint bazlı | Client error ingest + scrub yaklaşımı değerlendirildi. |
| orders.js | İncelendi | Endpoint + query | Public vs user-scoped ayrımı ve ID parsing incelendi. |
| referenceRates.js | İncelendi | Endpoint bazlı | Public read route, marketRead limiter altında. |
| rewards.js | İncelendi | Endpoint bazlı | Read-only/mirror semantiği güçlü, write otoritesi yok. |
| stats.js | İncelendi | Endpoint bazlı | Public lightweight telemetry surface. |
| tradeRisk.js | İncelendi | Fonksiyon bazlı | Non-authoritative read-model sinyal üretimi korunmuş. |
| trades.js | İncelendi | Endpoint + hesaplama | Cancel signature verification + settlement preview path’leri incelendi. |
| İlişkili testler | İncelendi | Test-by-test | Kritik alanların çoğu kapsanıyor, bazı auth bypass varyantlarında gap var. |

## Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P04-001 | HIGH | access-control | backend/scripts/routes/admin.js / requireAdminWallet | `ADMIN_WALLETS` boşsa tüm admin erişimi 403’e düşüyor; bu güvenli ama operasyonel olarak “silent lockout” davranışı. Ayrıca startup fail-fast yok. | Mainnet incident sırasında admin gözlem yüzeyinin yanlış env ile tamamen devre dışı kalması müdahale süresini uzatabilir. | Guard runtime’da env parse ediyor ve `allowed.length===0` durumunda deny ediyor; app bootstrap’ta zorunlu env doğrulaması görünmüyor. | Production’da `ADMIN_WALLETS` için startup-time validation + observability alert eklenmeli. |
| P04-002 | HIGH | frontend-tx-orchestration | backend/scripts/routes/trades.js / settlement preview | Settlement preview hesapları BigInt ile doğru kurgulanmış olsa da endpoint `roomReadLimiter` altında ve read path gibi ele alınıyor; yoğun brute preview çağrılarında CHALLENGED trade başına on-chain `getCurrentAmounts` okuma maliyeti yükselir. | RPC saturasyonu ile coordination yüzeyi yavaşlayabilir; trade odası operasyonel UX’i bozulabilir. | `/settlement-proposal/preview` route auth+session var ama write-adjacent maliyetli read olarak sınıflanmış. | Bu endpoint için ayrı stricter limiter bucket / cache policy düşünülmeli (authority üretmeden). |
| P04-003 | MEDIUM | testing-gap | backend/test/* (özellikle route/auth kombinasyonları) | Bazı route testleri auth middleware’i tamamen mocklayarak geçiyor; gerçek `requireSessionWalletMatch` invalidation side-effect’leri route seviyesinde doğrulanmıyor. | Auth bypass/regression senaryoları integration katmanda gözden kaçabilir. | Testlerde `requireAuth/requireSessionWalletMatch` stub’ları yaygın. | En kritik route’lar için gerçek middleware + mocked SIWE/Redis ile entegrasyon testleri eklenmeli. |
| P04-004 | LOW | logs-mismatch | backend/scripts/routes/logs.js | Client error log route’un scrub politikası mevcut; ancak serbest metin ingest yüzeyi abuse açısından yüksek hacimli/tekrarlı payload için içerik boyutu ve pattern cost açısından DoS yüzeyi oluşturabilir (uncertain). | Yüksek hacim log spam CPU/memory baskısı yaratabilir. | Route mevcut, limiter var; fakat payload size / regex worst-case davranışı bu faz kapsamındaki dosyalarda net limitlenmiş görünmüyor. | **uncertain**: kesinlemek için `logs.js` payload size guard ve upstream body limit uygulanışı birlikte ölçülmeli. |

## No-Finding Notes
- `orders.js` ve `trades.js` user-scoped endpointlerde `requireAuth + requireSessionWalletMatch` zinciri genel olarak tutarlı.
- Public route’lar (`orders` market list/detail, `referenceRates`, `stats`) read-only kalacak şekilde tasarlanmış.
- `trades.js` cancel signature doğrulamasında EIP-712 domain ve expected chain kontrolü bulunuyor; domain drift riskine karşı fail-closed yaklaşım var.
- Settlement preview’de BPS aralığı (`0..10000`) ve BigInt tabanlı payout/fee hesaplaması mevcut; negatif/overflow hataları doğrudan görülmedi.
- `rewards.js` yüzeyi read-only mirror verisi döndürüyor; economic authority üreten write endpoint görülmedi.
- `tradeRisk.js` sinyalleri açıkça non-blocking/informational olarak etiketlenmiş; on-chain authority’ye müdahale etmiyor.

## Cross-File Observations
- Route katmanında “authority kontratta kalır” prensibi yorumlarda ve response alanlarında sistematik olarak korunmuş.
- Ancak operasyonel olarak maliyetli read endpoint’ler (özellikle settlement preview) standard read bucket’larla birlikte çalışıyor; abuse-maliyet dengesi ayrı tuning gerektiriyor.
- Test paketi işlevsel olarak güçlü ama middleware gerçek davranışlarını route düzeyinde daha fazla uçtan uca doğrulama ihtiyacı var.

## Follow-up Needed
- Sonraki fazda services katmanında settlement/cancel yardımcılarının route ile birebir semantik uyumu yeniden çaprazlanmalı.
- Admin ve logs yüzeyinde operational hardening (env fail-fast + alerting + payload budget) için ops dokümanları ile birlikte değerlendirme yapılmalı.
