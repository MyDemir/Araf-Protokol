# Backend Mainnet Readiness Audit — Araf-Protokol

## 1. Executive Verdict
**READY AFTER FIXES**

Sistem mimarisi (oracle-free dispute, on-chain settlement authority, backend mirror/read-model sınırı) doğru yönde. Ancak mainnet için bazı **blocker** ve yüksek riskli operasyonel boşluklar kapatılmadan “tam ready” denemez.

## 2. Mainnet Blockers
| ID | Severity | Area | Files | Finding | Required Fix |
|---|---|---|---|---|---|
| B-01 | HIGH | PII/KMS Boot | `backend/package.json`, `backend/scripts/services/encryption.js`, deploy env | AWS KMS runtime dependency uyumsuzluğu (KMS provider seçiliyken runtime kırılma riski). | `@aws-sdk/client-kms` runtime dependency olarak eklenmeli; production boot testleriyle doğrulanmalı. |
| B-02 | HIGH | Secret Hygiene | `.dockerignore`, deployment artifacts | `.env.*` pattern kapsaması eksik; container context secret sızıntısı riski. | `.dockerignore` ve build context politikası sıkılaştırılmalı; CI’de secret-leak lint eklenmeli. |
| B-03 | HIGH | Logging/PII | `backend/scripts/utils/logger.js`, hata log path’leri | Merkezi redaction garantisi zayıf; ham meta stringify ile token/PII sızıntı olasılığı. | Logger seviyesinde allowlist/redaction pipeline zorunlu hale getirilmeli; güvenlik testleri eklenmeli. |
| B-04 | HIGH | Scheduler Integrity | `backend/scripts/utils/schedulerSuccess.js`, job chain | `undefined => success` kontratı failure’ı success gibi raporlayabilir. | Scheduler success kontratı fail-closed yapılmalı; job return contract testleri genişletilmeli. |

## 3. High Risk Findings
| ID | Severity | Area | Files | Finding | Risk | Suggested Fix |
|---|---|---|---|---|---|---|
| H-01 | HIGH | Auth Refresh | `routes/auth.js`, `services/siwe.js`, auth tests | Refresh akışı session-wallet guard’dan çok token authority’ye dayanıyor; race/reuse test boşluğu var. | Token theft/reuse ve aile-rotasyon zafiyeti. | Refresh family rotation + replay/race deny testleri ve stricter reuse invalidation. |
| H-02 | HIGH | Redis TLS Policy | `config/redis.js` | `REDIS_TLS_SKIP_VERIFY=true` production guard olmadan etkinleşebiliyor. | MITM/transport integrity riski. | Production’da skip-verify yasak/fail-closed + policy testleri. |
| H-03 | HIGH | Deployment Readiness | `fly.toml` / probe wiring, `app.js`, `health.js` | Liveness/readiness drift (`/health` vs `/ready`) operasyonel yanıltma üretebilir. | Bozuk instance’ların healthy görünmesi. | Readiness probe standardizasyonu ve deploy contract-test. |
| H-04 | MEDIUM-HIGH | Worker ABI Drift | `services/eventListener.js` inline ABI | Kontrat-event imzası değişimlerinde worker decode drift riski yapısal. | Mirror sapması, event kaybı. | ABI source-of-truth otomasyonu + ABI drift CI testi. |
| H-05 | MEDIUM-HIGH | Worker Drift/Reconciliation | `eventListener.js`, reward/revenue models | Replay güçlü ama explicit reconciliation job sınırlı; bazı no-op path’ler drift’i sessiz bırakabilir. | Uzun vadeli read-model sapması. | Per-record reconciliation/audit job + drift alarm metriği. |
| H-06 | MEDIUM-HIGH | Data/Index Context | reward/revenue allocation models | Chain context eksik unique stratejiler multi-chain/misconfig durumda karışma riski. | Veri bütünlüğü ve forensics zayıflaması. | `chain_id`/`contract` context index politikası ve migration planı. |

## 4. Auth / Session / Wallet Binding
- Güçlü yönler:
  - Wallet mismatch revoke/blacklist guard çizgisi var.
  - Refresh’te forged JWT-cookie fallback’i engelleyen test mevcut.
- Riskler:
  - Refresh rotation reuse/race ve multi-request concurrency senaryoları mainnet-kritik düzeyde yetersiz testli.
  - jti zorunluluk/blacklist semantiği her akışta katı değil.
- Değerlendirme:
  - **Authority boundary korunuyor**, fakat refresh güvenliği “hardening tamamlandı” seviyesinde değil.

## 5. PII / Encryption / KMS
- Güçlü yönler:
  - Snapshot-only yaklaşımı ve terminal cleanup akışları mevcut.
- Riskler:
  - KMS provider boot/readiness matrix eksik.
  - Cache-control/no-store ve decrypt failure redaction kontratları daha katı testlenmeli.
- Değerlendirme:
  - PII modeli doğru yönde, fakat production KMS operabilitesi blocker sınıfında.

## 6. Routes / Authorization / Authority Boundaries
- Güçlü yönler:
  - Kritik route’larda wallet mismatch guard var.
  - Reference rates/read models non-authoritative sınırı korunuyor.
- Riskler:
  - Tam authorization matrix (auth/session/admin/pii-token x method x route) bütüncül testlenmiş değil.
  - Bazı route testleri source-string seviyesinde kalıyor.
- Değerlendirme:
  - On-chain authority korunuyor; uygulama erişim matrisi daha sistematik testlenmeli.

## 7. Models / Identity / Data Integrity
- Güçlü yönler:
  - Big-id ve identity normalization yönünde önemli ilerleme var.
- Riskler:
  - `*_num` cache alanlarının enforcement’ta yanlış kullanım riski sürüyor.
  - Bazı modellerde chain context veya block metadata eksikliği forensics/triage kalitesini düşürüyor.
- Değerlendirme:
  - Model tasarımı genel olarak doğru; indeks/metadata güçlendirmesi mainnet operasyonu için gerekli.

## 8. Worker / Mirror / Replay / Finality
- Güçlü yönler:
  - Finality-depth + safe checkpoint + ack/unsafe yaklaşımı iyi.
  - DLQ/backoff/retry ve idempotency ana iskeleti sağlam.
- Riskler:
  - Replay batch’te tekil poison event backlog büyütebilir.
  - ABI drift ve explicit reconciliation eksikliği uzun vadeli mirror drift riski üretir.
- Değerlendirme:
  - Worker temeli güçlü; drift detection/ABI governance ile sertleştirilmeli.

## 9. Jobs / Cleanup / Automation
- Güçlü yönler:
  - Pending listing cleanup V3 no-op (authoritative state’e dokunmuyor).
  - Sensitive cleanup terminal guard’lı.
- Riskler:
  - Scheduler success kontratı gevşek.
  - Job overlap/distributed lock görünürlüğü sınırlı.
  - Stats snapshot büyüyen veri setinde maliyetli olabilir.
- Değerlendirme:
  - Job’lar authority sınırına sadık, ancak operasyonel güvenilirlik arttırılmalı.

## 10. Deployment / Env / Operational Readiness
- Güçlü yönler:
  - CORS/chain/env fail-closed guardları birçok yerde mevcut.
- Riskler:
  - Redis policy (TLS verify bypass), readiness probe drift, KMS boot matrix ve combined chaos senaryoları.
  - Protocol config stale-age için hard policy eksik.
- Değerlendirme:
  - Mainnet için “works” seviyesinde; “resilient by default” için ek sertleştirme gerekiyor.

## 11. Test Gaps
1. Auth refresh family reuse/race/replay testleri (P0).  
2. Worker replay partial-failure + DLQ poison progression testleri (P0).  
3. Route authorization matrix table-driven test paketi (P0).  
4. KMS provider production boot fail-closed matrix (P1).  
5. Mongo/Redis/RPC combined chaos readiness testleri (P1).  
6. Cleanup destructive edge-case (future retention, non-terminal invariant) testleri (P1).  
7. ABI drift CI contract tests (P1).  
8. BigInt/string/Number boundary regression suite (P2).

## 12. Recommended Fix Order
1. KMS runtime dependency + provider boot fail-closed.
2. Logger merkezi redaction hardening.
3. Scheduler success kontratını fail-closed yap.
4. Redis TLS policy’yi production’da sıkılaştır.
5. Refresh token rotation/reuse/race hardening + tests.
6. Deployment probe’larını `/ready` odaklı standardize et.
7. Worker ABI drift guard + CI automation ekle.
8. Worker reconciliation/drift detection job’u ekle.
9. Authorization matrix test paketini tamamla.
10. Stats/job operational lock + performance iyileştirmelerini uygula.

## 13. Suggested Codex Fix Prompts
- **B-01 (KMS dependency):** “`backend/package.json` ve encryption boot path’ini güncelle: AWS KMS için eksik runtime dependency’yi ekle, production’da `KMS_PROVIDER=aws` iken fail-closed boot testi yaz.”
- **B-02 (dockerignore secrets):** “`.dockerignore` dosyasını `.env*` ve benzeri secret pattern’leri kapsayacak şekilde sıkılaştır; CI’de context secret leak guard testi ekle.”
- **B-03 (logger redaction):** “`utils/logger.js` içinde merkezi redaction pipeline oluştur; JWT/refresh/PII alanlarını maskeyip scrubber testlerini genişlet.”
- **B-04 (scheduler success):** “`didScheduledJobSucceed` kontratını fail-closed olacak şekilde güncelle (`undefined` başarısız/warn), ilgili job testlerini adapte et.”
- **H-01 (refresh hardening):** “Auth refresh akışına token-family reuse/race koruması ekle; concurrent refresh ve replay testleri yaz.”
- **H-02 (Redis TLS):** “`config/redis.js` içinde production’da `REDIS_TLS_SKIP_VERIFY=true` kullanımını engelle; policy testleri ekle.”
- **H-03 (readiness drift):** “Deploy probe konfigürasyonlarını `/ready` ile hizala; health/readiness integration contract testleri ekle.”
- **H-04 (ABI drift):** “Worker inline ABI için source-of-truth otomasyonu ve ABI drift CI testi ekle; event signature mismatch’te fail-fast davranış uygula.”
- **H-05 (reconciliation):** “Event mirror için per-record reconciliation job tasarla; checkpoint sonrası drift alarm metriklerini üret.”
- **H-06 (model context):** “Reward/revenue/allocation modellerine chain context + gerekli index stratejisini ekle; migration ve backward-compat testleri yaz.”
