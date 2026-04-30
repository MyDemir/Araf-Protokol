# Master Audit Log

## 2026-04-30 — backend-01-root-package-deploy
- Scope: backend root/deployment/config dosyaları + ilişkili app/encryption/db/redis/test cross-check.
- Top findings:
  - HIGH: AWS KMS runtime dependency mismatch (`@aws-sdk/client-kms` package.json’da yok).
  - HIGH: `.dockerignore` `.env.*` kapsamı eksik; secret leakage riski.
  - MEDIUM: Fly health check `/health` kullanıyor, `/ready` değil (readiness drift).
  - MEDIUM: Docker non-root hardening ve deterministic install (`npm ci`) eksikleri.
- Report: `audit/backend-file-audit/backend-01-root-package-deploy.md`

## 2026-04-30 — backend-02-app-bootstrap-express
- Scope: `backend/scripts/app.js` satır bazlı inceleme + db/redis/auth/rateLimiter/errorHandler/health/eventListener ve ilgili test cross-check.
- Top findings:
  - MEDIUM: Liveness (`/health`) vs readiness (`/ready`) deploy probe drift riski.
  - MEDIUM (uncertain): CORS runtime callback doğrulaması yok; startup fail-closed mevcut olsa da config güveni yüksek.
  - LOW: Route/middleware testlerinin bir kısmı source-string düzeyinde, runtime davranış doğrulaması sınırlı.
- Report: `audit/backend-file-audit/backend-02-app-bootstrap-express.md`

## 2026-04-30 — backend-04-utils-logger-scheduler-time
- Scope: `utils/logger.js`, `utils/schedulerSuccess.js`, `utils/timeEnv.js` + ilgili testler (`scheduler.successContract`, `timeEnv.parser`, `scrubbers`).
- Top findings:
  - HIGH: logger utility ham meta stringify ettiği için merkezi secret/token/PII redaction garantisi yok.
  - HIGH: schedulerSuccess geniş success yorumu nedeniyle job failure'lar success gibi raporlanabilir.
  - MEDIUM: scheduler success contract test kapsamı ambiguity edge-case'leri için yetersiz.
- Report: `audit/backend-file-audit/backend-04-utils-logger-scheduler-time.md`

## 2026-04-30 — backend-03-config-db-redis-payment-risk
- Scope: `config/db.js`, `config/redis.js`, `config/paymentRailRiskConfig.js` + ilgili testler.
- Top findings:
  - HIGH: Redis TLS verify bypass (`REDIS_TLS_SKIP_VERIFY=true`) production guard olmadan etkinleşebiliyor.
  - MEDIUM: Redis `REDIS_URL` localhost fallback production’da fail-closed zorunlu değil.
  - MEDIUM: Payment rail config validation bucket-rail eşleşmesini zorunlu kılmıyor.
- Report: `audit/backend-file-audit/backend-03-config-db-redis-payment-risk.md`

## 2026-04-30 — backend-05-middleware-auth-ratelimit-error
- Scope: `middleware/auth.js`, `middleware/rateLimiter.js`, `middleware/errorHandler.js` + auth/siwe/redis/logger ve ilgili test cross-check.
- Top findings:
  - HIGH (uncertain): `/api/auth/refresh` route chain session-wallet guard olmadan yalnız refresh token authority'sine dayanıyor.
  - MEDIUM: rate limiter in-memory fallback çoklu pod dağıtımda global-limit bypass riski taşıyor.
  - MEDIUM: errorHandler scrub iyi olsa da logger utility seviyesinde merkezi redaction eksik.
- Report: `audit/backend-file-audit/backend-05-middleware-auth-ratelimit-error.md`

## 2026-04-30 — backend-06-auth-route-siwe-session
- Scope: `routes/auth.js`, `services/siwe.js` + middleware/redis/user/frontend ve ilgili auth test cross-check.
- Top findings:
  - MEDIUM (uncertain): refresh endpoint chain connected-wallet session guard olmadan token-authority odaklı çalışıyor.
  - MEDIUM: jti olmayan tokenlarda blacklist kontrolü atlanabiliyor (explicit jti zorunluluğu yok).
  - LOW: nonce race/expiry davranışı service-level testlerle doğrudan kapsanmıyor.
- Report: `audit/backend-file-audit/backend-06-auth-route-siwe-session.md`

## 2026-04-30 — backend-07-pii-receipts-encryption-kms
- Scope: `routes/pii.js`, `routes/receipts.js`, `services/encryption.js` + auth/model/frontend/env/dependency cross-check.
- Top findings:
  - HIGH: AWS KMS runtime dependency mismatch (`@aws-sdk/client-kms` package deps içinde yok).
  - MEDIUM: PII token issue endpointinde explicit cache-control/no-store header yok.
  - MEDIUM (uncertain): Vault fetch transport/policy ve runtime compatibility güvence katmanı sınırlı.
- Report: `audit/backend-file-audit/backend-07-pii-receipts-encryption-kms.md`

## 2026-04-30 — backend-08-identity-migration-guard
- Scope: `migrations/normalizeIdentityFields.js`, `services/identityNormalizationGuard.js` + model/route/test cross-check.
- Top findings:
  - MEDIUM: migration kapsamı numeric BSON ağırlıklı; canonical olmayan legacy string identity değerleri ayrı temizlik gerektirebilir.
  - MEDIUM (uncertain): string-format drift (örn. leading zero) için ek canonical policy denetimi önerilir.
  - INFO: production default enforce + invalid mode reject fail-safe yaklaşımı güçlü.
- Report: `audit/backend-file-audit/backend-08-identity-migration-guard.md`

## 2026-04-30 — backend-09-models-user-order-trade
- Scope: `models/User.js`, `models/Order.js`, `models/Trade.js` + worker/routes/contract/frontend/test cross-check.
- Top findings:
  - MEDIUM: `*_num` Number cache alanlarının yanlışlıkla enforcement logicte kullanılması precision/authority drift riski taşır.
  - MEDIUM (uncertain): `Trade.onchain_escrow_id` sparse unique nedeniyle kimliksiz trade birikimi operasyonel kalite riski doğurabilir.
  - INFO: enum/state ve big-id sort/lookup semantiği genel olarak kontrat ve route katmanlarıyla uyumlu.
- Report: `audit/backend-file-audit/backend-09-models-user-order-trade.md`

## 2026-04-30 — backend-10-models-reward-revenue-stats-feedback
- Scope: reward/revenue/stats/feedback model dosyaları + rewards/stats route, worker, snapshot job, rewards contracts ve dashboard çapraz kontrolü.
- Top findings:
  - MEDIUM: reward/revenue mirror modellerinde chain context (`chain_id`/`contract`) olmadan unique key kullanımı multi-chain veya misconfigured RPC senaryolarında veri karışması riski taşır.
  - MEDIUM: `RewardEpochAllocationEvent` modelinde `block_number` eksikliği replay/reorg forensics ve operasyonel triage kalitesini düşürür.
  - INFO: authority boundary korunuyor; backend/frontend ekonomik hüküm üretmiyor, kontrat authoritative kalıyor.
- Report: `audit/backend-file-audit/backend-10-models-reward-revenue-stats-feedback.md`

## 2026-04-30 — backend-11-routes-orders-listings-reference
- Scope: `routes/orders.js`, `routes/listings.js`, `routes/referenceRates.js` + model/service/frontend/contract/test cross-check.
- Top findings:
  - MEDIUM: public order feed’de `refs.order_ref` alanı correlation/linkability yüzeyini gereksiz artırabilir.
  - MEDIUM (uncertain): protocol config cache tazeliği için güçlü freshness attestation yok; stale parametre gösterim riski mevcut.
  - INFO: big-id pagination/sort semantiği ve reference-rates non-authoritative sınırı genel olarak doğru korunuyor.
- Report: `audit/backend-file-audit/backend-11-routes-orders-listings-reference.md`

## 2026-04-30 — backend-12-routes-trades-deep
- Scope: `routes/trades.js` satır bazlı derin inceleme + model/auth/pii/worker/contract/frontend/test çapraz kontrolü.
- Top findings:
  - MEDIUM: trade projection katmanında canonical `disputed_resolved_count` ile legacy `disputed_but_resolved_count` naming drift riski var.
  - MEDIUM (uncertain): cancel state precheck DB mirror gecikmelerinde kullanıcıya stale state algısı üretebilir (authority kontratta kalmaya devam eder).
  - INFO: cancel EIP-712 domain+nonce doğrulaması ve settlement preview non-authoritative sınırı genel olarak güçlü.
- Report: `audit/backend-file-audit/backend-12-routes-trades-deep.md`

## 2026-04-30 — backend-13-routes-rewards-traderisk-stats
- Scope: `routes/rewards.js`, `routes/tradeRisk.js`, `routes/stats.js` + reward models/worker/contracts/frontend/test cross-check.
- Top findings:
  - MEDIUM: rewards route katmanında auth/rate-limit boşluğu nedeniyle public scraping/operational load yüzeyi geniş olabilir.
  - MEDIUM (uncertain): mirror freshness gecikmelerinde frontend claimable/epoch algısı stale kalabilir (authority yine on-chain'de).
  - INFO: tradeRisk read-only/non-blocking contractı ve stats route cache+rate-limit yapısı genel olarak güvenli sınırda.
- Report: `audit/backend-file-audit/backend-13-routes-rewards-traderisk-stats.md`

## 2026-04-30 — backend-14-routes-admin-logs-feedback
- Scope: `routes/admin.js`, `routes/logs.js`, `routes/feedback.js` + auth/rateLimiter/logger/model/frontend/test cross-check.
- Top findings:
  - MEDIUM: admin erişimi tek faktörlü wallet allowlist modeline bağlı; operasyonel rol/rotasyon disiplini kritik.
  - MEDIUM (uncertain): feedback log satırında tam wallet yazımı log-retention tarafında gereksiz identifiability/correlation riski yaratabilir.
  - INFO: admin backend auth chain ve logs limiter+scrub yaklaşımı genel olarak doğru güvenlik sınırında.
- Report: `audit/backend-file-audit/backend-14-routes-admin-logs-feedback.md`

## 2026-04-30 — backend-15-worker-eventlistener-abi-events
- Scope: `services/eventListener.js` (imports/constants/inline ABI/event signatures/getter tuples/decode/provider/token-refresh/order+settlement+revenue+rewards handlers) + contract/frontend/model/test cross-check.
- Top findings:
  - MEDIUM: worker inline ABI tanımları manuel bakım gerektiriyor; contract signature değişimlerinde ABI drift riski yapısal olarak sürüyor.
  - MEDIUM: `EpochRewardAllocated` mirror path’inde block-level metadata (`block_number`) eksikliği forensics/triage kalitesini düşürebilir.
  - INFO: OrderFilled child trade decode, settlement mirror idempotency ve token config refresh-first yaklaşımı genel olarak doğru.
- Report: `audit/backend-file-audit/backend-15-worker-eventlistener-abi-events.md`

## 2026-04-30 — backend-17-services-worker-support
- Scope: `services/dlqProcessor`, `services/expectedChain`, `services/health`, `services/protocolConfig`, `services/referenceTicker`, `services/tokenEnv` + worker/routes/frontend/contract/tests cross-check.
- Top findings:
  - MEDIUM: protocol config için hard staleness/freshness fail policy eksik (operational drift riski).
  - MEDIUM: readiness tarafında Redis degrade/timeout teşhisi granular değil (observability gap).
  - INFO: wrong-chain guard, chain-aware token mapping, reference ticker non-authority boundary ve DLQ retry/idempotency yaklaşımı genel olarak güçlü.
- Report: `audit/backend-file-audit/backend-17-services-worker-support.md`

## 2026-04-30 — backend-16-worker-eventlistener-projection-replay-dlq
- Scope: `services/eventListener.js` (projection handlers, Mongo mirror updates, checkpoint/finality/replay/idempotency/DLQ/lifecycle) + related service/model/contract/test cross-check.
- Top findings:
  - MEDIUM: replay batch’te tek event failure checkpoint ilerlemesini durduruyor (güvenli ama backlog riski).
  - MEDIUM: bazı ara-state handler’larda no-op filter yaklaşımı drift’i sessiz bırakabilir; explicit reconciliation sınırlı.
  - INFO: finality-depth + safe checkpoint + per-block ack/unsafe yaklaşımı, duplicate/idempotency ve DLQ retry zinciri genel olarak sağlam.
- Report: `audit/backend-file-audit/backend-16-worker-eventlistener-projection-replay-dlq.md`

## 2026-04-30 — backend-18-jobs-cleanup-reputation-stats
- Scope: cleanup/reputation/stats job dosyaları + related model/service/worker/contract/test cross-check.
- Top findings:
  - MEDIUM: scheduler success kontratında `undefined => success` semantiği job return-hatasını maskeyebilir.
  - MEDIUM: `statsSnapshot` çoklu aggregate + full-read deseni büyük veri setinde performans riski taşıyabilir.
  - INFO: cleanup terminal-state guard’ları ve reputation decay’nin on-chain eligibility doğrulaması authority boundary ile uyumlu.
- Report: `audit/backend-file-audit/backend-18-jobs-cleanup-reputation-stats.md`

## 2026-04-30 — backend-19-test-coverage-risk-audit
- Scope: `backend/test/` risk-bazlı kapsam incelemesi + app/middleware/routes/services/jobs/models cross-check.
- Top findings:
  - HIGH: mainnet-critical path’lerde auth rotation race/reuse, worker replay+DLQ poison ve full authorization matrix test boşlukları sürüyor.
  - MEDIUM: KMS production boot matrix ve Mongo/Redis/RPC birleşik chaos senaryoları yetersiz.
  - INFO: mevcut test seti chain guard, finality, CORS fail-closed, terminal cleanup ve non-authority sınırında güçlü temel guardrail sağlıyor.
- Report: `audit/backend-file-audit/backend-19-test-coverage-risk-audit.md`
