# Backend Audit 19 — Test Coverage Risk Audit (Risk-based, not % coverage)

Date: 2026-04-30  
Auditor: Codex (GPT-5.3-Codex)

## Scope
Reviewed test tree: `backend/test/` (all listed files).  
Cross-check surfaces: `backend/scripts/app.js`, `backend/scripts/middleware/*`, `backend/scripts/routes/*`, `backend/scripts/services/*`, `backend/scripts/jobs/*`, `backend/scripts/models/*`.

## Method
- Test dosyaları grup bazında incelendi (auth/session, PII/encryption, routes, worker, config guards, model/identity, jobs, rate limiter, health/bootstrap).
- Risk bazlı boşluklar çıkarıldı; salt satır/branch coverage ölçümü yapılmadı.
- Mainnet-critical path önceliklendirildi: auth authority, worker replay/finality, config fail-closed, destructive cleanup, chain guard, operational chaos.

## High-level assessment
Mevcut test seti önemli guardrail’leri kapsıyor: wallet mismatch, refresh hardening, chain-aware env guard, worker finality, terminal-state cleanup, CORS fail-closed, ve non-authoritative reference coupling.  
Ancak mainnet-critical seviyede hâlâ anlamlı boşluklar var:
1. **Chaos/partial failure entegrasyonları sınırlı** (Redis down, Mongo down, RPC degraded/wrong-chain sırasında app+worker birlikte davranışı).
2. **Authorization matrix tam değil** (route-method-wallet role kombinasyonları eksik; bazı testler source-string assertion ağırlıklı).
3. **Worker replay/DLQ derinliği kısmi** (gap recovery, poison isolation, mixed success batch progression testleri artırılmalı).
4. **PII policy edge-case’leri sınırlı** (current profile fallback/snapshot-only davranışının negatif senaryoları eksik).

---

## Group-by-group findings

### 1) Auth / session tests
**Mevcut güçlü alanlar**
- Session wallet mismatch revoke/blacklist akışı testlenmiş.
- Refresh endpointte forged JWT cookie’den wallet authority türetmeme testlenmiş.
- Nonce limiter zinciri ve cookie policy matrix testleri mevcut.

**Risk boşlukları (mainnet-critical)**
- Refresh token **rotation family reuse attack** (eski refresh tekrar kullanımı) için end-to-end route testi görünmüyor.
- Paralel refresh yarışında (same token, concurrent requests) tek seferlik rotasyon garantisi net testlenmemiş.
- Logout + blacklist propagation (çoklu instance/Redis delay) kaos testi yok.

### 2) PII / encryption tests
**Mevcut güçlü alanlar**
- Taker-name route’ta identity guard ve büyük ID string semantiği testlenmiş.
- Guard transient failure sonrası sticky-cache olmaması doğrulanmış.

**Risk boşlukları**
- “Current profile fallback yasak / snapshot-only policy” negatif testleri sınırlı (özellikle snapshot eksik + current profile mevcutken explicit deny).
- KMS provider production boot path (aws/vault/local matrix) için fail-closed entegrasyon testleri görünmüyor.
- Decrypt failure sınıfları (corrupt payload, wrong key, timeout) için route-level redaction + error contract testleri eksik.

### 3) Route tests (authorization matrix)
**Mevcut güçlü alanlar**
- Bazı kritik route’larda wallet mismatch 409 guard var.
- Orders config/reference/rewards/read-only semantics için çeşitli regression testleri mevcut.

**Risk boşlukları**
- Tüm route/method kombinasyonları için **tam authorization matrix** yok (auth required, session-wallet required, admin required, pii-token required).
- Bazı testler source-string mount/chain assertion düzeyinde; runtime behavior + middleware order doğrulaması sınırlı.
- Abuse-case testleri (malformed params, oversized payload, mixed-type IDs) route setinin tamamında homojen değil.

### 4) eventListener / worker tests
**Mevcut güçlü alanlar**
- Finality depth, orderFilled mirror, escrowReleased order stats, reputation mirror, RPC env required testleri mevcut.
- Token config refresh ve settlement proposal mirror regression testleri var.

**Risk boşlukları**
- Replay sırasında **partial batch failure sonrası checkpoint progression** ayrıntılı senaryolarla tam doğrulanmış görünmüyor.
- DLQ poison event izolasyonu + sürekli poison altında worker liveness/readiness etkisi için hedefli test eksik.
- Reorg benzeri out-of-order event sequence (LOCKED→PAID→LOCKED replay gibi) state monotonicity matrix genişletilebilir.

### 5) protocolConfig / tokenEnv / expectedChain tests
**Mevcut güçlü alanlar**
- expected chain fail-closed ve mismatch guard testli.
- protocolConfig unavailable/partial mutation fail-closed ve token config compatibility testli.
- tokenEnv chain-aware mapping (8453/84532, zero address, alias rejection) iyi kapsanmış.

**Risk boşlukları**
- Protocol config **stale-age** policy testi yok (loaded-but-stale durumunda davranış).
- Multi-RPC drift (provider alive ama wrong backend env matrix) entegrasyon testi sınırlı.
- App bootstrap seviyesinde KMS provider + protocolConfig + worker birlikte production fail-fast matrix eksik.

### 6) Model / identity tests
**Mevcut güçlü alanlar**
- identity guard mode/default ve migration/lookup semantiği için testler mevcut.
- Big ID pagination/sort semantiği route düzeyinde ele alınmış.

**Risk boşlukları**
- Çok büyük BigInt değerlerin model pipeline’ında Number cache alanlarına düşüşü sonrası null/precision davranışı için daha fazla edge test gerekli.
- Cross-model referential consistency (Order/Trade mirror counters) için failure-in-transaction senaryoları az.

### 7) Cleanup / job tests
**Mevcut güçlü alanlar**
- Sensitive cleanup terminal-state guard testli.
- Reputation decay 90-gün sınırı ve tx wait davranışı testli.
- Scheduler success helper kontratı testli.

**Risk boşlukları**
- Cleanup future retention date no-op ve non-terminal hard-guard senaryoları genişletilmeli.
- User bank risk cleanup için per-user exception continuation testi yok.
- Job overlap/distributed lock yokluğunda duplicate çalışma etkisini ölçen testler yok.
- Scheduler helper’da `undefined => success` semantiğinin operasyonel etkisine dair negatif test/review eksik.

### 8) Rate limiter tests
**Mevcut güçlü alanlar**
- Alias cleanup, tier overlay, write fallback testleri mevcut.

**Risk boşlukları**
- Redis unavailable + high concurrency altında limiter degrade davranışı için integration/chaos testleri eksik.
- Endpoint bazlı limiter chain order doğrulaması (özellikle auth/nonce/PII) daha geniş olabilir.

### 9) Health / app / bootstrap tests
**Mevcut güçlü alanlar**
- CORS production fail-closed testlenmiş.
- readiness CORS diagnostics testleri mevcut.
- DB disconnect/redis readiness gibi bazı operasyonel testler var.

**Risk boşlukları**
- Mongo down + Redis down + RPC wrong-chain kombinasyonlarını aynı anda içeren boot/readiness chaos senaryoları eksik.
- Worker lag yükselmesi + replay-in-progress durumunda `/ready` davranışının süreklilik testleri artırılmalı.
- Liveness/readiness probe drift’i deployment manifestleriyle birlikte contract-test olarak bağlanmamış.

---

## Mainnet-critical paths that remain under-tested
1. Refresh-token family race/reuse invalidation (auth authority boundary).  
2. Worker replay partial failure + DLQ poison under sustained load (state mirror durability).  
3. Full authorization matrix across routes (wallet/session/admin/pii-token permutations).  
4. KMS provider production boot fail-closed matrix (aws/vault/local/env mismatch).  
5. Multi-dependency chaos at startup/readiness (Mongo+Redis+RPC combined faults).  
6. Destructive cleanup edge policies (future retention, non-terminal safeguards, replayed cleanup idempotency).

## Recommended next test additions (risk-priority)
- **P0**: Refresh rotation replay/race tests + revoked family propagation test.
- **P0**: Worker checkpoint/DLQ poison progression tests (mixed batch success/fail).
- **P0**: Route authorization matrix table-driven tests.
- **P1**: KMS production boot/provider mismatch tests.
- **P1**: Chaos readiness suite (Mongo/Redis/RPC combined failure modes).
- **P1**: Cleanup destructive edge-case tests (future retention + non-terminal invariants).
- **P2**: BigInt/Number boundary regression tests across stats/model caches.

## Authority boundary verification
- Oracle-free dispute modeli mevcut testlerde genel olarak korunuyor.
- Settlement/release/cancel/burn/payout authority’nin kontratta kalması prensibi test setinde destekleniyor.
- Backend risk/read-model verisiyle on-chain outcome belirleme yönünde bir test ihlali gözlenmedi.
