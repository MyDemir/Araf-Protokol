# Phase 01 — Backend Bootstrap / Config / Utility Surface

## Scope
- backend/scripts/config/db.js
- backend/scripts/config/paymentRailRiskConfig.js
- backend/scripts/config/redis.js
- backend/scripts/utils/logger.js
- backend/scripts/utils/schedulerSuccess.js
- backend/scripts/utils/timeEnv.js
- backend/scripts/app.js
- backend/package.json
- backend/.env.example
- backend/Dockerfile
- backend/fly.toml
- backend/.dockerignore

İlişkili testler:
- backend/test/app.corsFailClosed.test.js
- backend/test/db.disconnectPolicy.test.js
- backend/test/redis.connectReadiness.test.js
- backend/test/health.readinessCorsConfig.test.js
- backend/test/timeEnv.parser.test.js
- backend/test/scheduler.successContract.test.js
- backend/test/paymentRailRiskConfig.validation.test.js
- backend/test/route.mounts.test.js

## Method
- `docs/TR/ux.md` canonical sıra referansı doğrulandı.
- Her dosya `nl -ba` ile açılıp satır bazlı okundu.
- Büyük dosya (`app.js`) iki parçada satır/fonksiyon akışıyla incelendi.
- Config, bootstrap ve testler arasında cross-reference yapıldı.
- Sadece grep/search sonucu ile değerlendirme yapılmadı.

## File-by-File Notes
| Dosya | Durum | İnceleme derinliği | Not |
|---|---|---|---|
| backend/scripts/config/db.js | İncelendi | Satır + event handler | Disconnect fail-fast, graceful shutdown suppression mevcut. |
| backend/scripts/config/paymentRailRiskConfig.js | İncelendi | Fonksiyon bazlı | Validation fail-closed ve SEPA fallback kontrol edildi. |
| backend/scripts/config/redis.js | İncelendi | Fonksiyon bazlı | ready/open ayrımı var, TLS opsiyonu var. |
| backend/scripts/utils/logger.js | İncelendi | Satır bazlı | Dosya loglaması + meta serialize davranışı kontrol edildi. |
| backend/scripts/utils/schedulerSuccess.js | İncelendi | Fonksiyon bazlı | success contract gevşek ama bilinçli tanımlı. |
| backend/scripts/utils/timeEnv.js | İncelendi | Fonksiyon bazlı | Timer sınırı güvenli parse ile korunuyor. |
| backend/scripts/app.js | İncelendi | Fonksiyon + startup/shutdown akışı | CORS fail-closed, shutdown, scheduler lock, route mount sırası incelendi. |
| backend/package.json | İncelendi | Dependency/scrips | Runtime deps var, lockfile görünümü bu faz scope dışında. |
| backend/.env.example | İncelendi | Satır bazlı | Production guard notları mevcut, ama bazı env’ler uygulama tarafından strict parse edilmiyor. |
| backend/Dockerfile | İncelendi | Satır bazlı | node:18-alpine + npm install --production. |
| backend/fly.toml | İncelendi | Satır bazlı | single-machine always-on varsayımı var. |
| backend/.dockerignore | İncelendi | Satır bazlı | logs/, env ve node_modules hariç tutulmuş. |
| backend/test/* (listed) | İncelendi | Test-by-test | Bazı kritik riskler yalnız source-string testiyle kapatılmış. |

## Findings
| ID | Severity | Category | File / Function | Finding | Risk | Evidence | Suggested Action |
|---|---|---|---|---|---|---|---|
| P01-001 | HIGH | deployment-env | backend/Dockerfile | Runtime image `node:18-alpine` üzerinde sabitlenmiş. Node 18 LTS bakım sonu (EOL) nedeniyle güvenlik güncelleme penceresi riski oluşur. | Mainnet prod yüzeyinde CVE yamalarının gecikmesi/olmaması ve compliance riski. | Dockerfile satır 2 doğrudan `FROM node:18-alpine`. | Desteklenen aktif LTS major’a (örn. Node 20/22) planlı geçiş ve smoke test matrix’i. |
| P01-002 | MEDIUM | env-validation | backend/scripts/config/redis.js / waitForReady | `REDIS_READY_WAIT_MS` doğrudan `Number(...)` ile parse ediliyor; NaN/0/negatif değerler için güvenli fallback yok. | Hatalı env ile ready bekleme fiilen 0ms olup startup’ta yanlış-negatif readiness/boot failure üretebilir. | Satır 10’da parse, satır 24-27’de timeout doğrudan kullanımı. | `parsePositiveTimerMs` benzeri guard ile pozitif integer + upper bound doğrulaması eklenmeli. |
| P01-003 | MEDIUM | testing-gap | backend/test/db.disconnectPolicy.test.js | Mongo disconnect fail-fast davranışı yalnız export var/yok seviyesinde testlenmiş; `disconnected` eventinde `process.exit(1)` ve graceful suppression yolu davranışsal testlenmiyor. | Regressions (fail-fast kaldırılması veya tersine graceful path bozulması) testten kaçabilir. | Test dosyası tek assertion içeriyor; config/db.js’de kompleks event policy var. | Unit testlerde mocked mongoose connection ile disconnected event, toggle true/false ve exit call davranışı doğrulanmalı. |
| P01-004 | LOW | testing-gap | backend/test/route.mounts.test.js, backend/test/app.corsFailClosed.test.js | Kritik güvenlik alanları source-string içerik kontrolüyle testlenmiş (davranış yerine metin eşleşmesi). | Refactor/format değişiminde false positive/negative; gerçek runtime güvence zayıf. | `toContain("app.use(...)")` ve `toContain("if (worker.isRunning)")` desenleri. | Supertest + isolated module ile davranış odaklı mount/CORS/boot testleri artırılmalı. |
| P01-005 | LOW | PII-data-protection | backend/scripts/utils/logger.js | Logger meta alanlarını filtrelemeden `JSON.stringify(meta)` ile yazıyor; çağıran katman secret/PII geçirirse sızıntı mümkün. | Uygulama genelinde yanlış logger kullanımıyla token/secret/PII log’a düşebilir. | Satır 51-54 meta serialize; redaction listesi yok. | Merkezi redaction (örn. secret/token/key/cookie alan maskesi) eklenmesi değerlendirilmeli. |

## No-Finding Notes
- `app.js` içinde production CORS fail-closed kontrolleri (missing, wildcard, invalid origin/path/query/hash) mevcut ve boot sırasında zorlanıyor.
- `app.js` trust proxy açık, helmet aktif, JSON body limiti (`50kb`) belirli, mongo sanitize aktif.
- `db.js` disconnect politikası fail-fast + shutdown sürecinde suppress yolu içeriyor; operasyonel olarak tutarlı.
- `redis.js` için open vs ready ayrımı uygulanmış; readiness semantiği açısından doğru yönde.
- `schedulerSuccess.js` davranışı dokümante edilen sözleşme ile uyumlu.
- `timeEnv.js` setTimeout overflow sınırına karşı güvenli parse yapıyor.
- `paymentRailRiskConfig.js` fail-closed validation davranışı güçlü.

## Cross-File Observations
- `timeEnv.js` güvenli parser yaklaşımı scheduler env’lerinde kullanılırken, Redis ready timeout env’inde aynı disiplin yok (konfigürasyon katmanları arasında validation drift).
- Bootstrap güvenlik kontrolleri (`app.js`) güçlü; fakat ilgili testlerin bir bölümü string-match tabanlı olduğundan güvence seviyesi kod karmaşıklığına göre düşük kalıyor.
- Deployment katmanında (Dockerfile/Fly) “always-on worker” varsayımı net; fakat runtime base image lifecycle takibi operasyonel olarak kritik bağımlılık.

## Follow-up Needed
- Phase 02’de `services/health`, `middleware/rateLimiter`, `services/expectedChain`, `services/protocolConfig` dosyalarıyla bu faz bulgularının etkisi çapraz doğrulanmalı.
- Redis ve Mongo için managed service TLS/CA varyantları (özellikle production cert chain) test/ops dokümanlarıyla birlikte gözden geçirilmeli.
