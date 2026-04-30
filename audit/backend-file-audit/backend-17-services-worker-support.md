# Backend Audit 17 — Services / Worker Support (expectedChain, health, protocolConfig, tokenEnv, referenceTicker, dlqProcessor)

Date: 2026-04-30  
Auditor: Codex (GPT-5.3-Codex)

## Scope
Primary files:
- `backend/scripts/services/dlqProcessor.js`
- `backend/scripts/services/expectedChain.js`
- `backend/scripts/services/health.js`
- `backend/scripts/services/protocolConfig.js`
- `backend/scripts/services/referenceTicker.js`
- `backend/scripts/services/tokenEnv.js`

Related files checked:
- `backend/scripts/services/eventListener.js`
- `backend/scripts/config/redis.js`
- `backend/scripts/routes/referenceRates.js`
- `backend/scripts/routes/orders.js`
- `backend/scripts/routes/trades.js`
- `contracts/src/ArafEscrow.sol`
- `frontend/src/components/ReferenceRateTicker.jsx`

Related tests checked:
- `backend/test/expectedChain.guard.test.js`
- `backend/test/protocolConfig.failclosed.test.js`
- `backend/test/protocolConfig.tokenConfig.test.js`
- `backend/test/referenceTicker.service.test.js`
- `backend/test/referenceTicker.nonAuthorityCoupling.test.js`
- `backend/test/tokenEnv.chainAware.test.js`
- `backend/test/health.readinessCorsConfig.test.js`

## Executive summary
Bu kapsamda temel güvenlik yaklaşımı büyük ölçüde fail-closed ve authority-boundary uyumlu:
- `expectedChain` ve `protocolConfig` tarafında yanlış chain / eksik chain config için fail-closed davranış güçlü.
- `tokenEnv` chain-aware mapping production’da yanlış alias kullanımını (özellikle Base Sepolia + MAINNET_* alias) blokluyor.
- `referenceTicker` non-authoritative sınırı hem payload sözleşmesiyle hem de coupling guard testiyle korunuyor.
- `dlqProcessor` idempotency/retry/backoff tarafında güvenli ve deterministik replay-key yaklaşımı kullanıyor.

Ana kalan riskler daha çok operasyonel görünürlük ve stale davranış semantiği düzeyinde:
1. `health` readiness, Redis/Mongo/provider/worker durumunu anlamlı raporlasa da Redis “ready ama komut başarısız” gibi degrade durumları yalnızca dolaylı sinyallerle görüyor (kısmi observability gap).
2. `protocolConfig` cache freshness için hard staleness eşiği yok; config var ise route’lar çalışıyor (fail-closed yok, fail-open değil ama stale-risk mevcut).
3. `referenceTicker` unavailable durumunda stale last-good fallback doğru, fakat frontend katmanında kullanıcıya “informational / non-authoritative / stale” sinyali UX açısından daha görünürleştirilebilir.

## Detailed findings

### 1) expectedChain production fail-closed durumu — PASS
- `EXPECTED_CHAIN_ID` yoksa production’da doğrudan exception atılıyor.
- `BASE_RPC_URL` tanımlıyken non-prod’da da `EXPECTED_CHAIN_ID` zorunlu (yalnızca explicit bypass env ile gevşetilebiliyor).
- Provider chain ile expected chain uyuşmazlığında sert hata veriliyor.

Değerlendirme: wrong-chain RPC kullanımını engelleme hedefi servis seviyesinde doğru uygulanmış.

### 2) Wrong chain RPC engellemesi — PASS (service surface)
- `protocolConfig` yüklemesi öncesi provider üzerinde chain assertion çağrılıyor.
- `eventListener` ile birlikte kullanıldığında worker tarafı da same-surface guard modeline dayanıyor.

Not: Bu kontrolün tamamlayıcısı runtime env hijyenidir (`EXPECTED_CHAIN_ID` tutarlılığı). Testler chain mismatch’i kapsıyor.

### 3) health endpoint gerçek durum yansıtma — PARTIAL PASS
- Artılar:
  - Mongo/Redis/provider/config/chainId/worker state+lag/replay bootstrap birlikte değerlendiriliyor.
  - Production için CORS/SIWE/config drift teşhisi ayrıntılı.
- Sınırlamalar:
  - Redis readiness `isReady()` + belirli checkpoint read denemeleriyle ölçülüyor; degrade gecikme/timeout durumlarına granular teşhis sınırlı.
  - Liveness endpoint tasarım gereği minimal (`status=ok`) ve dependency health yansıtmaz (beklenen tasarım olsa da ops ekiplerin bunu doğru yorumlaması gerekir).

### 4) protocolConfig stale/eksik durumda route güvenliği — PASS with stale caveat
- Eksik config için `getConfig()` `CONFIG_UNAVAILABLE` atıyor; fallback ekonomi üretilmiyor (doğru).
- Partial cache mutation, full load öncesi reddediliyor (fail-closed).
- Token config load failure durumunda varsayılan olarak `supported=false` ve `decimals=null` (unsafe precision fallback yok).
- Caveat: loaded cache için yaş/TTL-temelli “stale hard fail” katmanı yok; bu bir güvenlikten çok operasyonel doğruluk riski.

### 5) tokenEnv chain-aware mapping ve token/decimals riski — PASS
- 8453/84532 ayrımı production’da sıkı uygulanıyor.
- Base Sepolia’da MAINNET alias kullanımına fail-fast var.
- zero address reddediliyor.
- Tracked token seti boş olamaz (production).

Değerlendirme: yanlış token address mapping riski önemli ölçüde azaltılmış. Decimals doğruluğu `protocolConfig.getTokenConfig` mirror’ına bağlı; başarısızlıkta fail-closed benzeri davranış (null + unsupported) mevcut.

### 6) referenceTicker settlement authority’ye karışıyor mu? — PASS
- Service payload açıkça informational/non-authoritative semantics taşıyor.
- `referenceTicker.nonAuthorityCoupling` testi enforcement/risk/reputation yüzeylerine coupling’i engelliyor.
- İncelenen route/worker yüzeylerinde settlement authority kontratta kalıyor.

### 7) Reference unavailable olduğunda davranış — PASS (backend), PARTIAL (UX visibility)
- Backend, provider arızasında last-good stale payload döndürüyor; hard failure yerine kontrollü degraded mode var.
- Frontend ticker gösterimi mevcut; stale/non-authoritative ibaresinin kullanıcı farkındalığı açısından daha güçlü işaretlenmesi önerilir.

### 8) dlqProcessor idempotent + güvenli retry — PASS with bounded caveat
- Deterministic synthetic replay logIndex ile fallback key collision riski azaltılmış.
- Exponential backoff, max attempt, poison event logging mevcut.
- Entry bazlı remove+requeue modeli idempotency açısından makul.
- Caveat: Çok yüksek concurrency veya dışsal replay yarışlarında Redis list semantiği nedeniyle “exactly-once” garantisi yok; ancak mevcut mimari için en azından at-least-once + idempotency-key stratejisi korunuyor.

### 9) Test kapsamı (wrong-chain / stale-config / Redis-down) — PARTIAL PASS
- Wrong-chain: güçlü kapsama var (`expectedChain`, `protocolConfig`).
- Stale-config: `CONFIG_UNAVAILABLE` ve partial mutation guard kapsanıyor, ancak “loaded but stale age” senaryosu için test yok.
- Redis-down: reference ticker fallback ve bazı readiness yolları dolaylı kapsanıyor; Redis partial-degrade/timeout davranışları için daha hedefli test eklenebilir.

## Risk matrix (this scope)
- MEDIUM: protocol config için hard staleness policy eksikliği (operational correctness drift).
- MEDIUM: readiness Redis degrade teşhisinin sınırlı granularity’si.
- LOW: reference-rate stale/non-authoritative sinyalinin frontend görünürlüğü yeterince güçlü olmayabilir.

## Recommendations
1. `health` için Redis ping/latency/timeouts bazlı ek diagnostik alanlar ekleyin (readiness payload’ında ayrı sinyal).
2. `protocolConfig.loaded_at` için opsiyonel max-age guard ekleyin (örn. production’da `CONFIG_MAX_AGE_SECONDS` aşılırsa `config=false`).
3. `referenceRates`/frontend ticker tarafında stale badge + “cannot affect settlement” açıklamasını daha belirgin yapın.
4. DLQ için operasyonel metriği genişletin: poison backlog trend, oldest entry age, per-event failure histogram.
5. Test paketine şu senaryoları ekleyin:
   - Redis ready=true ama get timeout/throw -> readiness davranışı.
   - Config loaded fakat yaş sınırı aşılmış -> route/readiness fail davranışı (eğer policy eklenirse).
   - DLQ aynı txHash + farklı eventName sentetik key ayrışması.

## Authority boundary check (explicit)
- Oracle-free dispute modeli korunuyor.
- Release/cancel/burn/payout/settlement authority kontratta kalıyor.
- Backend/frontend ekonomik hüküm üretmiyor; reference rates informational.
- Risk skoru veya backend verisi on-chain sonucu belirlemiyor.

