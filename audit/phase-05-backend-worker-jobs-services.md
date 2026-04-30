# Phase 05 — Backend Worker / Event Mirror / Replay / Finality / DLQ / Jobs / Protocol Config

## Scope
İncelenen dosyalar:
- backend/scripts/jobs/cleanupPendingListings.js
- backend/scripts/jobs/cleanupSensitiveData.js
- backend/scripts/jobs/cleanupUserBankRiskMetadata.js
- backend/scripts/jobs/reputationDecay.js
- backend/scripts/jobs/statsSnapshot.js
- backend/scripts/services/dlqProcessor.js
- backend/scripts/services/eventListener.js
- backend/scripts/services/expectedChain.js
- backend/scripts/services/health.js
- backend/scripts/services/protocolConfig.js
- backend/scripts/services/referenceTicker.js
- backend/scripts/services/tokenEnv.js

İlişkili testler:
- backend/test/eventListener.epochAllocationMirror.test.js
- backend/test/eventListener.escrowReleasedOrder.test.js
- backend/test/eventListener.finalityDepth.test.js
- backend/test/eventListener.identityEnv.test.js
- backend/test/eventListener.orderFilledMirror.test.js
- backend/test/eventListener.reputationAuthorityMirror.test.js
- backend/test/eventListener.rpcEnvRequired.test.js
- backend/test/eventListener.settlementProposalMirror.test.js
- backend/test/eventListener.tokenConfigRefresh.test.js
- backend/test/expectedChain.guard.test.js
- backend/test/protocolConfig.failclosed.test.js
- backend/test/protocolConfig.tokenConfig.test.js
- backend/test/referenceTicker.service.test.js
- backend/test/referenceTicker.nonAuthorityCoupling.test.js
- backend/test/reputationDecay.job.test.js
- backend/test/tokenEnv.chainAware.test.js
- backend/test/cleanupSensitiveData.test.js

## Method
- Worker/event mirror katmanı event/handler bazında okundu.
- Event ABI, arg-map ve handler binding’leri satır bazlı çapraz kontrol edildi.
- Replay/finality/checkpoint ve DLQ akışları state transition düzeyinde incelendi.
- Jobs + health + protocolConfig + tokenEnv + referenceTicker katmanları testlerle birlikte değerlendirildi.

## File-by-File Notes
| Dosya | Durum | İnceleme derinliği | Not |
|---|---|---|---|
| cleanupPendingListings.js | İncelendi | Satır bazlı | V3 uyumluluk no-op; authority üretmiyor. |
| cleanupSensitiveData.js | İncelendi | Fonksiyon bazlı | Terminal-state guard ile cleanup yapıyor. |
| cleanupUserBankRiskMetadata.js | İncelendi | Fonksiyon bazlı | Cursor-batch prune yaklaşımı mevcut. |
| reputationDecay.js | İncelendi | Fonksiyon bazlı | On-chain getReputation + decay call akışı var. |
| statsSnapshot.js | İncelendi | Hesaplama bazlı | Çoklu aggregate/count ile günlük snapshot üretimi. |
| dlqProcessor.js | İncelendi | Fonksiyon bazlı | Re-drive + poison arşiv + retry metric yapısı mevcut. |
| eventListener.js | İncelendi | Handler bazlı deep audit | ABI, arg-map, replay/poll/checkpoint, idempotent upsert pathleri okundu. |
| expectedChain.js | İncelendi | Fonksiyon bazlı | chain guard fail-closed davranışı kontrol edildi. |
| health.js | İncelendi | Fonksiyon bazlı | worker lag/finality/readiness göstergeleri mevcut. |
| protocolConfig.js | İncelendi | Fonksiyon bazlı | token config yükleme + cache refresh logic incelendi. |
| referenceTicker.js | İncelendi | Fonksiyon bazlı | informational-only + stale fallback davranışı var. |
| tokenEnv.js | İncelendi | Fonksiyon bazlı | chain-aware token mapping fail-closed guardları var. |
| İlişkili testler | İncelendi | Test-by-test | Event mirror/finality/chain/token guard kapsaması genel olarak iyi. |

## Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P05-001 | HIGH | deployment-env | backend/scripts/jobs/reputationDecay.js / getRelayer | Reputation decay signer path’inde expected-chain doğrulaması görünmüyor; `BASE_RPC_URL` yanlış ağa işaret ederse job yanlış network’e tx atmayı deneyebilir. | Yanlış ağda başarısız tx spam’i, operasyonel karmaşa ve yanlış güven varsayımı yaratır. | Job provider’ı doğrudan `new JsonRpcProvider(BASE_RPC_URL)` ile kuruyor; expected-chain guard entegrasyonu görünmüyor. | `expectedChain` guard decay job başlangıcına eklenmeli; chain mismatch’ta fail-closed + açık alarm. |
| P05-002 | MEDIUM | gas-performance | backend/scripts/jobs/statsSnapshot.js / computeCurrentStats | Snapshot job çok sayıda aggregate/count sorgusunu tek koşuda çalıştırıyor; yüksek hacimde ağır DB yükü oluşturabilir. | Yoğun saatlerde worker/API ile kaynak yarışına girip latency/spike yaratabilir. | Çoklu `Trade.aggregate` + `countDocuments` + `Order.countDocuments` paralel çalışıyor. | Pencereleme, incremental materialization veya off-peak scheduling/timeout budget değerlendirilmeli. |
| P05-003 | MEDIUM | state-machine | backend/scripts/services/eventListener.js / replay + checkpoint | Replay batch checkpoint ilerlemesi batch success’e bağlı; bu güvenli. Ancak kısmi batch başarısızlığında aynı aralık tekrar tarandığı için provider/query maliyeti büyür (correctness korunuyor, maliyet riski var). | Uzun süreli hata koşullarında tekrar tarama maliyeti artabilir, catch-up gecikebilir. | `batchSuccess` false olduğunda checkpoint ilerlemiyor; replay tekrar aynı aralığı işler. | Doğruluk korunarak, per-event ack persist veya adaptive batch küçültme stratejisi düşünülebilir. |
| P05-004 | LOW | testing-gap | backend/test/* (özellikle DLQ poison/retry) | DLQ’de poison/retry/idempotency metrikleri kodda mevcut; ancak bu faz listesindeki testlerde tam uçtan uca poison queue davranış kapsaması sınırlı görünüyor (uncertain). | Hata senaryolarında retry/backoff regressions geç fark edilebilir. | DLQ processor davranışına doğrudan kapsamlı integration testi bu listedeki dosyalarda belirgin değil. | **uncertain**: `dlqProcessor` için ayrı e2e benzeri test seti doğrulanmalı/eklenmeli. |

## No-Finding Notes
- `eventListener.js` içinde inline ABI + event arg map eşlemesi tanımlı ve handler binding’i tutarlı görünmektedir.
- Settlement/Revenue/Rewards event mirror akışlarında upsert/idempotent desenler genel olarak korunuyor.
- Finality depth, replay start ve checkpoint doğrulamalarında fail-closed guardlar mevcut (geçersiz checkpoint veya production start-block eksikliğinde hata).
- `expectedChain.js`, `protocolConfig.js`, `tokenEnv.js` kombinasyonu token/chain mapping için production fail-closed yaklaşım sergiliyor.
- `referenceTicker.js` açıkça informational-only olarak konumlanmış; settlement authority’ye bağlanmama prensibi test guardlarıyla da destekleniyor.
- `cleanupSensitiveData.js` terminal-state kısıtı ile PII/receipt temizliğini uyguluyor; aktif trade’e dokunmuyor.

## Cross-File Observations
- Worker doğruluk ilkesi (checkpoint’i agresif ilerletmeme) güçlü; bunun karşılığı operasyonel maliyetin (tekrar tarama) artabilmesi.
- Chain-aware güvenlik hatları çoğu service’te mevcut; decay job bu çizgiye tam entegre değil.
- Reference ticker’ın non-authoritative ayrımı hem service hem test tarafında net korunmuş.

## Follow-up Needed
- Sonraki fazda contracts/scripts ile worker ABI/event uyumu (özellikle yeni event/reason alanları) ayrıca teyit edilmeli.
- Decay job için chain guard + signer operational runbook eşlemesi yapılmalı.
- Stats snapshot için production dataset üzerinde sorgu maliyeti/profiling sonuçları toplanmalı.
